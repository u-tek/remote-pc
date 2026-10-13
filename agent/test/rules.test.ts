import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChoiceItem, Item, KeypadItem, ListItem, NavItem, ParagraphItem, Screen, ToggleItem } from '../src/ui/schema.js';
import { rewrite, type Rewritten } from '../src/ui/rules/build.js';
import { cleanName, documentTitle, isTimeLike } from '../src/ui/rules/text.js';
import type { USnapshot } from '../src/ui/uia.js';
import * as apps from './fixtures/uia/apps.js';

const opts = { appId: 'w1', imageUrl: (id: string) => `/img/${id}`, region: (r: number[]) => `r:${r.join(',')}` };
const run = (snap: USnapshot): Rewritten => rewrite(snap, opts);
const items = (s: Screen): Item[] => s.sections.flatMap((x) => x.items);
const byTitle = <T extends Item>(s: Screen, title: string) => items(s).find((i) => 'title' in i && i.title === title) as T | undefined;

test('text helpers clean accelerators and recognise times', () => {
  assert.equal(cleanName('&Save\tCtrl+S'), 'Save');
  assert.equal(cleanName('Fish && Chips'), 'Fish & Chips');
  assert.equal(cleanName('Open...'), 'Open…');
  assert.equal(documentTitle('report.docx - Word', 'Word'), 'report.docx');
  assert.ok(isTimeLike('3/14/2024 9:12 AM'));
  assert.ok(isTimeLike('Yesterday'));
  assert.ok(!isTimeLike('Projects'));
});

test('Settings becomes a sidebar home and an iOS-style settings page', () => {
  const out = run(apps.settingsDisplay());
  assert.ok(out.home, 'navigation pane becomes the home list');
  assert.equal(out.home.title, 'Settings');
  const profile = out.home.sections[0].items[0];
  assert.equal(profile.kind, 'profile');
  const nav = out.home.sections[1].items as NavItem[];
  assert.equal(nav.length, 12);
  assert.ok(nav.every((n) => n.icon?.style === 'tile'), 'every category gets a colored tile');
  assert.equal(nav.find((n) => n.selected)?.title, 'System');
  assert.equal(out.home.search?.placeholder, 'Find a setting');

  assert.equal(out.page.title, 'Display');
  assert.deepEqual(out.trail, ['System']);
  assert.ok(out.page.back, 'breadcrumb parent is the back action');

  const headers = out.page.sections.map((s) => s.header);
  assert.deepEqual(headers, ['Brightness & color', 'Scale & layout', 'Related settings']);
  const slider = items(out.page).find((i) => i.kind === 'slider');
  assert.equal(slider && 'value' in slider && slider.value, 70);
  const night = byTitle<ToggleItem>(out.page, 'Night light');
  assert.equal(night?.kind, 'toggle');
  assert.equal(night?.on, false);
  assert.equal(night?.subtitle, 'Use warmer colors to help block blue light');
  const scale = byTitle<ChoiceItem>(out.page, 'Scale');
  assert.equal(scale?.kind, 'choice');
  assert.equal(scale?.value, '150% (Recommended)');
  assert.ok(scale?.load, 'options are loaded on demand');
  assert.equal(byTitle<ChoiceItem>(out.page, 'Display resolution')?.value, '1920 × 1080');
  assert.equal(byTitle<NavItem>(out.page, 'HDR')?.subtitle, 'More about HDR');
  assert.equal(byTitle<NavItem>(out.page, 'Graphics')?.kind, 'nav', 'full-width buttons are navigation rows');
  // Window chrome and the hamburger button never show up.
  assert.ok(!JSON.stringify(out).includes('Open Navigation'));
  assert.ok(!JSON.stringify(out).includes('"Close"'));
});

test('Calculator keeps its keypad layout and shows the result big', () => {
  const out = run(apps.calculator());
  const all = items(out.page);
  const display = all.find((i) => i.kind === 'text' && i.style === 'display');
  assert.equal(display && 'text' in display && display.text, '3');
  const keypad = all.find((i) => i.kind === 'keypad') as KeypadItem;
  assert.ok(keypad);
  assert.equal(keypad.rows.length, 6);
  assert.deepEqual(
    keypad.rows[2].map((k) => k?.title),
    ['7', '8', '9', '×'],
  );
  assert.equal(keypad.rows[5][3]?.title, '=');
  assert.equal(keypad.rows[5][3]?.tone, 'accent');
  assert.equal(keypad.rows[2][0]?.tone, 'primary');
  const memory = all.find((i) => i.kind === 'buttons');
  assert.ok(memory && memory.kind === 'buttons' && memory.actions.map((a) => a.title).join(' ') === 'MC MR M+ M− MS');
  assert.ok(!out.page.largeTitle);
});

test('Notepad is a document with its menus', () => {
  const out = run(apps.notepad());
  assert.equal(out.page.style, 'document');
  assert.equal(out.page.title, 'Untitled');
  assert.equal(out.page.document?.text, 'Hello world');
  assert.ok(out.page.document?.ref?.startsWith('setValue:'));
  const menuTitles = (out.page.menu ?? []).map((m) => m.title);
  assert.ok(menuTitles.includes('File') && menuTitles.includes('Edit'));
  assert.ok(out.page.menu?.find((m) => m.title === 'File')?.load, 'menu bar menus load lazily');
});

test('a message box becomes a native alert with sensible roles', () => {
  const out = run(apps.notepad({ popups: [apps.saveChangesBox()] }));
  assert.ok(out.alert);
  assert.equal(out.alert.message, 'Do you want to save changes to Untitled?');
  const roles = Object.fromEntries(out.alert.actions.map((a) => [a.title, a.role]));
  assert.deepEqual(roles, { Save: 'primary', "Don't save": 'destructive', Cancel: 'cancel' });
});

test('WinForms dialogs read top-to-bottom with labels attached', () => {
  const out = run(apps.winformsLogin());
  const all = items(out.page);
  assert.deepEqual(
    all.map((i) => i.kind),
    ['choice', 'field', 'field', 'toggle'],
  );
  const server = all[0] as ChoiceItem;
  assert.equal(server.title, 'Server');
  assert.deepEqual(
    server.options?.map((o) => o.title),
    ['prod-1', 'prod-2', 'staging'],
  );
  const password = all[2];
  assert.ok(password.kind === 'field' && password.title === 'Password' && password.secure);
  assert.deepEqual(
    out.page.actions?.map((a) => [a.title, a.role]),
    [
      ['Cancel', 'cancel'],
      ['OK', 'primary'],
    ],
  );
});

test('File Explorer is a folder sidebar plus a file list', () => {
  const out = run(apps.explorerDocuments());
  assert.equal(out.home?.title, 'File Explorer');
  assert.equal(out.page.title, 'Documents');
  assert.equal(out.page.style, 'list');
  const rows = items(out.page) as ListItem[];
  assert.equal(rows.length, 5);
  assert.equal(rows[0].icon?.symbol, 'folder.fill');
  assert.equal(rows[1].icon?.symbol, 'doc.text.fill');
  assert.equal(rows[1].meta, '3/12/2024 4:40 PM');
  assert.equal(rows[1].subtitle, '24 KB');
  assert.equal(out.page.search?.placeholder, 'Search Documents');
  assert.deepEqual(
    out.page.actions?.map((a) => a.title),
    ['New'],
  );
  assert.equal(out.page.sections.at(-1)?.footer, '5 items');
});

test('web content reads as an article with inline links', () => {
  const out = run(apps.webArticle());
  assert.equal(out.page.style, 'article');
  const para = items(out.page).find((i) => i.kind === 'paragraph') as ParagraphItem;
  assert.equal(para.runs.map((r) => r.text).join(''), 'This guide shows you how to set up your first project. Read the installation notes first.');
  assert.ok(para.runs.find((r) => r.text === 'installation notes')?.link);
  assert.ok(items(out.page).some((i) => i.kind === 'image'));
  const bullets = items(out.page).filter((i) => i.kind === 'paragraph' && i.bullet);
  assert.equal(bullets.length, 2);
});

test('unreadable windows fall back to a live picture, quietly', () => {
  const out = run(apps.opaqueGame());
  const all = items(out.page);
  assert.equal(all.length, 1);
  assert.equal(all[0].kind, 'live');
  assert.equal(out.coverage, 0);
});
