import type {
  Action,
  Choice,
  ChoiceItem,
  DocumentBody,
  FieldItem,
  HeadingItem,
  Item,
  ListItem,
  Run,
  ScreenStyle,
  Section,
  Segments,
  TileItem,
} from '../schema.js';
import { ref } from '../uia.js';
import { fileIcon, symbolFor } from './icons.js';
import { detectKeypad, keyFor } from './keypad.js';
import { asHeader, asLabel, isSizeLike, isTimeLike, truncate, valueFromIsLabel } from './text.js';
import {
  area,
  canInvoke,
  count,
  findAll,
  hasToggle,
  hasValue,
  isDisabled,
  isInside,
  isExpandable,
  isSelectable,
  isSelected,
  lct,
  texts,
  walk,
  type Node,
} from './tree.js';

export interface MapContext {
  /** Window size. */
  W: number;
  H: number;
  /** Nodes already shown somewhere (regions, labels, earlier items). */
  used: Set<Node>;
  /** URL for a picture of a node (icons, avatars, photos). */
  imageUrl(n: Node): string;
  /** Token for a live picture of a node's area. */
  region(n: Node): string;
  /** Options already learned for combo boxes, by node id. */
  options: Record<string, Choice[]>;
  /** Mapping a dialog: OK / Cancel style buttons are collected instead of shown inline. */
  dialog?: boolean;
}

export interface Mapped {
  sections: Section[];
  style: ScreenStyle;
  segments?: Segments;
  document?: DocumentBody;
  /** Page heading found at the top of the content. */
  title?: string;
  /** Breadcrumb levels above the page. */
  trail: string[];
  /** Invoking this goes up one breadcrumb level. */
  up?: Action;
  more?: Action;
  /** OK / Cancel / Apply… (only when ctx.dialog). */
  dialogButtons: Node[];
  /** Number of rows that came from lists (for the screen style). */
  rows: number;
  /** Rows were laid out as tiles. */
  tiles: boolean;
  /** A calculator-style keypad was found. */
  keypad?: boolean;
}

const LISTS = new Set(['List', 'DataGrid', 'Table', 'Tree']);
const ROWS = new Set(['ListItem', 'DataItem', 'TreeItem']);
const CARD_TYPES = new Set(['Group', 'Pane', 'Custom', 'ListItem', 'Button', 'DataItem', 'Hyperlink', 'TreeItem']);
const INLINE = new Set(['Text', 'Hyperlink']);
const DIALOG_BUTTON =
  /^(ok|cancel|apply|close|yes|no|yes to all|no to all|retry|ignore|abort|continue|try again|done|save|don't save|open|next|back|finish|skip|allow|deny|block|install|replace|keep both|skip this file)$/i;
const PRIMARY_BUTTON = /^(ok|save|open|next|finish|done|continue|sign in|log in|install|allow|yes|send|submit|apply|create|confirm|search|go)$/i;
const DESTRUCTIVE = /\b(delete|remove|uninstall|erase|reset|sign out|log out|format|discard|don't save|clear all)\b/i;
const STATE_TEXT = /^(on|off|enabled|disabled)$/i;

const isToggleLike = (n: Node) => n.t === 'CheckBox' || (n.t === 'Button' && hasToggle(n));
const isCommand = (n: Node) =>
  (n.t === 'Button' || n.t === 'SplitButton' || n.t === 'Hyperlink' || n.t === 'MenuItem') && (canInvoke(n) || isExpandable(n) || n.t === 'Hyperlink');

/** A control a settings row is "about". */
function isPrimary(n: Node): boolean {
  return ['Edit', 'ComboBox', 'Slider', 'Spinner', 'CheckBox', 'RadioButton', 'ProgressBar'].includes(n.t) || isToggleLike(n) || isCommand(n);
}

/** Win32 and WinForms report children in z-order; others in logical order. */
function ordered(n: Node): Node[] {
  const fw = n.kids[0]?.raw.fw;
  if (fw !== 'Win32' && fw !== 'WinForm') return n.kids;
  if (n.kids.some((k) => k.w <= 0 || k.h <= 0)) return n.kids;
  return readingOrder(n.kids);
}

/** Rows top to bottom (by vertical overlap), each left to right. */
export function readingOrder(nodes: Node[]): Node[] {
  const sorted = [...nodes].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: Node[][] = [];
  for (const n of sorted) {
    const row = rows[rows.length - 1];
    if (row) {
      const top = Math.min(...row.map((r) => r.y));
      const bottom = Math.max(...row.map((r) => r.y + r.h));
      const overlap = Math.min(bottom, n.y + n.h) - Math.max(top, n.y);
      if (overlap > Math.min(n.h, bottom - top) * 0.5) {
        row.push(n);
        continue;
      }
    }
    rows.push([n]);
  }
  return rows.flatMap((r) => r.sort((a, b) => a.x - b.x));
}

const sameRow = (a: Node, b: Node) => {
  const overlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return overlap > Math.min(a.h, b.h) * 0.5;
};

/** `label` sits just above `n`, roughly left-aligned with it. */
const above = (label: Node, n: Node) => label.y + label.h <= n.y + 4 && n.y - (label.y + label.h) <= 28 && Math.abs(label.x - n.x) <= Math.max(40, n.w * 0.5);

function isHeadingText(n: Node): boolean {
  if (n.t !== 'Text' && n.t !== 'Group') return false;
  return lct(n) === 'heading' || n.raw.lvl !== undefined || /^(header|heading|title)\w*$/i.test(n.raw.aid ?? '');
}

function keyboardFor(name: string): FieldItem['keyboard'] {
  const s = name.toLowerCase();
  if (/e-?mail/.test(s)) return 'email';
  if (/\b(url|web ?site|web address|link)\b/.test(s)) return 'url';
  if (/\b(phone|mobile|tel)\b/.test(s)) return 'phone';
  if (/\b(port|number|count|amount|quantity|age|year|width|height|size|copies|pages?)\b/.test(s)) return 'number';
  return undefined;
}

class Out {
  sections: Section[] = [];
  cur: Section = { id: 's0', items: [] };
  private seq = 0;

  section(header?: string, style?: Section['style']): void {
    if (this.cur.items.length > 0) {
      this.sections.push(this.cur);
      this.cur = { id: `s${++this.seq}`, items: [] };
    }
    this.cur.header = header ? truncate(asHeader(header), 60) : undefined;
    this.cur.style = style;
  }

  add(item: Item): void {
    this.cur.items.push(item);
  }

  get last(): Item | undefined {
    return this.cur.items[this.cur.items.length - 1];
  }

  finish(): Section[] {
    if (this.cur.items.length > 0) this.sections.push(this.cur);
    this.cur = { id: `s${++this.seq}`, items: [] };
    // Drop a footer-only or empty section.
    return this.sections.filter((s) => s.items.length > 0);
  }
}

/** Map the content of a window (or a dialog) to native sections. */
export function mapContent(root: Node, ctx: MapContext): Mapped {
  const out = new Out();
  const m: Mapped = {
    sections: [],
    style: 'form',
    trail: [],
    dialogButtons: [],
    rows: 0,
    tiles: false,
  };
  const { used } = ctx;

  findHeader(root, ctx, m);
  const doc = findDocument(root, ctx);
  if (doc) {
    m.document = doc.body;
    used.add(doc.node);
  }

  const visit = (n: Node, siblings: Node[], index: number): void => {
    if (used.has(n)) return;

    // Live picture for things that can't be rebuilt (video, canvas, game).
    if (isOpaqueSurface(n, ctx)) {
      used.add(n);
      out.add({
        id: n.id,
        kind: 'live',
        region: ctx.region(n),
        aspect: n.w / n.h,
        caption: n.name || undefined,
      });
      return;
    }

    // Tabs in the content become a segmented control (or a picker when there are many).
    if (n.t === 'Tab') {
      mapTabs(n, out, m, ctx);
      for (const k of ordered(n)) if (k.t !== 'TabItem') visitAll(k);
      return;
    }

    if (LISTS.has(n.t)) {
      mapList(n, out, m, ctx);
      return;
    }

    if (isHeadingText(n)) {
      used.add(n);
      if (n.name) {
        if (m.style === 'article' || n.raw.fw === 'Chrome')
          out.add({
            id: n.id,
            kind: 'heading',
            text: n.name,
            level: Math.min(Math.max(n.raw.lvl ?? 2, 1), 6) as HeadingItem['level'],
          });
        else out.section(n.name);
      }
      return;
    }

    // A named group of controls is a section.
    if ((n.t === 'Group' || n.t === 'Pane') && n.name && count(n, isPrimary) >= 2 && !rowLike(n)) {
      used.add(n);
      out.section(n.name);
      visitAll(n);
      out.section();
      return;
    }

    // A small group that is "one setting": title, description and its control.
    const c = card(n, ctx);
    if (c) {
      out.add(c);
      return;
    }

    // Flowing text with links.
    const para = paragraph(n, ctx);
    if (para) {
      out.add(para);
      return;
    }

    if (isPrimary(n)) {
      // Side-by-side buttons form one row of buttons.
      if (isCommand(n) && n.t !== 'Hyperlink') {
        const row = buttonRun(siblings, index, used);
        if (ctx.dialog && row.every((b) => DIALOG_BUTTON.test(b.name)) && row.length > 0) {
          for (const b of row) used.add(b);
          m.dialogButtons.push(...row);
          return;
        }
        if (row.length >= 2) {
          for (const b of row) used.add(b);
          out.add({
            id: `row-${row[0].id}`,
            kind: 'buttons',
            actions: row.map(commandAction),
          });
          return;
        }
      }
      // Radio groups become one choice.
      if (n.t === 'RadioButton') {
        const radios = radioRun(siblings, index, used);
        if (radios.length >= 2) {
          const label = labelBefore(siblings, index, ctx) ?? (n.parent?.name && n.parent.t === 'Group' ? n.parent.name : undefined);
          out.add(radioChoice(radios, label, ctx));
          return;
        }
      }
      const label = labelBefore(siblings, index, ctx);
      const item = control(n, ctx, label);
      if (item) {
        out.add(item);
        // A long description right after a setting reads as its subtitle.
        const next = siblings[index + 1];
        if (next && next.t === 'Text' && !used.has(next) && next.name.length >= 30 && withSubtitle(item) && !(item as { subtitle?: string }).subtitle) {
          (item as { subtitle?: string }).subtitle = next.name;
          used.add(next);
        }
        return;
      }
    }

    if (n.t === 'Text') {
      mapText(n, siblings, index, out, ctx, m);
      return;
    }

    if (n.t === 'Image') {
      used.add(n);
      if (n.w >= 96 && n.h >= 64)
        out.add({
          id: n.id,
          kind: 'image',
          image: ctx.imageUrl(n),
          caption: imageCaption(n.name),
          aspect: n.w / n.h,
        });
      return;
    }

    if (n.t === 'Document' && n.raw.fw === 'Chrome') m.style = 'article';

    // Expanders (Settings): a row that reveals more settings beneath it.
    if (isExpandable(n) && (n.t === 'Group' || n.t === 'Pane' || n.t === 'Custom') && n.name) {
      used.add(n);
      out.add({
        id: n.id,
        kind: 'item',
        title: n.name,
        subtitle: texts(n).find((t) => t !== n.name),
        expanded: n.raw.exp === 1,
        expand: { ref: ref(n.raw.exp === 1 ? 'collapse' : 'expand', n.id) },
        tap: { ref: ref(n.raw.exp === 1 ? 'collapse' : 'expand', n.id) },
      });
      if (n.raw.exp === 1) for (const k of ordered(n)) if (k.t !== 'Text' && k.t !== 'Image') visitAll(k);
      for (const t of findAll(n, (k) => k.t === 'Text' || k.t === 'Image', {
        into: (k) => k.t !== 'Group' && k.t !== 'Pane',
      }))
        used.add(t);
      return;
    }

    used.add(n);
    visitAll(n);
  };

  const visitAll = (n: Node) => {
    const kids = ordered(n);
    // A calculator-like grid spread over several groups is drawn as one keypad where it starts.
    const keypad = detectKeypad(n, used);
    const owners = keypad ? kids.filter((k) => keypad.keys.some((b) => isInside(b, k))) : [];
    if (keypad && (owners.length >= 2 || n === root || owners.length === kids.length)) {
      for (const b of keypad.keys) used.add(b);
      const top = Math.min(...keypad.keys.map((b) => b.y));
      const h = keypad.keys[0].h;
      const extras = readingOrder(keypad.extras.filter((e) => !used.has(e) && e.y >= top - h * 2 && e.y < top));
      for (const e of extras) used.add(e);
      kids.forEach((k, i) => {
        if (k === owners[0]) {
          if (extras.length)
            out.add({
              id: `row-${extras[0].id}`,
              kind: 'buttons',
              actions: extras.map((e) => ({ ...keyFor(e), tone: undefined })),
            });
          out.add(keypad.item);
          m.keypad = true;
        }
        visit(k, kids, i);
      });
      return;
    }
    kids.forEach((k, i) => visit(k, kids, i));
  };

  if (!m.document && LISTS.has(root.t)) mapList(root, out, m, ctx);
  else if (!m.document) visitAll(root);
  else {
    // A document app: only the toolbars above/below the text matter, and they live in regions.
    m.style = 'document';
  }

  m.sections = out.finish();
  if (m.style === 'form') {
    if (m.tiles) m.style = 'grid';
    else if (m.rows >= 4 && m.rows >= itemsCount(m.sections) * 0.6) m.style = 'list';
    else if (m.sections.some((s) => s.items.some((i) => i.kind === 'paragraph')) && m.sections.every((s) => !s.header)) m.style = 'article';
  }
  if (m.style === 'article' || m.style === 'list') for (const s of m.sections) if (!s.style) s.style = 'plain';
  return m;
}

const itemsCount = (sections: Section[]) => sections.reduce((a, s) => a + s.items.length, 0);

const withSubtitle = (item: Item) => item.kind === 'toggle' || item.kind === 'choice' || item.kind === 'nav' || item.kind === 'check' || item.kind === 'item';

function rowLike(n: Node): boolean {
  if (n.w <= 0 || n.h <= 0) return true;
  return n.h <= 160 && n.w >= n.h * 1.8;
}

/** The page's own heading and breadcrumb. */
function findHeader(root: Node, ctx: MapContext, m: Mapped): void {
  const crumbs = findAll(root, (n) => /breadcrumb/i.test(`${n.raw.aid ?? ''} ${n.raw.cls ?? ''} ${lct(n)}`) && !ctx.used.has(n))[0];
  if (crumbs) {
    const parts = findAll(crumbs, (n) => ['ListItem', 'Button', 'Hyperlink', 'Text', 'MenuItem'].includes(n.t) && Boolean(n.name), {
      into: (n) => !['ListItem', 'Button', 'Hyperlink', 'MenuItem'].includes(n.t),
    });
    const names = parts.map((p) => p.name).filter((s) => s !== '>' && s !== '›');
    if (names.length >= 1) {
      m.title = names[names.length - 1];
      m.trail = names.slice(0, -1);
      const parent = parts.filter((p) => p.name === m.trail[m.trail.length - 1] && (canInvoke(p) || isSelectable(p) || p.t === 'Hyperlink'))[0];
      if (parent)
        m.up = {
          ref: ref(canInvoke(parent) || parent.t === 'Hyperlink' ? 'invoke' : 'select', parent.id),
        };
      ctx.used.add(crumbs);
      return;
    }
  }
  const top = root.h > 0 ? root.y + root.h * 0.2 : Infinity;
  const heading = findAll(
    root,
    (n) =>
      n.t === 'Text' &&
      !ctx.used.has(n) &&
      n.name.length > 0 &&
      n.name.length <= 50 &&
      n.y <= top &&
      (isHeadingText(n) || n.h >= 30) &&
      !valueFromIsLabel(n.name),
  )[0];
  if (heading) {
    m.title = heading.name;
    ctx.used.add(heading);
  }
}

/** A text editor filling most of the content (Notepad, code editors, mail body). */
function findDocument(root: Node, ctx: MapContext): { node: Node; body: DocumentBody } | undefined {
  const big = root.w > 0 ? area(root) * 0.35 : 0;
  const candidates = findAll(
    root,
    (n) =>
      (n.t === 'Edit' || n.t === 'Document') &&
      n.raw.fw !== 'Chrome' &&
      (n.raw.txt === 1 || hasValue(n)) &&
      area(n) >= big &&
      n.h >= 120 &&
      count(n, (k) => isPrimary(k) || k.t === 'List') === 0 &&
      !ctx.used.has(n),
  );
  const node = candidates.sort((a, b) => area(b) - area(a))[0];
  if (!node) return undefined;
  const editable = !node.raw.ro && !isDisabled(node);
  return {
    node,
    body: {
      text: node.raw.tx ?? node.raw.val ?? '',
      ref: editable && hasValue(node) ? ref('setValue', node.id) : undefined,
      typeRef: editable ? ref('type', node.id) : undefined,
      format: 'plain',
    },
  };
}

function isOpaqueSurface(n: Node, ctx: MapContext): boolean {
  if (!['Pane', 'Custom', 'Group', 'Document'].includes(n.t)) return false;
  if (n.w < 160 || n.h < 120 || area(n) < ctx.W * ctx.H * 0.12) return false;
  if (n.raw.fw === 'Chrome' && n.t === 'Document') return false;
  if (n.raw.txt) return false;
  let meaningful = 0;
  walk(n, (k) => {
    if (k !== n && (k.name || isPrimary(k) || ROWS.has(k.t))) meaningful++;
    return meaningful < 2;
  });
  if (meaningful >= 2) return false;
  return true;
}

function mapTabs(n: Node, out: Out, m: Mapped, ctx: MapContext): void {
  const items = findAll(n, (k) => k.t === 'TabItem' && Boolean(k.name), {
    into: (k) => k.t !== 'TabItem',
  });
  ctx.used.add(n);
  for (const i of items) ctx.used.add(i);
  if (items.length === 0) return;
  const choices: Choice[] = items.map((i) => ({
    id: i.id,
    title: truncate(i.name, 24),
    ref: ref('select', i.id),
  }));
  const selected = items.find(isSelected)?.id;
  if (!m.segments && items.length <= 5 && items.every((i) => i.name.length <= 16)) {
    m.segments = { items: choices, selected };
    return;
  }
  const item: ChoiceItem = {
    id: n.id,
    kind: 'choice',
    title: n.name || 'View',
    value: items.find(isSelected)?.name,
    options: choices.map((c) => ({ id: c.id, title: c.title, ref: c.ref })),
    selected,
    ref: ref('select', n.id),
  };
  out.add(item);
}

/** Buttons next to `n` on the same row, in order, starting at index. */
function buttonRun(siblings: Node[], index: number, used: Set<Node>): Node[] {
  const first = siblings[index];
  const run = [first];
  const short = (b: Node) => (b.name || '').length <= 22 && (b.name || symbolFor(b.name, b.raw.aid));
  if (!short(first)) return run;
  for (let i = index + 1; i < siblings.length; i++) {
    const b = siblings[i];
    if (used.has(b) || !isCommand(b) || b.t === 'Hyperlink' || !short(b) || !sameRow(first, b)) break;
    run.push(b);
  }
  // Only a run if the first one wasn't in the middle of another run.
  const prev = siblings[index - 1];
  if (prev && isCommand(prev) && sameRow(prev, first) && !used.has(prev)) return [first];
  return run.length > 4 && !run.every((b) => DIALOG_BUTTON.test(b.name)) ? run.slice(0, 4) : run;
}

function radioRun(siblings: Node[], index: number, used: Set<Node>): Node[] {
  const run: Node[] = [];
  for (let i = index; i < siblings.length; i++) {
    const r = siblings[i];
    if (r.t !== 'RadioButton' || used.has(r)) break;
    run.push(r);
  }
  return run;
}

function radioChoice(radios: Node[], label: string | undefined, ctx: MapContext): ChoiceItem {
  for (const r of radios) ctx.used.add(r);
  const options: Choice[] = radios.map((r) => ({
    id: r.id,
    title: r.name,
    ref: ref('select', r.id),
  }));
  const selected = radios.find((r) => r.raw.sel === 1 || r.raw.tog === 1);
  const short = radios.length <= 3 && radios.every((r) => r.name.length <= 12);
  return {
    id: radios[0].id,
    kind: 'choice',
    title: label ? asLabel(label) : '',
    value: selected?.name,
    options,
    selected: selected?.id,
    ref: ref('select', radios[0].id),
    style: short ? 'segmented' : 'inline',
    disabled: radios.every(isDisabled) || undefined,
  };
}

/** A text label right before an input (same row to the left, or just above), consumed. */
function labelBefore(siblings: Node[], index: number, ctx: MapContext): string | undefined {
  const n = siblings[index];
  for (let i = index - 1; i >= Math.max(0, index - 2); i--) {
    const l = siblings[i];
    if (ctx.used.has(l)) continue;
    if (l.t !== 'Text' || !l.name || l.name.length > 60) return undefined;
    const placed = n.w > 0 && l.w > 0 ? (sameRow(l, n) && l.x < n.x) || above(l, n) : true;
    if (!placed) return undefined;
    ctx.used.add(l);
    return l.name;
  }
  return undefined;
}

function commandAction(n: Node): Action {
  const name = n.name || n.raw.help || '';
  const a: Action = {
    ref: ref(n.t === 'SplitButton' || (isExpandable(n) && !canInvoke(n)) ? 'expand' : 'invoke', n.id),
    title: name || undefined,
  };
  const symbol = symbolFor(name, n.raw.aid);
  if (symbol) a.symbol = symbol;
  if (DESTRUCTIVE.test(name)) a.role = 'destructive';
  else if (PRIMARY_BUTTON.test(name)) a.role = 'primary';
  else if (/^(cancel|close)$/i.test(name)) a.role = 'cancel';
  if (isDisabled(n)) a.disabled = true;
  if (!a.title && !a.symbol) a.title = n.raw.aid || 'Button';
  return a;
}

export { commandAction };

/** Map one control (with an optional label from beside it). */
export function control(n: Node, ctx: MapContext, label?: string, subtitle?: string): Item | undefined {
  ctx.used.add(n);
  const name = n.name;
  const title = label ? asLabel(label) : name;
  const disabled = isDisabled(n) || undefined;

  if (isToggleLike(n)) {
    return {
      id: n.id,
      kind: 'toggle',
      title: title || name || 'Option',
      subtitle,
      on: n.raw.tog === 1,
      ref: ref('toggle', n.id),
      disabled,
    };
  }
  if (n.t === 'RadioButton') {
    return {
      id: n.id,
      kind: 'check',
      title: title || name,
      subtitle,
      on: n.raw.sel === 1 || n.raw.tog === 1,
      ref: ref('select', n.id),
      radio: true,
      disabled,
    };
  }
  if (n.t === 'ComboBox') return combo(n, ctx, title, subtitle);
  if (n.t === 'Slider' && n.raw.rng) {
    const [min, max, value, small] = n.raw.rng;
    return {
      id: n.id,
      kind: 'slider',
      title: title || 'Value',
      min,
      max,
      value,
      step: small > 0 ? small : undefined,
      ref: ref('setRange', n.id),
      disabled,
    };
  }
  if (n.t === 'Spinner' && n.raw.rng) {
    const [min, max, value, small] = n.raw.rng;
    return {
      id: n.id,
      kind: 'stepper',
      title: title || 'Value',
      min,
      max,
      value,
      step: small > 0 ? small : 1,
      ref: ref('setRange', n.id),
    };
  }
  if (n.t === 'ProgressBar') {
    const r = n.raw.rng;
    return {
      id: n.id,
      kind: 'progress',
      title: title || undefined,
      value: r && r[1] > r[0] ? (r[2] - r[0]) / (r[1] - r[0]) : undefined,
    };
  }
  if (n.t === 'Edit') return field(n, title !== name ? title : label ? title : undefined);
  if (isCommand(n)) {
    const action = commandAction(n);
    if (n.t === 'Hyperlink') return { id: n.id, kind: 'button', action, style: 'link' };
    const prominent = PRIMARY_BUTTON.test(name) && !ctx.dialog;
    return {
      id: n.id,
      kind: 'button',
      action,
      style: prominent ? 'prominent' : 'row',
    };
  }
  return undefined;
}

function field(n: Node, title?: string): FieldItem {
  const name = n.name;
  const value = n.raw.val ?? n.raw.tx ?? '';
  const multiline = n.h >= 64 && (n.raw.txt === 1 || /multi|memo|rich|notes?|comment|message|body|description/i.test(`${name} ${n.raw.cls ?? ''}`));
  const f: FieldItem = {
    id: n.id,
    kind: 'field',
    title: title || undefined,
    placeholder: n.raw.help || (!title ? name : undefined) || undefined,
    value: value === name && !title ? '' : value,
    ref: hasValue(n) ? ref('setValue', n.id) : ref('type', n.id),
  };
  if (n.raw.pw) f.secure = true;
  if (multiline) f.multiline = true;
  if (n.raw.ro) f.readOnly = true;
  const kb = keyboardFor(`${title ?? ''} ${name} ${n.raw.aid ?? ''}`);
  if (kb) f.keyboard = kb;
  if (/\b(search|find|filter|go to|address)\b/i.test(`${title ?? ''} ${name}`)) f.submit = { ref: ref('submit', n.id), title: 'Go' };
  return f;
}

function combo(n: Node, ctx: MapContext, title: string, subtitle?: string): Item {
  const items = findAll(n, (k) => k.t === 'ListItem' && Boolean(k.name));
  for (const i of items) ctx.used.add(i);
  for (const k of findAll(n, () => true)) ctx.used.add(k);
  const editable = findAll(n, (k) => k.t === 'Edit' && !k.raw.ro)[0];
  const selectedItem = items.find(isSelected);
  const current = n.raw.val || selectedItem?.name || findAll(n, (k) => k.t === 'Text' && Boolean(k.name))[0]?.name || '';
  const options: Choice[] | undefined = items.length ? items.map((i) => ({ id: i.name, title: i.name })) : ctx.options[n.id];

  if (editable && !options) {
    return field(editable.raw.val !== undefined ? { ...editable, name: title || n.name } : { ...n, name: title || n.name }, title || n.name);
  }
  const label = title && title !== current ? title : n.name && n.name !== current ? n.name : '';
  const item: ChoiceItem = {
    id: n.id,
    kind: 'choice',
    title: asLabel(label),
    subtitle,
    value: current || undefined,
    options,
    selected: options ? (options.find((o) => o.title === current)?.id ?? undefined) : undefined,
    ref: ref('choose', n.id),
    style: 'menu',
    disabled: isDisabled(n) || undefined,
  };
  if (!options) item.load = { ref: ref('options', n.id) };
  return item;
}

/**
 * "One setting" containers: a short title, an optional description, and at most one control.
 * This is what makes Settings-style pages read like iOS Settings.
 */
function card(n: Node, ctx: MapContext): Item | undefined {
  if (!CARD_TYPES.has(n.t) || !rowLike(n) || (ROWS.has(n.t) && n.parent && LISTS.has(n.parent.t))) return undefined;
  if (n.raw.fw === 'Chrome' && n.t !== 'Button' && n.t !== 'Hyperlink') {
    // Web layouts nest deeply; only clear-cut link/button rows are cards there.
    return undefined;
  }
  let size = 0;
  walk(n, () => ++size < 20);
  if (size >= 20) return undefined;

  const controls = findAll(n, (k) => isPrimary(k) && !ctx.used.has(k), {
    into: (k) => !isPrimary(k),
  });
  const imgs = findAll(n, (k) => k.t === 'Image');
  let labels = [...new Set(texts(n))].filter((t) => !STATE_TEXT.test(t) && !/^[\u{E000}-\u{F8FF}›>]$/u.test(t));
  labels = labels.filter((t) => !controls.some((c) => c.raw.val === t));
  // The row's own name (or its control's) is the title; the first other line is the description.
  const named = [n.name, ...controls.map((c) => c.name)].find((x) => x && (labels.includes(x) || x === n.name));
  if (named) labels = [named, ...labels.filter((l) => l !== named)];
  const selfAction = canInvoke(n) || n.t === 'Hyperlink' || (isSelectable(n) && n.t === 'ListItem');

  if (controls.length === 0) {
    // A full-width button (Settings "Graphics  ›") is a row that opens something, not a push button.
    const wide = n.t === 'Button' && n.w >= ctx.W * 0.45 && n.h >= 44 && n.raw.fw !== 'Chrome';
    if (!selfAction || (n.t === 'Button' && labels.filter((l) => l !== n.name).length === 0 && !wide)) return undefined;
    const title = labels[0] ?? n.name;
    if (!title) return undefined;
    const subtitle = labels.find((l) => l !== title);
    const value = labels.find((l) => l !== title && l !== subtitle && l.length <= 24);
    markUsed(n, ctx);
    const icon = imgs[0] && imgs[0].w <= 64 && imgs[0].w > 0 ? { image: ctx.imageUrl(imgs[0]) } : undefined;
    return {
      id: n.id,
      kind: 'nav',
      title: truncate(title, 80),
      subtitle: subtitle ? truncate(subtitle, 140) : undefined,
      value,
      icon,
      tap: {
        ref: ref(canInvoke(n) || n.t === 'Hyperlink' ? 'invoke' : 'select', n.id),
      },
    };
  }
  if (controls.length !== 1 || labels.length > 3) return undefined;
  const c = controls[0];
  if (c.t === 'Edit' && labels.length === 0) return undefined;
  const title = labels[0] ?? n.name ?? c.name;
  const subtitle = labels.find((l) => l !== title && l !== c.name);
  if (isCommand(c) && !isToggleLike(c)) {
    // "Rename this PC   [Rename]" → a row that does the button's job.
    if (!labels.length || labels[0] === c.name) return undefined;
    markUsed(n, ctx);
    return {
      id: n.id,
      kind: 'nav',
      title: truncate(title, 80),
      subtitle: subtitle ? truncate(subtitle, 140) : undefined,
      value: c.name && c.name !== title && c.name.length <= 18 ? c.name : undefined,
      tap: {
        ref: ref(isExpandable(c) && !canInvoke(c) ? 'expand' : 'invoke', c.id),
      },
    };
  }
  const item = control(c, ctx, title, subtitle);
  if (!item) return undefined;
  markUsed(n, ctx);
  return item;
}

function markUsed(n: Node, ctx: MapContext): void {
  walk(n, (k) => {
    ctx.used.add(k);
  });
}

/** Text with inline links (web pages, about boxes, mail). */
function paragraph(n: Node, ctx: MapContext): Item | undefined {
  if (!['Group', 'Pane', 'Custom', 'Text', 'ListItem'].includes(n.t) || n.kids.length === 0) return undefined;
  const leaves: Node[] = [];
  let ok = true;
  walk(n, (k) => {
    if (k === n) return true;
    if (INLINE.has(k.t)) {
      leaves.push(k);
      return false; // a link's text is the link
    }
    if (k.t === 'Image' && k.w <= 24) return false;
    if (['Group', 'Pane', 'Custom'].includes(k.t) && !k.name) return true;
    ok = false;
    return false;
  });
  if (!ok || leaves.length < 2) return undefined;
  const totalText = leaves.reduce((a, l) => a + l.name.length, 0);
  if (!leaves.some((l) => l.t === 'Hyperlink') && totalText < 60) return undefined;
  // Leaves must flow (not a column of separate labels).
  if (leaves.length > 2 && leaves.every((l) => l.t === 'Text') && leaves.every((l, i) => i === 0 || !sameRow(l, leaves[i - 1]))) return undefined;

  const runs: Run[] = [];
  for (const l of leaves) {
    const text = l.name;
    if (!text) continue;
    const prev = runs[runs.length - 1];
    const glue = prev && !/^[.,;:!?)\]’'”]/.test(text) && !/[(\[‘“'/]$/.test(prev.text) ? ' ' : '';
    if (glue) {
      if (prev.link) runs.push({ text: glue });
      else prev.text += glue;
    }
    if (l.t === 'Hyperlink') runs.push({ text, link: { ref: ref('invoke', l.id), title: text } });
    else runs.push({ text });
  }
  markUsed(n, ctx);
  const bullet = n.t === 'ListItem' ? '•' : undefined;
  return { id: n.id, kind: 'paragraph', runs, bullet };
}

function mapText(n: Node, siblings: Node[], index: number, out: Out, ctx: MapContext, m: Mapped): void {
  const { used } = ctx;
  const text = n.name;
  const next = siblings[index + 1];

  // A label for the input after it: leave it for the input to pick up.
  if (
    next &&
    !used.has(next) &&
    LABELLED.has(next.t) &&
    text.length <= 60 &&
    (next.w <= 0 || n.w <= 0 || (sameRow(n, next) && n.x < next.x) || above(n, next))
  ) {
    if (!(next.t === 'Edit' && next.raw.ro)) return;
  }
  used.add(n);
  if (!text || STATE_TEXT.test(text)) return;

  const shown = valueFromIsLabel(text);
  if (shown !== undefined) {
    const secondary = /expression|history|memory/i.test(`${n.raw.aid ?? ''} ${text}`);
    out.add({
      id: n.id,
      kind: 'text',
      text: shown,
      style: secondary ? 'secondary' : 'display',
      copyable: true,
    });
    return;
  }

  // "Version:  23H2" → label / value.
  if (
    next &&
    next.t === 'Text' &&
    !used.has(next) &&
    next.name &&
    text.length <= 40 &&
    next.name.length <= 80 &&
    (next.w <= 0 || n.w <= 0 || (sameRow(n, next) && next.x > n.x))
  ) {
    used.add(next);
    out.add({
      id: n.id,
      kind: 'text',
      label: asLabel(text),
      text: next.name,
      copyable: true,
    });
    return;
  }
  // "Label:" followed by a read-only value field.
  if (next && next.t === 'Edit' && next.raw.ro && !used.has(next) && text.length <= 40) {
    used.add(next);
    out.add({
      id: n.id,
      kind: 'text',
      label: asLabel(text),
      text: next.raw.val ?? '',
      copyable: true,
    });
    return;
  }

  // A short line followed by settings, a list, or a row that opens something is a group header.
  if (
    text.length <= 40 &&
    !/[.!?]$/.test(text) &&
    next &&
    !used.has(next) &&
    next.t !== 'Text' &&
    startsGroup(next) &&
    !(next.w > 0 && n.w > 0 && sameRow(n, next))
  ) {
    out.section(text);
    return;
  }

  // Description after a setting → its subtitle or the section footer.
  const last = out.last;
  if (text.length >= 40 && last && withSubtitle(last) && !(last as { subtitle?: string }).subtitle && m.style !== 'article') {
    (last as { subtitle?: string }).subtitle = text;
    return;
  }
  if (text.length >= 80 && out.cur.items.length > 0 && !out.cur.footer && m.style !== 'article' && n.raw.fw !== 'Chrome') {
    out.cur.footer = text;
    out.section();
    return;
  }
  if (text.length >= 60 && n.raw.fw === 'Chrome') {
    out.add({ id: n.id, kind: 'paragraph', runs: [{ text }] });
    return;
  }
  out.add({
    id: n.id,
    kind: 'text',
    text,
    style: text.length > 120 ? 'footnote' : undefined,
  });
}

const LABELLED = new Set(['Edit', 'ComboBox', 'Slider', 'Spinner', 'ProgressBar']);

function startsGroup(n: Node): boolean {
  if (LISTS.has(n.t) || n.t === 'Tab') return true;
  if (LABELLED.has(n.t)) return false;
  if (CARD_TYPES.has(n.t) && (count(n, isPrimary) >= 1 || canInvoke(n))) return true;
  return count(n, isPrimary) >= 2;
}

/** The words of a block, links included, in order. */
function inlineText(n: Node): string {
  const parts: string[] = [];
  walk(n, (k) => {
    if (k !== n && INLINE.has(k.t) && k.name) {
      parts.push(k.name);
      return false;
    }
    return true;
  });
  return parts.join(' ');
}

function imageCaption(name: string): string | undefined {
  if (!name || /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(name) || name.length > 120) return undefined;
  return name;
}

// ---------- lists ----------

interface Cell {
  label?: string;
  value: string;
}

function headersOf(list: Node): string[] {
  return findAll(list, (k) => k.t === 'HeaderItem' && Boolean(k.name)).map((h) => h.name);
}

function cellsOf(row: Node, headers: string[]): Cell[] {
  const cells: Cell[] = [];
  const cellNodes = row.kids.filter((k) => ['Text', 'Edit', 'Custom', 'DataItem', 'Hyperlink'].includes(k.t));
  cellNodes.forEach((k, i) => {
    const val = k.raw.val;
    if (val !== undefined && val !== '')
      cells.push({
        label: k.name && k.name !== val ? k.name : headers[i],
        value: val,
      });
    else if (k.name) cells.push({ label: headers[i], value: k.name });
    else {
      const inner = texts(k)[0];
      if (inner) cells.push({ label: headers[i], value: inner });
    }
  });
  return cells;
}

const FILEY = /\.[a-z0-9]{1,5}$/i;
const FOLDER_TYPE = /^(file folder|folder|directory|system folder)$/i;

function listRow(r: Node, headers: string[], files: boolean, ctx: MapContext, level?: number): ListItem {
  const cells = cellsOf(r, headers);
  const title = r.name || cells[0]?.value || texts(r)[0] || '';
  const rest = cells.filter((c) => c.value && c.value !== title);
  const meta = rest.find((c) => isTimeLike(c.value)) ?? rest.find((c) => isSizeLike(c.value));
  const isDir = rest.some((c) => FOLDER_TYPE.test(c.value));
  const others = rest.filter((c) => c !== meta && !(files && /^type$/i.test(c.label ?? '')) && !FOLDER_TYPE.test(c.value));
  const subtitle =
    others
      .slice(0, 2)
      .map((c) => c.value)
      .join(' · ') || undefined;
  const img = findAll(r, (k) => k.t === 'Image' && k.w > 8 && k.w <= 96)[0];

  const item: ListItem = {
    id: r.id,
    kind: 'item',
    title: truncate(title, 120),
  };
  if (subtitle) item.subtitle = truncate(subtitle, 140);
  if (meta) item.meta = meta.value;
  if (files) item.icon = fileIcon(title, isDir || (!FILEY.test(title) && !meta));
  else if (img)
    item.icon = {
      image: ctx.imageUrl(img),
      style: img.w >= 28 && /avatar|profile|photo|picture/i.test(`${img.name} ${img.raw.aid ?? ''}`) ? 'circle' : 'plain',
    };
  if (r.raw.tog !== undefined) item.checked = r.raw.tog === 1;
  else if (isSelected(r)) item.selected = true;
  if (isDisabled(r)) item.tap = undefined;
  else item.tap = { ref: ref(canInvoke(r) ? 'invoke' : 'open', r.id) };
  if (r.t === 'TreeItem') {
    item.level = level;
    if (r.raw.exp !== undefined && r.raw.exp !== 3) {
      item.expanded = r.raw.exp === 1;
      item.expand = { ref: ref(r.raw.exp === 1 ? 'collapse' : 'expand', r.id) };
    }
    item.tap = { ref: ref('select', r.id) };
  }
  item.menu = [
    {
      title: 'Open',
      symbol: 'arrow.up.right.square',
      action: { ref: ref('open', r.id) },
    },
    {
      title: 'More Options…',
      symbol: 'ellipsis.circle',
      load: { ref: ref('context', r.id) },
    },
  ];
  return item;
}

function mapList(n: Node, out: Out, m: Mapped, ctx: MapContext): void {
  const { used } = ctx;
  used.add(n);
  const headers = headersOf(n);
  const rows = findAll(n, (k) => ROWS.has(k.t) && !used.has(k), {
    into: (k) => !ROWS.has(k.t) || k.t === 'TreeItem',
  });
  for (const h of findAll(n, (k) => k.t === 'Header' || k.t === 'HeaderItem')) used.add(h);
  if (rows.length === 0) {
    // Some lists hold buttons or plain labels instead of rows.
    const kids = ordered(n);
    for (const k of kids) markUsed(k, ctx);
    const items = kids.filter((k) => k.name);
    if (items.length) {
      out.section(n.name || undefined);
      for (const k of items) {
        const it = isCommand(k) ? control(k, ctx) : { id: k.id, kind: 'text' as const, text: k.name };
        if (it) out.add(it);
      }
    }
    return;
  }
  // Lists in web pages are bulleted text.
  if (n.raw.fw === 'Chrome' && n.t === 'List') {
    out.section(undefined, out.cur.style);
    for (const r of rows) {
      const p = paragraph(r, ctx);
      const label = inlineText(r) || r.name;
      markUsed(r, ctx);
      if (p) out.add(p);
      else if (label) {
        const link = findAll(r, (k) => k.t === 'Hyperlink')[0];
        out.add({
          id: r.id,
          kind: 'paragraph',
          bullet: '•',
          runs: [
            {
              text: label,
              link: link ? { ref: ref('invoke', link.id) } : undefined,
            },
          ],
        });
      }
    }
    return;
  }
  for (const r of rows) markUsed(r, ctx);

  const names = rows.map((r) => r.name || texts(r)[0] || '');
  const files =
    names.filter((s) => FILEY.test(s)).length >= Math.max(1, rows.length * 0.4) || rows.some((r) => cellsOf(r, headers).some((c) => FOLDER_TYPE.test(c.value)));
  const main = n.w <= 0 || area(n) >= ctx.W * ctx.H * 0.25;
  const simple = rows.every((r) => cellsOf(r, headers).filter((c) => c.value !== r.name).length === 0 && findAll(r, isPrimary).length === 0);

  // Tiles: several items per row (icon views, galleries, start menus).
  const xs = new Set(
    rows
      .slice(0, 16)
      .filter((r) => r.w > 0)
      .map((r) => Math.round(r.x / 8)),
  );
  const ys = new Set(
    rows
      .slice(0, 16)
      .filter((r) => r.w > 0)
      .map((r) => Math.round(r.y / 8)),
  );
  if (n.t !== 'Tree' && n.t !== 'DataGrid' && xs.size >= 3 && ys.size < rows.slice(0, 16).length * 0.7 && rows.length >= 4) {
    out.section(n.name && !main ? n.name : undefined, 'grid');
    for (const r of rows) {
      const img = findAll(r, (k) => k.t === 'Image' && k.w > 16)[0];
      const tile: TileItem = {
        id: r.id,
        kind: 'tile',
        title: truncate(r.name || texts(r)[0] || '', 40),
        tap: { ref: ref(canInvoke(r) ? 'invoke' : 'open', r.id) },
      };
      if (img) tile.image = ctx.imageUrl(img);
      else if (files) tile.icon = fileIcon(tile.title, !FILEY.test(tile.title));
      else {
        const s = symbolFor(tile.title);
        if (s) tile.icon = { symbol: s, style: 'tile', color: 'blue' };
      }
      out.add(tile);
    }
    m.tiles = true;
    m.rows += rows.length;
    out.section();
    return;
  }

  // A small single-choice list inside a form: a checkmark picker.
  if (!main && simple && n.t === 'List' && !n.raw.multi && rows.length <= 40) {
    out.section(n.name || undefined);
    for (const r of rows)
      out.add({
        id: r.id,
        kind: 'check',
        title: r.name || texts(r)[0] || '',
        on: isSelected(r),
        ref: ref('select', r.id),
        radio: true,
        disabled: isDisabled(r) || undefined,
      });
    out.section();
    return;
  }

  // Wide tables read better as cards.
  if (headers.length >= 5 && !files && n.t !== 'Tree') {
    out.section(n.name && !main ? n.name : undefined, 'cards');
    for (const r of rows) {
      const cells = cellsOf(r, headers);
      const title = r.name || cells[0]?.value || '';
      out.add({
        id: r.id,
        kind: 'record',
        title,
        fields: cells
          .filter((c) => c.value !== title)
          .slice(0, 8)
          .map((c) => ({ label: c.label ?? '', value: c.value })),
        tap: { ref: ref('select', r.id) },
        menu: [{ title: 'More Options…', load: { ref: ref('context', r.id) } }],
      });
    }
    m.rows += rows.length;
    out.section();
    return;
  }

  out.section(n.name && !main ? n.name : undefined, main ? 'plain' : undefined);
  const depthOf = (r: Node) => {
    let d = 0;
    for (let p = r.parent; p && p !== n; p = p.parent) if (p.t === 'TreeItem') d++;
    return d;
  };
  for (const r of rows) {
    const item = listRow(r, headers, files, ctx, n.t === 'Tree' ? depthOf(r) : undefined);
    if (!main || n.t === 'Tree') delete item.menu;
    out.add(item);
  }
  m.rows += rows.length;
  if (n.raw.scr && n.raw.scr[1] === 1 && n.raw.scr[0] >= 0 && n.raw.scr[0] < 99.5 && main) {
    m.more = { ref: ref('more', n.id) };
  }
  out.section();
}
