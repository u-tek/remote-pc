import type { Rewritten } from '../rules/build.js';
import { isTimeLike, truncate } from '../rules/text.js';
import { findAll, isSelected, texts, type Node } from '../rules/tree.js';
import type { Action, Item, ListItem, MenuItem, RecordItem, Screen, Section } from '../schema.js';
import type { USnapshot } from '../uia.js';
import { ref } from '../uia.js';
import { action, button, commandMenu, first, largest, mapNode, picture } from './kit.js';
import type { Adapter } from './types.js';

const OFFICE = /^(winword|excel|powerpnt|outlook|olk|onenote)$/i;

/** The ribbon as menus: the open tab's groups, and a picker for the other tabs. */
function ribbonMenu(root: Node): { menu: MenuItem[]; consumed: Node[] } {
  const ribbon = first(root, (n) => /ribbon/i.test(`${n.name} ${n.raw.aid ?? ''}`) && ['Pane', 'ToolBar', 'Group', 'Custom', 'Tab'].includes(n.t));
  if (!ribbon) return { menu: [], consumed: [] };
  const tabs = findAll(ribbon, (n) => n.t === 'TabItem' && Boolean(n.name));
  const groups = findAll(ribbon, (n) => n.t === 'Group' && Boolean(n.name) && n.raw.off !== 1, { into: (n) => n.t !== 'Group' });
  const menu: MenuItem[] = groups.map((g) => ({ title: g.name, children: commandMenu(g, 24) })).filter((g) => g.children.length > 0);
  if (tabs.length) {
    menu.push({
      title: 'Ribbon',
      symbol: 'menubar.rectangle',
      children: tabs.map((t) => ({ title: t.name, checked: isSelected(t) || undefined, action: { ref: ref('select', t.id) } })),
    });
  }
  return { menu, consumed: [ribbon] };
}

function formatBar(root: Node): Action[] {
  const want: Array<[RegExp, string]> = [
    [/^bold\b/i, 'bold'],
    [/^italic\b/i, 'italic'],
    [/^underline\b/i, 'underline'],
    [/^bullets\b/i, 'list.bullet'],
    [/^undo\b/i, 'arrow.uturn.backward'],
  ];
  const out: Action[] = [];
  for (const [re, symbol] of want) {
    const b = button(root, re) ?? first(root, (n) => n.t === 'CheckBox' && re.test(n.name));
    if (!b) continue;
    out.push({
      ref: ref(b.raw.tog !== undefined ? 'toggle' : 'invoke', b.id),
      symbol,
      title: b.name.replace(/\s*\(.*\)$/, ''),
      role: b.raw.tog === 1 ? 'primary' : undefined,
    });
  }
  return out;
}

function word(snap: USnapshot, base: Rewritten): Rewritten {
  const root = base.source.root;
  const doc = largest(root, (n) => (n.t === 'Document' || n.t === 'Edit') && (n.raw.txt === 1 || n.raw.tx !== undefined) && n.h >= 120);
  if (!doc) return base;
  const { menu } = ribbonMenu(root);
  const page: Screen = {
    id: `word:${base.page.title}`,
    title: base.page.title,
    style: 'document',
    sections: [],
    // Word documents are rich text: typing goes to the cursor instead of replacing the text.
    document: { text: doc.raw.tx ?? doc.raw.val ?? texts(doc).join('\n'), typeRef: ref('type', doc.id), format: 'plain' },
    bottomBar: formatBar(root),
    menu: [...menu, ...(base.page.menu ?? [])],
  };
  void snap;
  return { ...base, home: undefined, page };
}

const CELL = /^([A-Z]{1,3})(\d{1,7})$/;

function excel(_snap: USnapshot, base: Rewritten): Rewritten {
  const root = base.source.root;
  const grid = largest(root, (n) => (n.t === 'DataGrid' || n.t === 'Table') && findAll(n, (k) => k.t === 'DataItem').length > 0);
  if (!grid) return base;
  const rows = new Map<number, Array<{ col: string; value: string; node: Node }>>();
  for (const cell of findAll(grid, (k) => k.t === 'DataItem')) {
    const m = CELL.exec(cell.name.split(/\s/)[0]);
    if (!m) continue;
    const value = cell.raw.val ?? '';
    const row = Number(m[2]);
    if (!rows.has(row)) rows.set(row, []);
    if (value !== '') rows.get(row)!.push({ col: m[1], value, node: cell });
  }
  const records: Item[] = [...rows.entries()]
    .filter(([, cells]) => cells.length > 0)
    .sort((a, b) => a[0] - b[0])
    .map(
      ([row, cells]): RecordItem => ({
        id: `row-${row}`,
        kind: 'record',
        title: `Row ${row}`,
        fields: cells.slice(0, 12).map((c) => ({ label: c.col, value: truncate(c.value, 80) })),
        tap: { ref: ref('select', cells[0].node.id) },
      }),
    );
  const formula = first(root, (n) => n.t === 'Edit' && /formula bar/i.test(n.name));
  const nameBox = first(root, (n) => (n.t === 'Edit' || n.t === 'ComboBox') && /name box/i.test(n.name));
  const selected = findAll(grid, (k) => k.t === 'DataItem' && isSelected(k))[0];
  const sections: Section[] = [];
  if (formula) {
    sections.push({
      id: 'cell',
      header: selected?.name.split(/\s/)[0] ?? nameBox?.raw.val ?? 'Cell',
      items: [
        {
          id: formula.id,
          kind: 'field',
          title: 'fx',
          value: formula.raw.val ?? '',
          ref: ref('setValue', formula.id),
          submit: { ref: ref('submit', formula.id), title: 'Enter' },
        },
      ],
    });
  }
  sections.push({ id: 'rows', style: 'cards', items: records });
  const sheets = findAll(root, (n) => n.t === 'TabItem' && /^sheet|\w/i.test(n.name) && n.y > grid.y);
  const page: Screen = {
    id: `excel:${base.page.title}`,
    title: base.page.title,
    style: 'list',
    sections,
    menu: [...ribbonMenu(root).menu, ...(base.page.menu ?? [])],
  };
  if (sheets.length >= 2)
    page.segments = { items: sheets.slice(0, 5).map((s) => ({ id: s.id, title: s.name, ref: ref('select', s.id) })), selected: sheets.find(isSelected)?.id };
  if (records.length === 0) page.empty = { title: 'Empty sheet', symbol: 'tablecells' };
  return { ...base, home: undefined, page };
}

function powerpoint(snap: USnapshot, base: Rewritten): Rewritten {
  const root = base.source.root;
  const thumbs = findAll(root, (n) => n.t === 'ListItem' && /^slide \d+/i.test(n.name));
  const slide = largest(
    root,
    (n) =>
      (n.t === 'Pane' || n.t === 'Document' || n.t === 'Group' || n.t === 'Custom') &&
      /slide/i.test(n.name) &&
      !/thumbnail/i.test(n.name) &&
      n.w > snap.rect[2] * 0.35,
  );
  const notes = first(root, (n) => (n.t === 'Edit' || n.t === 'Document') && /notes/i.test(n.name));
  const sections: Section[] = [];
  if (slide)
    sections.push({ id: 'slide', items: [{ id: slide.id, kind: 'image', image: base.source.ctx.imageUrl(slide), aspect: slide.w / Math.max(1, slide.h) }] });
  if (notes)
    sections.push({
      id: 'notes',
      header: 'Notes',
      items: [
        {
          id: notes.id,
          kind: 'field',
          value: notes.raw.val ?? notes.raw.tx ?? '',
          multiline: true,
          placeholder: 'Tap to add notes',
          ref: ref(notes.raw.val !== undefined ? 'setValue' : 'type', notes.id),
        },
      ],
    });
  if (thumbs.length) {
    sections.push({
      id: 'slides',
      header: 'Slides',
      style: 'grid',
      items: thumbs.map((t) => ({
        id: t.id,
        kind: 'tile',
        title: t.name.replace(/^slide (\d+).*$/i, 'Slide $1'),
        image: picture(base, t)?.image,
        tap: { ref: ref('select', t.id) },
      })),
    });
  }
  if (!sections.length) return base;
  const prev = button(root, /^previous( slide)?$/i);
  const next = button(root, /^next( slide)?$/i);
  const bottomBar = [action(prev, 'invoke', { symbol: 'chevron.left' }), action(next, 'invoke', { symbol: 'chevron.right' })].filter((a): a is Action =>
    Boolean(a),
  );
  const page: Screen = {
    id: `ppt:${base.page.title}`,
    title: base.page.title,
    style: 'form',
    sections,
    menu: [...ribbonMenu(root).menu, ...(base.page.menu ?? [])],
  };
  if (bottomBar.length) page.bottomBar = bottomBar;
  return { ...base, home: undefined, page };
}

const OUTLOOK_FIELDS = /\b(From|Subject|Received|Sent|Size|Categories|Mention|Flag Status|Attachments?|Importance|Preview|Conversation)\s/g;

/** Classic Outlook rows: "Unread From Alice Subject Lunch? Received Tue 3:14 PM Size 24 KB …". */
export function outlookRow(name: string): { unread: boolean; from?: string; subject?: string; time?: string; preview?: string } {
  const unread = /^unread\b/i.test(name);
  const fields: Record<string, string> = {};
  const marks = [...name.matchAll(OUTLOOK_FIELDS)];
  marks.forEach((m, i) => {
    const start = m.index! + m[0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index! : name.length;
    fields[m[1].toLowerCase()] = name.slice(start, end).trim();
  });
  return { unread, from: fields.from, subject: fields.subject, time: fields.received ?? fields.sent, preview: fields.preview };
}

function outlook(_snap: USnapshot, base: Rewritten): Rewritten {
  const root = base.source.root;
  const rows = findAll(root, (n) => (n.t === 'DataItem' || n.t === 'ListItem') && /\b(from|subject)\b/i.test(n.name));
  if (!rows.length) return base;
  const items: Item[] = rows.map((r): ListItem => {
    const p = outlookRow(r.name);
    const cellTexts = texts(r);
    return {
      id: r.id,
      kind: 'item',
      title: p.from ?? cellTexts[0] ?? r.name,
      subtitle: p.subject,
      detail: p.preview,
      meta: p.time ?? cellTexts.find(isTimeLike),
      unread: p.unread || undefined,
      tap: { ref: ref('nav', r.id) },
      swipe: [{ ref: ref('outlook-delete', r.id), title: 'Delete', symbol: 'trash', role: 'destructive' }],
      leadingSwipe: [{ ref: ref('outlook-read', r.id), title: p.unread ? 'Read' : 'Unread', symbol: p.unread ? 'envelope.open' : 'envelope.badge' }],
    };
  });
  // Folders (the sidebar) live in the list's menu; the list is the app's home like iOS Mail.
  const folders: MenuItem[] = (base.home?.sections ?? [])
    .flatMap((sec) => sec.items)
    .filter((i) => i.kind === 'nav')
    .map((i) => (i.kind === 'nav' ? { title: i.title, checked: i.selected, action: { ref: i.tap.ref.replace(/^nav:/, 'select:') } } : { title: '' }));
  const folderName = (base.home?.sections ?? []).flatMap((sec) => sec.items).find((i) => i.kind === 'nav' && i.selected);
  const newMail = button(root, /^new (mail|email|message)\b/i);
  const list: Screen = {
    id: 'mail-list',
    title: folderName && folderName.kind === 'nav' ? folderName.title : 'Mail',
    largeTitle: true,
    style: 'list',
    sections: [{ id: 'mail', style: 'plain', items }],
    search: base.page.search,
    actions: newMail ? [action(newMail, 'invoke', { symbol: 'square.and.pencil' })!] : undefined,
    menu: [...(folders.length ? [{ title: 'Folders', symbol: 'folder', children: folders }] : []), ...(base.page.menu ?? [])],
  };
  const selected = rows.find(isSelected);
  const reading = largest(root, (n) => n.t === 'Document' && n.h > 150);
  if (!selected || !reading) return { ...base, home: undefined, trail: [], page: list };
  const p = outlookRow(selected.name);
  const body = mapNode(base, reading);
  const message: Screen = {
    id: `mail:${selected.id}`,
    title: truncate(p.subject ?? 'Message', 50),
    style: 'article',
    sections: [
      {
        id: 'head',
        items: [
          { id: 'from', kind: 'text', label: 'From', text: p.from ?? '' },
          ...(p.time ? [{ id: 'when', kind: 'text' as const, label: 'Received', text: p.time }] : []),
        ],
      },
      ...body.sections,
    ],
    bottomBar: [/^reply$/i, /^reply all$/i, /^forward$/i, /^delete$/i].map((re) => action(button(root, re))).filter((a): a is Action => Boolean(a)),
  };
  return { ...base, home: list, trail: [], up: undefined, page: message };
}

/** Word, Excel, PowerPoint and Outlook. */
export const office: Adapter = {
  id: 'office',
  label: 'Office',
  matches: (w) => OFFICE.test(w.process),
  // Mail opens on the message list; documents open on the document.
  startInPage: (rw) => rw.home?.id !== 'mail-list',

  view(snap, base) {
    const p = snap.process.toLowerCase();
    if (p === 'winword') return word(snap, base);
    if (p === 'excel') return excel(snap, base);
    if (p === 'powerpnt') return powerpoint(snap, base);
    if (p === 'outlook' || p === 'olk') return outlook(snap, base);
    return base;
  },

  async action(a, _value, ctx) {
    if (a.kind === 'outlook-delete') {
      await ctx.backend.act(ctx.hwnd, a.id, 'select');
      await ctx.backend.windowKeys(ctx.hwnd, [0x2e]);
      return true;
    }
    if (a.kind === 'outlook-read') {
      await ctx.backend.act(ctx.hwnd, a.id, 'select');
      // Ctrl+Q marks read, Ctrl+U unread; toggling the current state is what the phone asked for.
      await ctx.backend.windowKeys(ctx.hwnd, [0x11, 0x51]);
      return true;
    }
    return false;
  },
};
