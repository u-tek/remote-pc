import type { UNode, USnapshot } from '../../../src/ui/uia.js';

/** Tiny builder for hand-written UI Automation trees shaped like real captures. */
let seq = 0;

export function el(t: string, n: string | undefined, r: [number, number, number, number], props: Partial<UNode> = {}, c: UNode[] = []): UNode {
  const node: UNode = { id: `42.${++seq}`, t, r, ...props };
  if (n !== undefined) node.n = n;
  if (c.length) node.c = c;
  return node;
}

export function win(process: string, title: string, size: [number, number], kids: UNode[], extra: Partial<USnapshot> = {}): USnapshot {
  return {
    hwnd: 1000 + seq,
    pid: 4000,
    process,
    title,
    cls: 'Window',
    rect: [100, 100, size[0], size[1]],
    root: el('Window', title, [0, 0, size[0], size[1]], {}, [
      el('TitleBar', '', [0, 0, size[0], 32], {}, [el('Button', 'Close', [size[0] - 46, 0, 46, 32], { inv: 1 })]),
      ...kids,
    ]),
    popups: [],
    ...extra,
  };
}

/** Lay out buttons in a grid starting at (x, y). */
export function grid(names: string[][], x: number, y: number, w: number, h: number, props: Partial<UNode> = {}): UNode[] {
  const out: UNode[] = [];
  names.forEach((row, r) =>
    row.forEach((name, c) =>
      out.push(
        el('Button', name, [x + c * w, y + r * h, w - 2, h - 2], {
          inv: 1,
          ...props,
        }),
      ),
    ),
  );
  return out;
}
