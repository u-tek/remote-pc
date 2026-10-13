import { documentTitle, truncate } from '../rules/text.js';
import { findAll, isSelected, type Node } from '../rules/tree.js';
import type { Action, Item, Screen } from '../schema.js';
import { ref } from '../uia.js';
import { action, button, first, fullUrl, largest, mapNode, picture } from './kit.js';
import type { Adapter } from './types.js';

const BROWSERS = /^(chrome|msedge|brave|vivaldi|opera|firefox|arc|thorium|chromium|waterfox|librewolf|floorp)$/i;
const ADDRESS =
  /address and search bar|search or (enter|type) (an )?(address|url|web address)|enter address|address bar|search with .+ or enter address|^address$/i;
const WEB = new Set(['Chrome', 'Gecko']);

interface BrowserParts {
  address?: Node;
  doc?: Node;
  tabs: Node[];
  back?: Node;
  forward?: Node;
  reload?: Node;
  newTab?: Node;
  menu?: Node;
}

function parts(root: Node, W: number): BrowserParts {
  const address = first(
    root,
    (n) => (n.t === 'Edit' || n.t === 'ComboBox') && (ADDRESS.test(n.name) || /urlbar|addressEditBox|omnibox/i.test(n.raw.aid ?? '')),
  );
  const doc = largest(root, (n) => n.t === 'Document' && WEB.has(n.raw.fw ?? '') && n.w >= W * 0.3);
  const top = (n: Node) => !doc || n.y < doc.y + 4;
  const tabs = findAll(root, (n) => n.t === 'TabItem' && Boolean(n.name) && top(n), { into: (n) => n.t !== 'TabItem' && n.t !== 'Document' });
  const btn = (re: RegExp) => {
    const b = button(root, re);
    return b && top(b) ? b : undefined;
  };
  return {
    address,
    doc,
    tabs,
    back: btn(/^(back|go back)\b/i),
    forward: btn(/^(forward|go forward)\b/i),
    reload: btn(/^(reload|refresh)\b/i),
    newTab: btn(/^new tab\b/i),
    menu: btn(/customize and control|settings and more|open application menu|^(chrome|menu|app menu)$/i),
  };
}

/** Chrome, Edge, Firefox…: the page as a native article with Safari-style controls. */
export const browser: Adapter = {
  id: 'browser',
  label: 'Browser',
  startInPage: true,
  matches: (w) => BROWSERS.test(w.process),

  view(snap, base, ctx) {
    const root = base.source.root;
    const p = parts(root, snap.rect[2]);
    if (!p.doc && !p.address) return base;
    const shown = p.address?.raw.val ?? p.doc?.raw.val ?? '';
    const url = fullUrl(shown);
    const selectedTab = p.tabs.find(isSelected);
    const title = p.doc?.name || selectedTab?.name || documentTitle(snap.title, base.app.name);

    const sections = p.doc ? mapNode(base, p.doc).sections : base.page.sections;
    const bottomBar: Action[] = [];
    const add = (a: Action | undefined) => a && bottomBar.push(a);
    add(action(p.back, 'invoke', { symbol: 'chevron.backward', title: 'Back' }));
    add(action(p.forward, 'invoke', { symbol: 'chevron.forward', title: 'Forward' }));
    if (url) bottomBar.push({ ref: `phone:share?url=${encodeURIComponent(url)}`, symbol: 'square.and.arrow.up', title: 'Share' });
    if (p.tabs.length) bottomBar.push({ ref: 'browser-tabs', symbol: 'square.on.square', title: `${p.tabs.length}` });
    add(action(p.newTab, 'invoke', { symbol: 'plus', title: 'New Tab' }));

    const page: Screen = {
      id: `browser:${url || title}`,
      title: truncate(title, 60),
      style: 'browser',
      sections,
      bottomBar,
      refresh: action(p.reload, 'invoke', { title: 'Reload' }),
      menu: [
        ...(url ? [{ title: 'Open on iPhone', symbol: 'safari', action: { ref: `phone:open?url=${encodeURIComponent(url)}` } }] : []),
        ...(url ? [{ title: 'Copy Link', symbol: 'link', action: { ref: `phone:copy?text=${encodeURIComponent(url)}` } }] : []),
        { title: 'Find on Page', symbol: 'magnifyingglass', action: { ref: 'browser-find' } },
        ...(p.menu ? [{ title: `${base.app.name} Menu`, symbol: 'ellipsis.circle', action: { ref: ref('invoke', p.menu.id) } }] : []),
      ],
    };
    if (p.address) page.address = { value: shown, ref: ref('browser-go', p.address.id), secure: !/^http:/i.test(url), title };
    if (sections.length === 0) page.empty = { title: 'Loading…', symbol: 'globe' };

    const out = { ...base, home: undefined, trail: [], page, up: p.back && p.back.raw.dis !== 1 ? { ref: ref('invoke', p.back.id) } : undefined };
    if (ctx.state.showTabs) out.sheet = tabsSheet(base, p);
    return out;
  },

  async action(a, value, ctx) {
    const hwnd = ctx.hwnd;
    const b = ctx.backend;
    switch (a.kind) {
      case 'browser-go': {
        const text = String(value ?? '').trim();
        if (!text) return true;
        await b.act(hwnd, a.id, 'setValue', text);
        await b.act(hwnd, a.id, 'submit');
        return true;
      }
      case 'browser-tabs':
        ctx.state.showTabs = true;
        return true;
      case 'browser-tabs-done':
      case 'dismiss':
        if (!ctx.state.showTabs) return false;
        ctx.state.showTabs = false;
        return true;
      case 'browser-tab':
        ctx.state.showTabs = false;
        await b.act(hwnd, a.id, 'select').catch(() => b.act(hwnd, a.id, 'click'));
        return true;
      case 'browser-find':
        // Ctrl+F opens the browser's find bar, which then appears as a native field.
        await b.windowKeys(hwnd, [0x11, 0x46]);
        return true;
      default:
        return false;
    }
  },
};

function tabsSheet(base: Parameters<Adapter['view']>[1], p: BrowserParts): Screen {
  const items: Item[] = p.tabs.map((t) => {
    const close = first(t, (k) => k.t === 'Button' && /close/i.test(k.name));
    const icon = picture(
      base,
      first(t, (k) => k.t === 'Image' && k.w <= 32),
    );
    return {
      id: t.id,
      kind: 'item',
      title: truncate(t.name.replace(/\s*-\s*(memory usage|audio playing).*$/i, ''), 80),
      icon: icon ?? { symbol: 'globe', color: 'gray', style: 'plain' },
      selected: isSelected(t) || undefined,
      checked: isSelected(t) || undefined,
      tap: { ref: ref('browser-tab', t.id) },
      swipe: close ? [{ ref: ref('invoke', close.id), title: 'Close', symbol: 'xmark', role: 'destructive' }] : undefined,
    };
  });
  const actions: Action[] = [{ ref: 'browser-tabs-done', title: 'Done', role: 'primary' }];
  if (p.newTab) actions.unshift({ ref: ref('invoke', p.newTab.id), title: 'New Tab', symbol: 'plus' });
  return { id: 'local:tabs', title: `${p.tabs.length} Tab${p.tabs.length === 1 ? '' : 's'}`, style: 'list', sections: [{ id: 'tabs', items }], actions };
}
