import { findAll, type Node } from '../rules/tree.js';
import type { Item, MenuItem, Screen } from '../schema.js';
import type { Adapter } from './types.js';

const PATHLIKE = /^([a-z]:\\|\\\\)/i;

/** The folder shown, from the breadcrumb bar ("Address: C:\Users\Alex\Documents"). */
function folderPath(root: Node): string | undefined {
  for (const n of findAll(root, (k) => k.t === 'ToolBar' || k.t === 'Pane' || k.t === 'Edit' || k.t === 'SplitButton')) {
    const m = /^address:\s*(.+)$/i.exec(n.name);
    const candidate = m?.[1] ?? (n.t === 'Edit' && /address/i.test(n.name) ? n.raw.val : undefined);
    if (candidate && PATHLIKE.test(candidate.trim())) return candidate.trim().replace(/\\$/, '');
  }
  return undefined;
}

function withPhoneActions(item: Item, folder: string | undefined): Item {
  if (item.kind !== 'item' || !folder) return item;
  const isDir = item.icon?.symbol === 'folder.fill';
  const path = `${folder}\\${item.title}`;
  const extra: MenuItem[] = isDir
    ? []
    : [
        { title: 'Save to iPhone', symbol: 'square.and.arrow.down', action: { ref: `phone:download?path=${encodeURIComponent(path)}` } },
        { title: 'Share…', symbol: 'square.and.arrow.up', action: { ref: `phone:share-file?path=${encodeURIComponent(path)}` } },
      ];
  extra.push({ title: 'Copy Path', symbol: 'doc.on.doc', action: { ref: `phone:copy?text=${encodeURIComponent(path)}` } });
  return { ...item, chevron: isDir || undefined, menu: [...(item.menu ?? []).slice(0, 1), ...extra, ...(item.menu ?? []).slice(1)] };
}

/** File Explorer: folder sidebar, the folder's files, and save-to-phone on every file. */
export const explorer: Adapter = {
  id: 'explorer',
  label: 'File Explorer',
  startInPage: true,
  matches: (w) =>
    w.process.toLowerCase() === 'explorer' &&
    w.title !== 'Program Manager' &&
    (w.cls === undefined || w.cls === 'CabinetWClass' || /file explorer/i.test(w.title)),

  view(_snap, base) {
    const folder = folderPath(base.source.root);
    const page: Screen = {
      ...base.page,
      sections: base.page.sections.map((s) => ({ ...s, items: s.items.map((i) => withPhoneActions(i, folder)) })),
    };
    if (folder) page.subtitle = folder;
    if (page.empty) page.empty = { title: 'This folder is empty', symbol: 'folder' };
    return { ...base, page };
  },
};
