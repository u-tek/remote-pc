import type { KeypadItem, KeypadKey } from '../schema.js';
import { ref } from '../uia.js';
import { symbolFor } from './icons.js';
import { findAll, isDisabled, type Node } from './tree.js';

/** Spoken names (Calculator, dial pads) → what the key shows. */
const GLYPHS: Array<[RegExp, string, KeypadKey['tone'], string?]> = [
  [/^(zero|0)$/i, '0', 'primary'],
  [/^(one|1)$/i, '1', 'primary'],
  [/^(two|2)$/i, '2', 'primary'],
  [/^(three|3)$/i, '3', 'primary'],
  [/^(four|4)$/i, '4', 'primary'],
  [/^(five|5)$/i, '5', 'primary'],
  [/^(six|6)$/i, '6', 'primary'],
  [/^(seven|7)$/i, '7', 'primary'],
  [/^(eight|8)$/i, '8', 'primary'],
  [/^(nine|9)$/i, '9', 'primary'],
  [/^[a-f]$/i, '', 'primary'],
  [/^(decimal separator|decimal point|point|\.|,)$/i, '.', 'primary'],
  [/^(equals|=|enter)$/i, '=', 'accent', 'equal'],
  [/^(plus|add|\+)$/i, '+', 'accent', 'plus'],
  [/^(minus|subtract|-|−)$/i, '−', 'accent', 'minus'],
  [/^(multiply( by)?|times|\*|×)$/i, '×', 'accent', 'multiply'],
  [/^(divide( by)?|\/|÷)$/i, '÷', 'accent', 'divide'],
  [/^(percent|%)$/i, '%', 'secondary', 'percent'],
  [/^(positive negative|plus minus|negate|±)$/i, '±', 'secondary', 'plus.forwardslash.minus'],
  [/^(backspace|delete|back)$/i, '⌫', 'secondary', 'delete.left'],
  [/^(clear entry|ce)$/i, 'CE', 'secondary'],
  [/^(clear|c|ac|all clear)$/i, 'C', 'secondary'],
  [/^(square root|√)$/i, '√x', 'secondary'],
  [/^(square|x²)$/i, 'x²', 'secondary'],
  [/^(cube)$/i, 'x³', 'secondary'],
  [/^(reciprocal|1\/x)$/i, '¹⁄ₓ', 'secondary'],
  [/^(open parenthesis|left parenthesis|\()$/i, '(', 'secondary'],
  [/^(close parenthesis|right parenthesis|\))$/i, ')', 'secondary'],
  [/^(pi|π)$/i, 'π', 'secondary'],
  [/^(star|asterisk)$/i, '*', 'primary'],
  [/^(pound|hash|#)$/i, '#', 'primary'],
];

export function keyFor(n: Node): KeypadKey {
  const name = n.name || n.raw.aid || '';
  for (const [re, glyph, tone, symbol] of GLYPHS) {
    if (re.test(name)) {
      const key: KeypadKey = {
        ref: ref('invoke', n.id),
        title: glyph || name.toUpperCase(),
        tone,
      };
      if (symbol && (glyph === '⌫' || glyph === '±')) key.symbol = symbol;
      if (isDisabled(n)) key.disabled = true;
      return key;
    }
  }
  // Memory keys and other short labels keep their text ("MC", "M+", "sin").
  const known = KNOWN[name.toLowerCase()];
  const short = known ?? (name.length <= 4 ? name : symbolFor(name, n.raw.aid) ? '' : abbreviate(name));
  const key: KeypadKey = {
    ref: ref('invoke', n.id),
    title: short || name,
    tone: 'secondary',
  };
  if (!short) key.symbol = symbolFor(name, n.raw.aid);
  if (isDisabled(n)) key.disabled = true;
  return key;
}

/** "Memory recall" → "MR", "Sine" → "sin" style abbreviations for long key names. */
const KNOWN: Record<string, string> = {
  'memory clear': 'MC',
  'clear all memory': 'MC',
  'memory recall': 'MR',
  'memory add': 'M+',
  'memory subtract': 'M−',
  'memory store': 'MS',
  'open memory flyout': 'M˅',
  memory: 'M˅',
  sine: 'sin',
  cosine: 'cos',
  tangent: 'tan',
  logarithm: 'log',
  'natural log': 'ln',
  exponential: 'exp',
  factorial: 'n!',
  'x to the exponent': 'xʸ',
};

function abbreviate(name: string): string {
  const words = name.split(/\s+/);
  return words.length > 1
    ? words
        .map((w) => w[0])
        .join('')
        .toUpperCase()
        .slice(0, 3)
    : name.slice(0, 5);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

/** Group positions into clusters (rows or columns) with the given tolerance. */
function clusters(values: number[], tolerance: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const centers: number[] = [];
  for (const v of sorted) {
    const last = centers[centers.length - 1];
    if (last === undefined || v - last > tolerance) centers.push(v);
  }
  return centers;
}

const nearest = (centers: number[], v: number) => {
  let best = 0;
  for (let i = 1; i < centers.length; i++) if (Math.abs(centers[i] - v) < Math.abs(centers[best] - v)) best = i;
  return best;
};

export interface KeypadMatch {
  item: KeypadItem;
  /** Buttons placed on the keypad. */
  keys: Node[];
  /** Same-area buttons that did not fit the grid (memory row etc.). */
  extras: Node[];
}

/**
 * A grid of similar buttons (calculator, dial pad) becomes a keypad with the original layout.
 * Needs at least 4 rows × 3 columns of similarly sized buttons, mostly digits/operators.
 */
export function detectKeypad(container: Node, used: Set<Node>): KeypadMatch | undefined {
  const buttons = findAll(container, (n) => n.t === 'Button' && n.w > 0 && n.h > 0 && !used.has(n), {
    into: (n) => n.t !== 'Button' && n.t !== 'ToolBar' && n.t !== 'MenuBar' && !used.has(n),
  });
  if (buttons.length < 12) return undefined;
  const digits = buttons.filter((b) => GLYPHS.slice(0, 10).some(([re]) => re.test(b.name))).length;
  if (digits < 10) return undefined;

  const mw = median(buttons.map((b) => b.w));
  const mh = median(buttons.map((b) => b.h));
  const similar = (b: Node) => b.h >= mh * 0.7 && b.h <= mh * 1.4 && b.w >= mw * 0.6;
  const keys = buttons.filter(similar);
  const extras = buttons.filter((b) => !similar(b));

  const cols = clusters(
    keys.map((b) => b.x),
    mw * 0.4,
  );
  const rows = clusters(
    keys.map((b) => b.y),
    mh * 0.4,
  );
  if (rows.length < 4 || cols.length < 3) return undefined;
  if (keys.length < rows.length * cols.length * 0.6) return undefined;

  const grid: Array<Array<KeypadKey | null>> = rows.map(() => cols.map(() => null));
  const placed: Node[] = [];
  for (const b of keys) {
    const r = nearest(rows, b.y);
    const c = nearest(cols, b.x);
    if (grid[r][c]) continue;
    const key = keyFor(b);
    const span = Math.max(1, Math.round(b.w / mw));
    if (span > 1) key.span = Math.min(span, cols.length - c);
    grid[r][c] = key;
    placed.push(b);
  }
  // Remove cells covered by a wider key so rows add up.
  for (const row of grid) {
    for (let c = 0; c < row.length; c++) {
      const span = row[c]?.span ?? 1;
      for (let k = 1; k < span && row[c + 1] === null; k++) row.splice(c + 1, 1);
    }
  }
  return {
    item: { id: `keypad-${container.id}`, kind: 'keypad', rows: grid },
    keys: placed,
    extras,
  };
}
