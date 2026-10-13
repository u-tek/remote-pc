import { isActionable, type Node } from './tree.js';

const DROP_TYPES = new Set(['TitleBar', 'ScrollBar', 'Thumb', 'ToolTip']);
const CAPTION_BUTTON = /^(minimi[sz]e|maximi[sz]e|restore( down)?|close|help|system menu)$/i;
/** The phone shows an app's navigation as its home list, so the hamburger toggle is redundant. */
const NAV_TOGGLE = /^((open|close|expand|collapse|toggle) )?(navigation|nav pane|navigation pane|menu|hamburger)( (button|menu))?$/i;
const WRAPPER_TYPES = new Set(['Pane', 'Group', 'Custom']);
/** Rows that are often offscreen or zero-sized but still meaningful. */
const ROW_TYPES = new Set(['ListItem', 'TreeItem', 'DataItem', 'MenuItem', 'TabItem', 'HeaderItem']);
/** Containers whose images are icons worth keeping even without a name. */
const ICON_HOSTS = new Set(['ListItem', 'TreeItem', 'DataItem', 'Button', 'TabItem', 'MenuItem', 'SplitButton', 'Hyperlink']);

function insideType(n: Node, types: Set<string>): boolean {
  for (let p = n.parent; p; p = p.parent) if (types.has(p.t)) return true;
  return false;
}

function isCaptionButton(n: Node, winW: number): boolean {
  if (n.t !== 'Button' || !CAPTION_BUTTON.test(n.name)) return false;
  if (n.parent?.t === 'TitleBar') return true;
  return n.y < 48 && n.x > winW * 0.6;
}

/**
 * Remove window chrome and visual noise, and collapse anonymous wrapper panes, so the
 * remaining tree is close to "what a person would describe". Mutates and returns the tree.
 */
export function prune(root: Node, winW: number): Node {
  const visit = (n: Node): Node | null => {
    n.kids = n.kids.map(visit).filter((k): k is Node => k !== null);
    for (const k of n.kids) k.parent = n;
    if (n === root) return n;

    if (DROP_TYPES.has(n.t)) return null;
    if (n.t === 'MenuBar' && /system/i.test(`${n.name} ${n.raw.aid ?? ''}`)) return null;
    if (isCaptionButton(n, winW)) return null;
    if (n.t === 'Button' && NAV_TOGGLE.test(n.name) && n.x < winW * 0.2) return null;
    if (n.t === 'Separator') return insideType(n, new Set(['Menu', 'MenuBar', 'ToolBar'])) ? n : null;

    const hasSize = n.w > 0 && n.h > 0;
    if (!hasSize && n.kids.length === 0 && !ROW_TYPES.has(n.t) && !isActionable(n)) return null;

    if (n.t === 'Image' && !n.name && !insideType(n, ICON_HOSTS)) return null;
    if (n.t === 'Text' && !n.name) return null;
    // A label repeating its parent's name adds nothing.
    if (n.t === 'Text' && n.parent && n.name === n.parent.name && n.parent.t !== 'Group' && n.parent.t !== 'Pane') return null;

    if (WRAPPER_TYPES.has(n.t) || (n.t === 'Document' && n.raw.fw !== 'Chrome' && !n.raw.txt)) {
      const empty = n.kids.length === 0 && !n.name && !isActionable(n);
      if (empty && n.w * n.h < 40_000) return null;
      // Anonymous single-child wrapper: replace it with its child.
      if (n.kids.length === 1 && !n.name && !isActionable(n) && WRAPPER_TYPES.has(n.t)) {
        const only = n.kids[0];
        only.parent = n.parent;
        return only;
      }
    }
    return n;
  };
  visit(root);
  return root;
}
