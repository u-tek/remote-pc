import type { Rewritten } from '../rules/build.js';
import { mapContent, type MapContext, type Mapped } from '../rules/map.js';
import { area, findAll, type Node } from '../rules/tree.js';
import type { Action, Icon, MenuItem } from '../schema.js';
import { ref } from '../uia.js';
import { symbolFor } from '../rules/icons.js';

/** Map one part of the window with the generic rules (fresh "used" set). */
export function mapNode(base: Rewritten, node: Node, extra: Partial<MapContext> = {}): Mapped {
  return mapContent(node, { ...base.source.ctx, used: new Set(), ...extra });
}

export function first(root: Node, pred: (n: Node) => boolean): Node | undefined {
  return findAll(root, pred)[0];
}

export function largest(root: Node, pred: (n: Node) => boolean): Node | undefined {
  return findAll(root, pred).sort((a, b) => area(b) - area(a))[0];
}

/** A button whose name (or automation id) matches. */
export function button(root: Node, re: RegExp): Node | undefined {
  return first(root, (n) => (n.t === 'Button' || n.t === 'SplitButton' || n.t === 'MenuItem') && (re.test(n.name) || re.test(n.raw.aid ?? '')));
}

export function action(n: Node | undefined, kind = 'invoke', extra: Partial<Action> = {}): Action | undefined {
  if (!n) return undefined;
  const a: Action = { ref: ref(kind, n.id), title: n.name || undefined, ...extra };
  const symbol = extra.symbol ?? symbolFor(n.name, n.raw.aid);
  if (symbol) a.symbol = symbol;
  if (n.raw.dis === 1) a.disabled = true;
  return a;
}

export function picture(base: Rewritten, n: Node | undefined, style: Icon['style'] = 'plain'): Icon | undefined {
  if (!n || n.w <= 0 || n.h <= 0) return undefined;
  return { image: base.source.ctx.imageUrl(n), style };
}

/** Commands in a container as menu entries (ribbon groups, toolbars). */
export function commandMenu(container: Node, limit = 30): MenuItem[] {
  const nodes = findAll(
    container,
    (n) => ['Button', 'SplitButton', 'CheckBox', 'MenuItem', 'RadioButton'].includes(n.t) && Boolean(n.name) && n.raw.off !== 1,
    { into: (n) => !['Button', 'SplitButton', 'MenuItem'].includes(n.t) },
  );
  return nodes.slice(0, limit).map((n) => {
    const item: MenuItem = { title: n.name };
    const symbol = symbolFor(n.name, n.raw.aid);
    if (symbol) item.symbol = symbol;
    if (n.raw.tog !== undefined) {
      item.checked = n.raw.tog === 1;
      item.action = { ref: ref('toggle', n.id) };
    } else if (n.t === 'SplitButton' || (n.raw.exp !== undefined && n.raw.exp !== 3 && n.raw.inv !== 1)) {
      item.action = { ref: ref('expand', n.id) };
    } else {
      item.action = { ref: ref('invoke', n.id) };
    }
    if (n.raw.dis === 1) item.disabled = true;
    return item;
  });
}

/** Full URL from what a browser address bar shows ("github.com/x" → "https://github.com/x"). */
export function fullUrl(shown: string): string {
  const s = shown.trim();
  if (!s) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  return `https://${s}`;
}
