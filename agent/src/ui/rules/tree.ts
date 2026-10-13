import type { UNode } from '../uia.js';
import { cleanName } from './text.js';

/** A UIA node with parent links and a cleaned-up name, used by all the rules. */
export interface Node {
  raw: UNode;
  id: string;
  t: string;
  name: string;
  parent?: Node;
  kids: Node[];
  depth: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function prepare(raw: UNode, parent?: Node): Node {
  const [x, y, w, h] = raw.r ?? [0, 0, 0, 0];
  const node: Node = {
    raw,
    id: raw.id,
    t: raw.t,
    name: cleanName(raw.n ?? ''),
    parent,
    kids: [],
    depth: parent ? parent.depth + 1 : 0,
    x,
    y,
    w,
    h,
  };
  node.kids = (raw.c ?? []).map((c) => prepare(c, node));
  return node;
}

export function walk(node: Node, fn: (n: Node) => boolean | void): void {
  if (fn(node) === false) return;
  for (const k of node.kids) walk(k, fn);
}

export function findAll(node: Node, pred: (n: Node) => boolean, opts: { into?: (n: Node) => boolean } = {}): Node[] {
  const out: Node[] = [];
  const visit = (n: Node) => {
    if (pred(n)) out.push(n);
    if (opts.into && !opts.into(n)) return;
    for (const k of n.kids) visit(k);
  };
  for (const k of node.kids) visit(k);
  return out;
}

export function find(node: Node, pred: (n: Node) => boolean): Node | undefined {
  for (const k of node.kids) {
    if (pred(k)) return k;
    const deep = find(k, pred);
    if (deep) return deep;
  }
  return undefined;
}

export function ancestors(node: Node): Node[] {
  const out: Node[] = [];
  for (let p = node.parent; p; p = p.parent) out.push(p);
  return out;
}

export function isInside(node: Node, container: Node): boolean {
  for (let p: Node | undefined = node; p; p = p.parent) if (p === container) return true;
  return false;
}

/** All names of Text descendants, in order. */
export function texts(node: Node): string[] {
  const out: string[] = [];
  walk(node, (n) => {
    if (n !== node && n.t === 'Text' && n.name) out.push(n.name);
  });
  return out;
}

export function count(node: Node, pred: (n: Node) => boolean): number {
  let c = 0;
  walk(node, (n) => {
    if (n !== node && pred(n)) c++;
  });
  return c;
}

export const area = (n: Node) => Math.max(0, n.w) * Math.max(0, n.h);
export const cx = (n: Node) => n.x + n.w / 2;
export const cy = (n: Node) => n.y + n.h / 2;

// ---- pattern helpers ----
export const canInvoke = (n: Node) => n.raw.inv === 1;
export const hasToggle = (n: Node) => n.raw.tog !== undefined;
export const hasValue = (n: Node) => n.raw.val !== undefined;
export const hasRange = (n: Node) => n.raw.rng !== undefined;
export const isSelectable = (n: Node) => n.raw.sel !== undefined;
export const isSelected = (n: Node) => n.raw.sel === 1;
export const isExpandable = (n: Node) => n.raw.exp !== undefined && n.raw.exp !== 3;
export const isDisabled = (n: Node) => n.raw.dis === 1;
export const isOffscreen = (n: Node) => n.raw.off === 1;
export const isWeb = (n: Node) => n.raw.fw === 'Chrome';
export const lct = (n: Node) => (n.raw.lct ?? '').toLowerCase();

/** Interactive in any way. */
export function isActionable(n: Node): boolean {
  const r = n.raw;
  return r.inv === 1 || r.tog !== undefined || r.sel !== undefined || (r.exp !== undefined && r.exp !== 3) || r.val !== undefined || r.rng !== undefined;
}

const INPUT_TYPES = new Set(['Edit', 'ComboBox', 'Slider', 'Spinner', 'CheckBox', 'RadioButton']);
export const isInput = (n: Node) => INPUT_TYPES.has(n.t) || (n.t === 'Button' && hasToggle(n));
