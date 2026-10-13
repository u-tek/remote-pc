import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultAdapters } from '../src/ui/adapters/index.js';
import { outlookRow } from '../src/ui/adapters/office.js';
import type { AdapterContext } from '../src/ui/adapters/types.js';
import type { UiBackend } from '../src/ui/backend.js';
import { rewrite } from '../src/ui/rules/build.js';
import type { Item, MessageItem, RecordItem } from '../src/ui/schema.js';
import type { USnapshot } from '../src/ui/uia.js';
import * as apps from './fixtures/uia/apps.js';

const adapters = defaultAdapters();

function run(snap: USnapshot, state: Record<string, unknown> = {}) {
  const base = rewrite(snap, { appId: 'w1', imageUrl: (id) => `/img/${id}`, region: (r) => r.join(',') });
  const adapter = adapters.find((a) => a.matches(snap));
  assert.ok(adapter, `an adapter for ${snap.process}`);
  const ctx: AdapterContext = { hwnd: 1, backend: {} as UiBackend, snapshot: () => snap, state, toast: () => undefined };
  return { adapter, out: adapter.view(snap, base, ctx) };
}

const items = (sections: { items: Item[] }[]) => sections.flatMap((s) => s.items);

test('browser pages read like Safari', () => {
  const { adapter, out } = run(apps.chromeArticle());
  assert.equal(adapter.id, 'browser');
  assert.equal(out.page.style, 'browser');
  assert.equal(out.page.title, 'Rust 1.80 released');
  assert.equal(out.page.address?.value, 'blog.rust-lang.org/2024/07/25/Rust-1.80.0.html');
  assert.ok(out.page.address?.secure);
  const bar = out.page.bottomBar?.map((a) => a.title);
  assert.deepEqual(bar, ['Back', 'Forward', 'Share', '2', 'New Tab']);
  assert.equal(out.page.bottomBar?.[1].disabled, true);
  assert.ok(out.page.refresh);
  const all = items(out.page.sections);
  assert.ok(all.some((i) => i.kind === 'heading' && i.text === "What's in 1.80.0 stable"));
  const para = all.find((i) => i.kind === 'paragraph' && i.runs.some((r) => r.link));
  assert.ok(para);
  assert.equal(out.home, undefined, 'no sidebar for browsers');
});

test('browser tab switcher is a native sheet', () => {
  const { out } = run(apps.chromeArticle(), { showTabs: true });
  assert.equal(out.sheet?.id, 'local:tabs');
  const tabs = items(out.sheet!.sections);
  assert.equal(tabs.length, 2);
  assert.ok(tabs[0].kind === 'item' && tabs[0].checked && tabs[0].swipe?.[0].role === 'destructive');
});

test('Discord becomes channels plus chat bubbles', () => {
  const { adapter, out } = run(apps.discordChannel());
  assert.equal(adapter.id, 'chat');
  assert.equal(out.page.style, 'chat');
  assert.equal(out.page.title, 'general');
  assert.equal(out.page.composer?.placeholder, 'Message #general');
  const msgs = items(out.page.sections) as MessageItem[];
  assert.equal(msgs[0].system, true);
  assert.equal(msgs[0].text, 'January 5, 2024');
  assert.equal(msgs[1].author, 'Sam');
  assert.equal(msgs[1].time, 'Today at 3:14 PM');
  assert.equal(msgs[1].text, 'anyone tried the new LazyLock?');
  assert.equal(msgs[2].author, undefined, 'follow-up messages are grouped');
  assert.equal(msgs[2].text, 'it replaces once_cell for me');
  assert.equal(msgs[3].author, 'alex');
  assert.equal(msgs[3].outgoing, true, 'your own messages are on the right');
  assert.deepEqual(msgs[3].reactions, ['👍 2']);
  assert.deepEqual(
    out.page.actions?.map((a) => a.title),
    ['Start Voice Call'],
  );
  const channels = out.home ? items(out.home.sections).filter((i) => i.kind === 'nav') : [];
  assert.ok(
    channels.some((c) => c.kind === 'nav' && c.title === 'general'),
    'channel names are cleaned up',
  );
});

test('Word is a document with formatting tools', () => {
  const { out } = run(apps.wordDocument());
  assert.equal(out.page.style, 'document');
  assert.equal(out.page.title, 'Report.docx');
  assert.match(out.page.document?.text ?? '', /Sales grew 12%/);
  assert.equal(out.page.document?.ref, undefined, 'rich text is never replaced wholesale');
  assert.ok(out.page.document?.typeRef);
  assert.deepEqual(
    out.page.bottomBar?.map((a) => a.symbol),
    ['bold', 'italic', 'underline'],
  );
  assert.equal(out.page.bottomBar?.[1].role, 'primary', 'active formatting is highlighted');
  const menuTitles = out.page.menu?.map((m) => m.title);
  assert.ok(menuTitles?.includes('Clipboard') && menuTitles.includes('Font') && menuTitles.includes('Ribbon'));
});

test('Excel rows become cards with a formula field', () => {
  const { out } = run(apps.excelSheet());
  const cell = out.page.sections[0];
  assert.equal(cell.header, 'A2');
  assert.ok(cell.items[0].kind === 'field' && cell.items[0].value === 'Coffee');
  const rows = out.page.sections[1].items as RecordItem[];
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1].fields, [
    { label: 'A', value: 'Coffee' },
    { label: 'B', value: '4.50' },
  ]);
  assert.deepEqual(
    out.page.segments?.items.map((s) => s.title),
    ['Sheet1', 'Sheet2'],
  );
});

test('Outlook rows are split into sender, subject and time', () => {
  const r = outlookRow('Unread From Alice Smith Subject Lunch on Friday? Received Tue 3:14 PM Size 24 KB Flag Status Unflagged');
  assert.deepEqual(r, { unread: true, from: 'Alice Smith', subject: 'Lunch on Friday?', time: 'Tue 3:14 PM', preview: undefined });
});

test('Explorer files offer Save to iPhone', () => {
  const snap = apps.explorerDocuments();
  (snap.root.c ?? []).push({ id: 'addr', t: 'ToolBar', n: 'Address: C:\\Users\\Alex\\Documents', r: [300, 48, 500, 36] });
  const { adapter, out } = run(snap);
  assert.equal(adapter.id, 'explorer');
  assert.equal(out.page.subtitle, 'C:\\Users\\Alex\\Documents');
  const rows = items(out.page.sections);
  const report = rows.find((i) => i.kind === 'item' && i.title === 'report.docx');
  assert.ok(report && report.kind === 'item');
  assert.ok(report.menu?.some((m) => m.action?.ref === `phone:download?path=${encodeURIComponent('C:\\Users\\Alex\\Documents\\report.docx')}`));
  const folder = rows.find((i) => i.kind === 'item' && i.title === 'Projects');
  assert.ok(folder && folder.kind === 'item' && folder.chevron);
});
