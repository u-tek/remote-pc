import type { Action, Alert, AppInfo, Choice, Icon, Item, MenuItem, Screen, SearchField, Section } from '../schema.js';
import { ref, type USnapshot } from '../uia.js';
import { symbolFor, tilesForList } from './icons.js';
import { commandAction, mapContent, readingOrder, type MapContext } from './map.js';
import { prune } from './prune.js';
import { detectRegions, navItemsOf, type Regions } from './regions.js';
import { appNameFor, documentTitle, truncate } from './text.js';
import { area, canInvoke, findAll, hasToggle, isDisabled, isExpandable, isSelected, isSelectable, prepare, texts, walk, type Node } from './tree.js';

export interface RewriteOptions {
  appId: string;
  icon?: Icon;
  /** URL for a picture of a node of this window; `size` changes when the picture probably did. */
  imageUrl(nodeId: string, size: string): string;
  /** Token for a live picture of part of the window (rect relative to the window). */
  region(rect: [number, number, number, number]): string;
  /** Combo box options learned earlier, by node id. */
  options?: Record<string, Choice[]>;
  /** Menu bar submenus learned earlier, by top-level menu name. */
  menus?: Record<string, MenuItem[]>;
}

export interface Rewritten {
  app: AppInfo;
  /** The app's own navigation (sidebar) as a root list, when it has one. */
  home?: Screen;
  /** The navigation item currently showing in the page. */
  homeSelection?: string;
  /** What the window shows right now. */
  page: Screen;
  /** Titles of the levels above the page (breadcrumb), outermost first. */
  trail: string[];
  /** Goes up one level in the app (breadcrumb parent or the app's back button). */
  up?: Action;
  sheet?: Screen;
  alert?: Alert;
  /** A dropdown list is open: its combo box and options. */
  openOptions?: { comboId?: string; options: Choice[] };
  /** A popup menu is open. */
  openMenu?: MenuItem[];
  /** Number of native items produced (how well the window was understood). */
  coverage: number;
  /** The parsed window, for adapters that reshape the result (not sent to the phone). */
  source: { root: Node; regions: Regions; ctx: MapContext };
}

export function rewrite(snap: USnapshot, opts: RewriteOptions): Rewritten {
  const W = snap.rect[2];
  const H = snap.rect[3];
  const root = prune(prepare(snap.root), W);
  const regions = detectRegions(root, W, H);
  const used = new Set<Node>();
  for (const c of regions.consumed) walk(c, (n) => void used.add(n));

  const appName = appNameFor(snap.process, snap.title);
  const app: AppInfo = {
    id: opts.appId,
    name: appName,
    source: 'auto',
    icon: opts.icon,
  };
  const ctx: MapContext = {
    W,
    H,
    used,
    imageUrl: (n) => opts.imageUrl(n.id, `${n.w}x${n.h}`),
    region: (n) => opts.region([n.x, n.y, n.w, n.h]),
    options: opts.options ?? {},
    // Small windows with OK/Cancel are dialogs even when they are the app's main window.
    dialog: snap.cls === '#32770' || (W <= 720 && H <= 600),
  };

  const mapped = mapContent(regions.content, ctx);
  // Things outside the main content that nothing else claimed (e.g. a bottom bar).
  if (regions.content !== root) {
    walk(regions.content, (n) => void used.add(n));
    const rest = mapContent(root, { ...ctx });
    if (rest.sections.length) mapped.sections.push(...rest.sections.map((s, i) => ({ ...s, id: `x${i}-${s.id}` })));
  }

  const home = regions.nav ? buildHome(regions, appName, ctx) : undefined;
  const selected = regions.navItems.find(isSelected);

  const title = mapped.title ?? (home ? selected?.name : undefined) ?? documentTitle(snap.title, appName) ?? appName;
  const page: Screen = {
    id: `page:${[...mapped.trail, title].join('/')}`,
    title: truncate(title, 60),
    style: mapped.style,
    sections: mapped.sections,
  };
  if (mapped.segments) page.segments = mapped.segments;
  if (mapped.document) page.document = mapped.document;
  if (mapped.more) page.more = mapped.more;
  if (ctx.dialog && mapped.dialogButtons.length) applyDialogButtons(page, mapped.dialogButtons);

  applyCommands(page, regions, opts);
  applySearch(page, home, regions);
  applyTabs(page, regions);

  const up = mapped.up ?? (regions.back && !isDisabled(regions.back) ? { ref: ref('invoke', regions.back.id) } : undefined);
  if (up) page.back = up;

  if (regions.status && page.style !== 'document') {
    const status =
      texts(regions.status)
        .filter((t) => t.length <= 60)
        .slice(0, 3)
        .join(' · ') || regions.status.name;
    const last = page.sections[page.sections.length - 1];
    if (status && last && !last.footer) last.footer = status;
  }

  let coverage = countItems(page.sections) + (page.document ? 5 : 0) + (home ? countItems(home.sections) : 0);
  const hasLive = page.sections.some((sec) => sec.items.some((i) => i.kind === 'live'));
  // Hidden fallback: when the window can't be read (games, canvases, video), show it live.
  if (!page.document && !hasLive && countItems(page.sections) < 2 && area(regions.content) >= W * H * 0.2) {
    const c = regions.content;
    const live: Item = {
      id: `live-${c.id}`,
      kind: 'live',
      region: opts.region([c.x, c.y, c.w, c.h]),
      aspect: c.w / Math.max(1, c.h),
    };
    page.sections = [...page.sections, { id: 'live', style: 'plain', items: [live] }];
    coverage = Math.min(coverage, 1);
  }
  const onlyLive = countItems(page.sections) === 1 && page.sections[0].items[0].kind === 'live';
  if (onlyLive) {
    page.style = undefined;
    coverage = 0;
  }
  if (page.sections.length === 0 && !page.document)
    page.empty = {
      title: 'Nothing to show',
      message: 'This part of the app is empty.',
      symbol: 'rectangle.dashed',
    };
  if (!home && mapped.trail.length === 0 && !up && !onlyLive && !mapped.keypad && !ctx.dialog)
    page.largeTitle = page.style !== 'document' && page.style !== 'article';

  const out: Rewritten = {
    app,
    home,
    homeSelection: selected?.id,
    page,
    trail: mapped.trail,
    up,
    coverage,
  } as Rewritten;
  // Not enumerable: the parsed tree is circular and must never end up in JSON.
  Object.defineProperty(out, 'source', { value: { root, regions, ctx }, enumerable: false });
  applyPopups(out, snap, root, regions, ctx, opts, W);
  return out;
}

const countItems = (sections: Section[]) => sections.reduce((a, s) => a + s.items.length, 0);

// ---------- navigation (sidebar) ----------

function buildHome(regions: Regions, appName: string, ctx: MapContext): Screen {
  const sections: Section[] = [];
  if (regions.profile) {
    const p = regions.profile;
    const lines = texts(p);
    const img = findAll(p, (k) => k.t === 'Image')[0];
    sections.push({
      id: 'profile',
      items: [
        {
          id: p.id,
          kind: 'profile',
          title: lines[0] ?? p.name,
          subtitle: lines.slice(1).join(' · ') || undefined,
          icon: img
            ? { image: ctx.imageUrl(img), style: 'circle' }
            : {
                symbol: 'person.crop.circle.fill',
                color: 'gray',
                style: 'plain',
              },
          tap: canInvoke(p) || p.t === 'Hyperlink' ? { ref: ref('invoke', p.id) } : undefined,
        },
      ],
    });
  }

  // Walk the navigation pane in order; plain labels between rows start new groups.
  const nav = regions.nav!;
  const navSet = new Set(regions.navItems);
  let current: Section = { id: 'nav0', items: [] };
  let seq = 0;
  const flush = (header?: string) => {
    if (current.items.length) sections.push(current);
    current = { id: `nav${++seq}`, items: [], header };
  };
  const rows: Array<{ node: Node; level: number }> = [];
  const visit = (n: Node, level: number) => {
    for (const k of n.kids) {
      if (navSet.has(k)) {
        rows.push({ node: k, level });
        // Expanded tree rows show their children.
        if (k.t === 'TreeItem' && k.raw.exp === 1) visitTree(k, level + 1);
      } else if (k.t === 'Text' && k.name && !ctx.used.has(k)) {
        rows.push({ node: k, level: -1 });
      } else if (!navSet.has(k)) visit(k, level);
    }
  };
  const visitTree = (n: Node, level: number) => {
    for (const k of n.kids) {
      if (k.t === 'TreeItem') {
        rows.push({ node: k, level });
        if (k.raw.exp === 1) visitTree(k, level + 1);
      } else visitTree(k, level);
    }
  };
  visit(nav, 0);

  const navRows = rows.filter((r) => r.level >= 0);
  const icons = tilesForList(navRows.map((r) => r.node.name || texts(r.node)[0] || ''));
  let iconIndex = 0;
  for (const { node, level } of rows) {
    if (level < 0) {
      flush(node.name);
      continue;
    }
    const name = node.name || texts(node)[0] || '';
    const icon = icons[iconIndex++];
    const extra = texts(node).filter((t) => t !== name);
    const badge = extra.find((t) => /^\d{1,4}\+?$/.test(t));
    const img = findAll(node, (k) => k.t === 'Image' && k.w > 8 && k.w <= 48)[0];
    current.items.push({
      id: node.id,
      kind: 'nav',
      title: truncate(name, 60),
      subtitle: extra.find((t) => t !== badge && t.length > 2) ? truncate(extra.find((t) => t !== badge && t.length > 2)!, 80) : undefined,
      badge,
      icon: icon ?? (img ? { image: ctx.imageUrl(img), style: 'plain' } : undefined),
      selected: isSelected(node) || undefined,
      tap: { ref: ref('nav', node.id) },
    });
    if (level > 0) (current.items[current.items.length - 1] as { level?: number }).level = level;
  }
  flush();
  return {
    id: 'home',
    title: appName,
    largeTitle: true,
    style: 'form',
    sections,
  };
}

// ---------- toolbars, menus, search, tabs ----------

const FAVORED = /^(new|add|compose|new (mail|message|chat|folder|tab|item)|share|edit|save|send|create|done|play|pause|record)$/i;
const REFRESH = /^(refresh|reload)$/i;
const NOT_COMMANDS = /^(back|forward|go back|go forward|more options|see more|more)$/i;

function commandNodes(container: Node): Node[] {
  return findAll(
    container,
    (n) =>
      (['Button', 'SplitButton', 'MenuItem', 'CheckBox', 'RadioButton', 'ComboBox'].includes(n.t) && Boolean(n.name || n.raw.help)) ||
      (n.t === 'Button' && Boolean(n.raw.aid)),
    {
      into: (n) => !['Button', 'SplitButton', 'MenuItem', 'ComboBox'].includes(n.t),
    },
  );
}

function menuItemFor(n: Node): MenuItem {
  const title = n.name || n.raw.help || n.raw.aid || '';
  const item: MenuItem = { title };
  const symbol = symbolFor(title, n.raw.aid);
  if (symbol) item.symbol = symbol;
  if (hasToggle(n)) {
    item.checked = n.raw.tog === 1;
    item.action = { ref: ref('toggle', n.id) };
  } else if (n.t === 'RadioButton' || (isSelectable(n) && !canInvoke(n))) {
    item.checked = isSelected(n);
    item.action = { ref: ref('select', n.id) };
  } else if (n.t === 'ComboBox') {
    item.load = { ref: ref('options', n.id) };
  } else {
    item.action = commandAction(n);
  }
  if (isDisabled(n)) item.disabled = true;
  if (/\b(delete|remove|discard)\b/i.test(title)) item.role = 'destructive';
  return item;
}

function applyCommands(page: Screen, regions: Regions, opts: RewriteOptions): void {
  const commands = [...regions.toolbars.flatMap(commandNodes), ...regions.topButtons].filter((n) => !NOT_COMMANDS.test(n.name));
  const refresh = commands.find((n) => REFRESH.test(n.name));
  if (refresh) page.refresh = { ref: ref('invoke', refresh.id), title: refresh.name };
  const rest = commands.filter((n) => n !== refresh);

  // Formatting/drawing tools sit at the bottom in document screens.
  if (page.style === 'document') {
    const tools = rest.filter((n) => symbolFor(n.name, n.raw.aid) && (n.t === 'Button' || n.t === 'CheckBox')).slice(0, 5);
    if (tools.length >= 2)
      page.bottomBar = tools.map((n) => ({
        ...commandAction(n),
        title: n.name,
      }));
  }

  const favored = rest.filter(
    (n) => (n.t === 'Button' || n.t === 'SplitButton') && !hasToggle(n) && !isDisabled(n) && FAVORED.test(n.name) && symbolFor(n.name, n.raw.aid),
  );
  const actions = favored.slice(0, 2).map(commandAction);
  if (actions.length) page.actions = actions;

  const menu: MenuItem[] = [];
  const leftover = rest.filter((n) => !favored.slice(0, 2).includes(n) && !page.bottomBar?.some((b) => b.ref.endsWith(n.id)));
  if (leftover.length) menu.push({ title: '', children: leftover.slice(0, 40).map(menuItemFor) });

  if (regions.menuBar) {
    const tops = findAll(regions.menuBar, (n) => n.t === 'MenuItem' && Boolean(n.name), { into: (n) => n.t !== 'MenuItem' });
    const bar: MenuItem[] = tops.map((t) => {
      const known = opts.menus?.[t.name];
      return known
        ? { title: t.name, children: known }
        : {
            title: t.name,
            symbol: symbolFor(t.name),
            load: { ref: ref('menu', t.id) },
          };
    });
    if (bar.length) menu.push({ title: '', children: bar });
  }
  if (menu.length === 1) page.menu = menu[0].children;
  else if (menu.length > 1) page.menu = menu;
}

function applySearch(page: Screen, home: Screen | undefined, regions: Regions): void {
  const s = regions.search;
  if (!s) return;
  const field: SearchField = {
    ref: ref(s.raw.val !== undefined ? 'setValue' : 'type', s.id),
    placeholder: s.raw.help || s.name || 'Search',
    value: s.raw.val ?? '',
    submit: { ref: ref('submit', s.id) },
  };
  if (/^search$/i.test(field.placeholder) === false && field.placeholder.length > 40) field.placeholder = 'Search';
  if (home && regions.nav && isInsideNav(s, regions.nav)) home.search = field;
  else page.search = field;
}

const isInsideNav = (n: Node, nav: Node) => {
  for (let p: Node | undefined = n; p; p = p.parent) if (p === nav) return true;
  return n.x < nav.x + nav.w && n.y < nav.y + 80;
};

function applyTabs(page: Screen, regions: Regions): void {
  const tabs = regions.docTabs;
  if (!tabs) return;
  const items = findAll(tabs, (n) => n.t === 'TabItem' && Boolean(n.name), {
    into: (n) => n.t !== 'TabItem',
  });
  if (items.length === 0) return;
  const selected = items.find(isSelected);
  if (!page.segments && items.length >= 2 && items.length <= 4 && items.every((i) => i.name.length <= 14)) {
    page.segments = {
      items: items.map((i) => ({
        id: i.id,
        title: i.name,
        ref: ref('select', i.id),
      })),
      selected: selected?.id,
    };
    return;
  }
  // Many document tabs: a "Tabs" menu with the open one checked, plus "New Tab" when available.
  const newTab = findAll(tabs, (n) => n.t === 'Button' && /new tab|add tab|add new tab/i.test(n.name))[0];
  const children: MenuItem[] = items.map((i) => ({
    title: truncate(i.name, 40),
    checked: isSelected(i) || undefined,
    action: { ref: ref('select', i.id) },
  }));
  if (newTab)
    children.push({
      title: 'New Tab',
      symbol: 'plus',
      action: { ref: ref('invoke', newTab.id) },
    });
  page.menu = [{ title: `Tabs (${items.length})`, symbol: 'square.on.square', children }, ...(page.menu ?? [])];
  if (selected && page.title !== selected.name) page.subtitle = truncate(selected.name, 60);
}

// ---------- dialogs, menus and dropdowns ----------

/** Cancel on the left, the default (OK/Save) on the right, anything else at the bottom. */
function applyDialogButtons(screen: Screen, buttons: Node[]): void {
  const actions: Action[] = [];
  const extra: Action[] = [];
  for (const b of buttons) {
    const a = commandAction(b);
    if (CANCEL_RE.test(b.name) && !actions.some((x) => x.role === 'cancel')) actions.unshift({ ...a, role: 'cancel', symbol: undefined });
    else if (OK_RE.test(b.name) && !actions.some((x) => x.role === 'primary')) actions.push({ ...a, role: 'primary', symbol: undefined });
    else extra.push(a);
  }
  if (actions.length) screen.actions = [...actions, ...(screen.actions ?? [])];
  if (extra.length)
    screen.sections.push({
      id: 'buttons',
      items: [{ id: `buttons-${buttons[0].id}`, kind: 'buttons', actions: extra }],
    });
}

const OK_RE = /^(ok|save|open|yes|done|finish|next|continue|install|allow|replace|print|send|apply|select( folder)?|choose)$/i;
const CANCEL_RE = /^(cancel|close|no|not now|skip)$/i;

function menuFromPopup(popup: Node): MenuItem[] {
  const out: MenuItem[] = [];
  let group: MenuItem[] = [];
  const flush = () => {
    if (group.length) out.push(...(out.length ? [{ title: '', children: group }] : group));
    group = [];
  };
  for (const n of findAll(popup, (k) => k.t === 'MenuItem' || k.t === 'Separator', { into: (k) => k.t !== 'MenuItem' })) {
    if (n.t === 'Separator') {
      flush();
      continue;
    }
    if (!n.name) continue;
    const item: MenuItem = { title: n.name };
    const symbol = symbolFor(n.name, n.raw.aid);
    if (symbol) item.symbol = symbol;
    if (hasToggle(n)) item.checked = n.raw.tog === 1;
    if (isDisabled(n)) item.disabled = true;
    if (isExpandable(n)) item.load = { ref: ref('expand', n.id) };
    else
      item.action = {
        ref: ref(canInvoke(n) ? 'invoke' : 'click', n.id),
        title: n.name,
      };
    if (/\b(delete|remove)\b/i.test(n.name)) item.role = 'destructive';
    group.push(item);
  }
  flush();
  return out;
}

function isMessageBox(d: Node): boolean {
  const inputs = findAll(d, (n) => ['Edit', 'ComboBox', 'List', 'Tree', 'DataGrid', 'Slider', 'Tab', 'RadioButton'].includes(n.t));
  const buttons = findAll(d, (n) => n.t === 'Button' && canInvoke(n) && Boolean(n.name));
  const lines = texts(d);
  return inputs.length === 0 && buttons.length >= 1 && buttons.length <= 4 && lines.length >= 1 && lines.length <= 4;
}

function applyPopups(out: Rewritten, snap: USnapshot, root: Node, regions: Regions, ctx: MapContext, opts: RewriteOptions, W: number): void {
  const popups: Node[] = [...regions.dialogs];
  for (const raw of snap.popups) {
    const p = prune(prepare(raw), raw.r?.[2] ?? W);
    if (p.w <= 2 || p.h <= 2 || p.t === 'ToolTip') continue;
    popups.push(p);
  }
  // An expanded combo box shows its options inside its own subtree (WinUI) or as a popup list.
  const openCombo = findAll(root, (n) => n.t === 'ComboBox' && n.raw.exp === 1)[0];

  for (const p of popups.reverse()) {
    const menuItems = findAll(p, (k) => k.t === 'MenuItem');
    if (
      p.t === 'Menu' ||
      p.raw.cls === '#32768' ||
      (menuItems.length >= 2 && menuItems.length >= texts(p).length / 2 && findAll(p, (k) => k.t === 'Edit').length === 0)
    ) {
      const items = menuFromPopup(p);
      if (items.length) {
        out.openMenu = items;
        out.sheet = {
          id: `menu:${p.id}`,
          title: p.name || '',
          style: 'list',
          sections: [{ id: 'menu', items: flatMenu(items) }],
        };
        return;
      }
    }
    const listItems = findAll(p, (k) => k.t === 'ListItem' && Boolean(k.name));
    if (openCombo && listItems.length && findAll(p, (k) => k.t === 'Button' || k.t === 'Edit').length === 0) {
      out.openOptions = {
        comboId: openCombo.id,
        options: listItems.map((i) => ({ id: i.name, title: i.name })),
      };
      continue;
    }
    if (p.t === 'Window' || p.raw.cls === '#32770' || p.raw.modal === 1 || p.t === 'Pane') {
      if (isMessageBox(p)) {
        const buttons = findAll(p, (n) => n.t === 'Button' && canInvoke(n) && Boolean(n.name));
        const lines = texts(p);
        const title = p.name && p.name !== snap.title ? p.name : (lines[0] ?? 'Message');
        const message = lines.filter((l) => l !== title).join('\n') || undefined;
        out.alert = {
          title,
          message,
          actions: buttons.map((b) => {
            const a: Action = { ref: ref('invoke', b.id), title: b.name };
            if (/\b(delete|remove|don't save|discard|overwrite|replace)\b/i.test(b.name)) a.role = 'destructive';
            else if (CANCEL_RE.test(b.name)) a.role = 'cancel';
            else if (OK_RE.test(b.name)) a.role = 'primary';
            return a;
          }),
        };
        return;
      }
      const sheetCtx: MapContext = {
        ...ctx,
        used: new Set(),
        dialog: true,
        W: p.w || ctx.W,
        H: p.h || ctx.H,
      };
      const m = mapContent(p, sheetCtx);
      if (m.sections.length === 0 && m.dialogButtons.length === 0) continue;
      const sheet: Screen = {
        id: `sheet:${p.id}`,
        title: truncate(p.name || m.title || '', 50),
        style: m.style,
        sections: m.sections,
      };
      if (m.segments) sheet.segments = m.segments;
      applyDialogButtons(sheet, m.dialogButtons);
      out.sheet = sheet;
      return;
    }
  }
  if (openCombo && !out.openOptions) {
    const inside = findAll(openCombo, (k) => k.t === 'ListItem' && Boolean(k.name));
    if (inside.length)
      out.openOptions = {
        comboId: openCombo.id,
        options: inside.map((i) => ({ id: i.name, title: i.name })),
      };
  }
  void opts;
}

function flatMenu(items: MenuItem[]): Item[] {
  const out: Item[] = [];
  for (const m of items) {
    if (!m.title && m.children) {
      if (out.length) out.push({ id: `div-${out.length}`, kind: 'divider' });
      out.push(...flatMenu(m.children));
      continue;
    }
    const tap = m.action ?? m.load;
    out.push({
      id: `${tap?.ref ?? m.title}`,
      kind: 'item',
      title: m.title,
      icon: m.symbol
        ? {
            symbol: m.symbol,
            style: 'plain',
            color: m.role === 'destructive' ? 'red' : undefined,
          }
        : undefined,
      checked: m.checked,
      chevron: Boolean(m.load) || undefined,
      tap: tap && !m.disabled ? tap : undefined,
    });
  }
  return out;
}

export { readingOrder, navItemsOf };
