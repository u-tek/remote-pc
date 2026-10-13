/**
 * Windows UI Automation snapshot, as produced by the UI helper (assets/ui.cs).
 * Keys are short because whole window trees are sent several times a second.
 */
export interface UNode {
  /** UIA runtime id joined with dots; stable while the element exists. */
  id: string;
  /** Control type without the "ControlType." prefix: Button, Edit, List, ListItem, … */
  t: string;
  n?: string;
  /** AutomationId */
  aid?: string;
  /** ClassName */
  cls?: string;
  /** FrameworkId: Win32, WinForm, WPF, XAML, DirectUI, Chrome, … */
  fw?: string;
  /** LocalizedControlType, e.g. "heading", "link", "toggle switch", "navigation". */
  lct?: string;
  /** Bounding rectangle relative to the window: x, y, width, height (physical pixels). */
  r?: [number, number, number, number];
  dis?: 1;
  off?: 1;
  /** has keyboard focus */
  foc?: 1;
  /** keyboard focusable */
  kf?: 1;
  pw?: 1;
  help?: string;
  /** ItemStatus */
  st?: string;
  acc?: string;
  // Patterns that are available, with their state.
  inv?: 1;
  /** ValuePattern value ('' when the pattern exists but is empty). */
  val?: string;
  ro?: 1;
  /** TogglePattern state: 0 off, 1 on, 2 indeterminate. */
  tog?: 0 | 1 | 2;
  /** SelectionItemPattern: 1 selected, 0 not selected. */
  sel?: 0 | 1;
  /** ExpandCollapseState: 0 collapsed, 1 expanded, 2 partial, 3 leaf. */
  exp?: 0 | 1 | 2 | 3;
  /** RangeValuePattern: min, max, value, small change. */
  rng?: [number, number, number, number];
  rro?: 1;
  /** ScrollPattern: vertical percent (-1 none), vertically scrollable 0/1. */
  scr?: [number, 0 | 1];
  /** ScrollItemPattern available. */
  si?: 1;
  /** TextPattern available. */
  txt?: 1;
  /** Text content for documents (TextPattern), capped. */
  tx?: string;
  /** GridPattern rows, columns. */
  grid?: [number, number];
  /** SelectionPattern allows multiple selection. */
  multi?: 1;
  /** WindowPattern: modal. */
  modal?: 1;
  /** Heading level 1–9 (web content and newer frameworks). */
  lvl?: number;
  /** IsDialog / default button hints from the framework. */
  dlg?: 1;
  c?: UNode[];
}

export interface USnapshot {
  hwnd: number;
  pid: number;
  /** Process image name without extension, e.g. "chrome", "explorer", "WINWORD". */
  process: string;
  /** Full path of the process executable when known. */
  path?: string;
  title: string;
  cls: string;
  /** Window rectangle on screen. */
  rect: [number, number, number, number];
  root: UNode;
  /** Other top-level windows of the same process: menus, dropdowns, dialogs (rects relative to the main window). */
  popups: UNode[];
  /** Node budget was hit; the deepest parts of the tree are missing. */
  truncated?: boolean;
  /** Milliseconds the helper spent capturing. */
  ms?: number;
}

/** UI Automation operations the helper can perform on an element. */
export type UiaOp =
  | 'invoke'
  | 'toggle'
  | 'select'
  | 'expand'
  | 'collapse'
  | 'setValue'
  | 'setRange'
  | 'focus'
  | 'scrollIntoView'
  | 'scroll'
  | 'click'
  | 'dclick'
  | 'rclick'
  | 'type';

/**
 * Action refs produced by the rules engine. Format: `kind:nodeId[:extra]`.
 * kinds: UiaOp names, plus engine-level ones (nav, drill, page, combo, menu, send, doc, back, tab).
 */
export function ref(kind: string, nodeId: string, extra?: string): string {
  return extra === undefined ? `${kind}:${nodeId}` : `${kind}:${nodeId}:${extra}`;
}

export function parseRef(r: string): {
  kind: string;
  id: string;
  extra?: string;
} {
  const first = r.indexOf(':');
  if (first < 0) return { kind: r, id: '' };
  const kind = r.slice(0, first);
  const rest = r.slice(first + 1);
  const second = rest.indexOf(':');
  if (second < 0) return { kind, id: rest };
  return { kind, id: rest.slice(0, second), extra: rest.slice(second + 1) };
}
