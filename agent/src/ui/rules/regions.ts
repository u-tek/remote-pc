import { area, findAll, isInside, isSelectable, texts, walk, type Node } from './tree.js';

export interface Regions {
  menuBar?: Node;
  toolbars: Node[];
  /** Small icon buttons along the top edge outside any toolbar ("Keep on top", "Share"). */
  topButtons: Node[];
  /** Document / page tabs across the top (Notepad tabs, Explorer tabs). */
  docTabs?: Node;
  nav?: Node;
  navItems: Node[];
  search?: Node;
  status?: Node;
  back?: Node;
  /** Account header near the navigation (Settings). */
  profile?: Node;
  /** App title label shown inside the window (not the title bar). */
  appTitle?: Node;
  /** Dialog windows that live inside the main window's tree. */
  dialogs: Node[];
  content: Node;
  /** Everything above; content mapping skips these subtrees. */
  consumed: Set<Node>;
}

const NAV_ITEM_TYPES = new Set(['ListItem', 'TreeItem', 'Hyperlink', 'TabItem', 'RadioButton', 'Button', 'MenuItem']);
const SEARCH_RE = /\b(search|find|filter)\b/i;
const BACK_RE = /^(back|go back|navigate back|previous page)$/i;

/** Rows of a navigation candidate: its own row-like descendants, not nested inside other lists. */
export function navItemsOf(container: Node): Node[] {
  return findAll(container, (n) => NAV_ITEM_TYPES.has(n.t) && (n.t !== 'Button' || isSelectable(n) || n.raw.inv === 1) && Boolean(n.name || texts(n)[0]), {
    into: (n) => !NAV_ITEM_TYPES.has(n.t),
  });
}

function navScore(c: Node, W: number, H: number): number {
  if (!['List', 'Tree', 'Group', 'Pane', 'Custom'].includes(c.t)) return 0;
  const items = navItemsOf(c);
  if (items.length < 3) return 0;
  const leftAligned = c.x <= W * 0.15;
  const narrow = c.w > 0 && c.w <= W * 0.45;
  const tall = c.h >= H * 0.35;
  if (!leftAligned || !narrow || !tall) return 0;
  const shortNames = items.filter((i) => (i.name || texts(i)[0] || '').length <= 40).length / items.length;
  if (shortNames < 0.8) return 0;
  const selectable = items.some(isSelectable) ? 0.5 : 0;
  const tree = c.t === 'Tree' ? 0.3 : 0;
  const named = /nav|menu|sidebar|pane|folder/i.test(`${c.name} ${c.raw.aid ?? ''} ${c.raw.cls ?? ''}`) ? 0.4 : 0;
  return c.h / H + Math.min(items.length, 12) / 12 + selectable + tree + named + (c.x <= W * 0.05 ? 0.2 : 0);
}

export function detectRegions(root: Node, W: number, H: number): Regions {
  const consumed = new Set<Node>();
  const regions: Regions = {
    toolbars: [],
    topButtons: [],
    navItems: [],
    dialogs: [],
    content: root,
    consumed,
  };

  // In-tree dialogs (owned windows show up as children of their owner).
  walk(root, (n) => {
    if (n !== root && n.t === 'Window' && (n.raw.modal === 1 || n.raw.cls === '#32770')) {
      regions.dialogs.push(n);
      consumed.add(n);
      return false;
    }
    return true;
  });

  regions.menuBar = findAll(root, (n) => n.t === 'MenuBar' && !consumed.has(n))[0];
  if (regions.menuBar) consumed.add(regions.menuBar);

  // Navigation pane.
  let best: { node: Node; score: number } | undefined;
  walk(root, (n) => {
    if (consumed.has(n)) return false;
    const score = navScore(n, W, H);
    if (score > (best?.score ?? 1.3)) best = { node: n, score };
    return true;
  });
  if (best) {
    regions.nav = best.node;
    regions.navItems = navItemsOf(best.node);
    consumed.add(best.node);
  }

  // Tabs across the top.
  const tabs = findAll(root, (n) => n.t === 'Tab' && !consumed.has(n) && n.y < H * 0.22 && findAll(n, (k) => k.t === 'TabItem').length >= 1);
  if (tabs[0]) {
    regions.docTabs = tabs[0];
    consumed.add(tabs[0]);
  }

  // Toolbars (not inside the navigation pane or lists).
  regions.toolbars = findAll(root, (n) => n.t === 'ToolBar' && !consumed.has(n) && ![...consumed].some((c) => isInside(n, c)), {
    into: (n) => n.t !== 'ToolBar' && n.t !== 'List' && n.t !== 'Tree',
  });
  for (const t of regions.toolbars) consumed.add(t);

  regions.topButtons = findAll(
    root,
    (n) =>
      (n.t === 'Button' || n.t === 'SplitButton') &&
      !consumed.has(n) &&
      ![...consumed].some((c) => isInside(n, c)) &&
      n.y < Math.min(H * 0.15, 110) &&
      n.w > 0 &&
      n.w <= 48 &&
      n.h <= 48 &&
      !BACK_RE.test(n.name) &&
      Boolean(n.name),
    {
      into: (n) => n.t !== 'Button' && n.t !== 'List' && n.t !== 'Tab' && n.t !== 'MenuBar',
    },
  );
  for (const b of regions.topButtons) consumed.add(b);

  // Search box.
  regions.search = findAll(
    root,
    (n) =>
      (n.t === 'Edit' || n.t === 'ComboBox') &&
      SEARCH_RE.test(`${n.name} ${n.raw.aid ?? ''} ${n.raw.help ?? ''}`) &&
      (n.y < H * 0.3 || (regions.nav !== undefined && isInside(n, regions.nav))),
  )[0];
  if (regions.search) consumed.add(regions.search);

  regions.status = findAll(root, (n) => n.t === 'StatusBar')[0];
  if (regions.status) consumed.add(regions.status);

  regions.back = findAll(
    root,
    (n) => n.t === 'Button' && (BACK_RE.test(n.name) || /^(back(button)?|navigationviewbackbutton)$/i.test(n.raw.aid ?? '')) && n.x < W * 0.3 && n.y < H * 0.25,
  )[0];
  if (regions.back) consumed.add(regions.back);

  // Account header above the navigation (picture + name [+ email]).
  if (regions.nav) {
    const firstNavY = Math.min(...regions.navItems.map((i) => i.y).filter((y) => y > 0), regions.nav.y + regions.nav.h);
    regions.profile = findAll(
      root,
      (n) =>
        ['Group', 'Button', 'ListItem', 'Pane', 'Hyperlink'].includes(n.t) &&
        !consumed.has(n) &&
        n.x < W * 0.45 &&
        n.y < firstNavY &&
        n.h <= 160 &&
        findAll(n, (k) => k.t === 'Image').length > 0 &&
        texts(n).length >= 1 &&
        texts(n).length <= 3,
    )[0];
    if (regions.profile) consumed.add(regions.profile);
  }

  // The app's own name printed in the window (e.g. "Settings" over the navigation).
  const top = findAll(root, (n) => n.t === 'Text' && !consumed.has(n) && n.y < H * 0.12 && n.x < W * 0.3)[0];
  if (top && regions.nav && top.x < regions.nav.x + regions.nav.w) {
    regions.appTitle = top;
    consumed.add(top);
  }

  // Main content: the biggest region to the right of the navigation, else the whole window.
  if (regions.nav) {
    const nav = regions.nav;
    const candidates = findAll(
      root,
      (n) =>
        ['Pane', 'Group', 'Custom', 'Document', 'List', 'DataGrid', 'Table', 'Window'].includes(n.t) &&
        !consumed.has(n) &&
        !isInside(nav, n) &&
        n.x >= nav.x + nav.w - 12 &&
        area(n) >= W * H * 0.2,
    );
    candidates.sort((a, b) => area(b) - area(a));
    if (candidates[0]) regions.content = candidates[0];
  }
  return regions;
}
