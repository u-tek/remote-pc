// Exercises the real PowerShell/C# helper on Windows (run in CI on windows-latest).
// Usage: npm run build && node scripts/smoke-windows.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { uiHelperCommand, WindowsHelper } from '../dist/pc/helper.js';
import { rewrite } from '../dist/ui/rules/build.js';

if (process.platform !== 'win32') {
  console.log('Not Windows; skipping.');
  process.exit(0);
}

const helper = new WindowsHelper();
const results = [];
async function step(name, fn, { optional = false } = {}) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push(`ok   ${name} (${Date.now() - started} ms)${detail ? ' — ' + detail : ''}`);
  } catch (err) {
    results.push(`${optional ? 'warn' : 'FAIL'} ${name}: ${err.message}`);
    if (!optional) process.exitCode = 1;
  }
}

await step('compile + ping', async () => assert.equal(await helper.call('ping', {}, 120_000), 'pong'));
await step('known folders', async () => {
  const f = await helper.call('folders');
  assert.ok(f.home && f.desktop, 'missing folders');
  return f.desktop;
});
await step('processes', async () => {
  const snap = await helper.call('processes', {}, 60_000);
  assert.ok(snap.processes.length > 10, 'too few processes');
  assert.ok(snap.memTotal > 0, 'no memory total');
  const second = await helper.call('processes', {}, 60_000);
  return `${second.processes.length} processes, cpu ${second.cpu}%`;
});
await step('windows', async () => {
  const wins = await helper.call('windows');
  assert.ok(Array.isArray(wins), 'not an array');
  return `${wins.length} windows`;
});
let firstApp;
await step('start menu apps', async () => {
  const apps = await helper.call('apps', {}, 120_000);
  assert.ok(Array.isArray(apps) && apps.length > 0, 'no apps');
  assert.ok(apps[0].name && apps[0].id, 'bad entry shape');
  firstApp = apps.find((a) => /notepad|powershell|command prompt/i.test(a.name)) ?? apps[0];
  return `${apps.length} apps, e.g. ${firstApp.name}`;
});
await step(
  'app icon',
  async () => {
    const png = await helper.call('appicon', { id: firstApp.id, size: 64 });
    assert.ok(png && Buffer.from(png, 'base64').subarray(1, 4).toString() === 'PNG', 'not a PNG');
    return `${Math.round((png.length * 3) / 4)} bytes`;
  },
  { optional: true },
);
await step(
  'clipboard round trip',
  async () => {
    await helper.call('clip_set', { text: 'remote-pc smoke ✓' });
    const clip = await helper.call('clip_get');
    assert.equal(clip.text, 'remote-pc smoke ✓');
  },
  { optional: true },
);
await step('recycle bin delete', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rpc-smoke-'));
  const file = path.join(dir, 'delete-me.txt');
  writeFileSync(file, 'bye');
  await helper.call('recycle', { path: file }, 60_000);
  assert.equal(existsSync(file), false);
});
let outputs = [];
await step('monitors (DXGI order)', async () => {
  outputs = await helper.call('outputs');
  assert.ok(Array.isArray(outputs) && outputs.length > 0, 'no monitors');
  return outputs.map((o) => `#${o.index} ${o.width}x${o.height}${o.dxgi ? '' : ' (no dxgi)'}`).join(', ');
});
await step(
  'screen preview',
  async () => {
    const o = outputs[0];
    const jpg = await helper.call('shot', { x: o.x, y: o.y, w: o.width, h: o.height, width: 320 });
    assert.ok(jpg && Buffer.from(jpg, 'base64')[0] === 0xff, 'not a JPEG');
  },
  { optional: true },
);
await step('cursor position', async () => {
  const pos = await helper.call('input', { k: 'cursor' });
  assert.ok(Array.isArray(pos) && pos.length === 2);
  return pos.join(',');
});
await step(
  'relative mouse move',
  async () => {
    const before = await helper.call('input', { k: 'cursor' });
    const after = await helper.call('input', { k: 'rel', x: 5, y: 5 });
    return `${before.join(',')} -> ${after.join(',')}`;
  },
  { optional: true },
);
await step('system status', async () => {
  const s = await helper.call('status');
  assert.ok(typeof s.user === 'string' && s.uptimeSeconds > 0, 'bad status');
  return `volume ${s.volume}, battery ${s.hasBattery ? s.battery + '%' : 'none'}`;
});
await step('wallpaper lookup', async () => {
  const p = await helper.call('wallpaper');
  return p ?? 'none set';
});
await step('window bounds', async () => {
  const wins = await helper.call('windows');
  if (!wins.length) return 'no windows to check';
  const b = await helper.call('winbounds', { hwnd: wins[0].hwnd });
  assert.ok(typeof b.width === 'number');
  const placement = await helper.call('getplacement', { hwnd: wins[0].hwnd });
  assert.equal(placement.length, 5);
  return `${b.width}x${b.height}`;
});
await step('bad op reports an error', async () => {
  await assert.rejects(helper.call('nope'), /unknown op/);
});

// ---- Native apps: read Notepad through UI Automation, rewrite it, and type into it. ----
const ui = new WindowsHelper(uiHelperCommand());
await step('ui helper compile + ping', async () => assert.equal(await ui.call('ping', {}, 120_000), 'pong'));
let notepad;
let notepadHwnd;
await step(
  'notepad → native document',
  async () => {
    const before = new Set((await helper.call('windows')).map((w) => w.hwnd));
    notepad = spawn('notepad.exe', [], { detached: true, stdio: 'ignore' });
    for (let i = 0; i < 40 && !notepadHwnd; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const fresh = (await helper.call('windows')).find((w) => !before.has(w.hwnd) && /notepad/i.test(`${w.process} ${w.title}`));
      if (fresh) notepadHwnd = fresh.hwnd;
    }
    assert.ok(notepadHwnd, 'Notepad window did not appear');
    const snap = await ui.call('snap', { hwnd: notepadHwnd }, 60_000);
    assert.ok(snap.root && snap.root.c?.length, 'empty tree');
    const out = rewrite(snap, { appId: `w${notepadHwnd}`, imageUrl: () => '', region: () => '' });
    assert.equal(out.page.style, 'document', `expected a document, got ${out.page.style}`);
    assert.ok(out.page.document?.typeRef, 'no way to type');
    const editor = out.page.document.ref ?? out.page.document.typeRef;
    const [op, id] = editor.split(':');
    await ui.call('act', { hwnd: notepadHwnd, id, op, value: 'hello from the phone' });
    await new Promise((r) => setTimeout(r, 400));
    const after = rewrite(await ui.call('snap', { hwnd: notepadHwnd }, 60_000), { appId: 'x', imageUrl: () => '', region: () => '' });
    assert.match(after.page.document?.text ?? '', /hello from the phone/);
    return `${snap.ms} ms snapshot, menu: ${(out.page.menu ?? []).map((m) => m.title).join(', ')}`;
  },
  { optional: true },
);
await step(
  'window crop',
  async () => {
    if (!notepadHwnd) return 'no window';
    const png = await ui.call('crop', { hwnd: notepadHwnd, x: 0, y: 0, w: 64, h: 64, width: 64, format: 'png' });
    assert.ok(Buffer.from(png, 'base64').subarray(1, 4).toString() === 'PNG', 'not a PNG');
  },
  { optional: true },
);
if (notepadHwnd) await helper.call('window', { hwnd: notepadHwnd, action: 'close' }).catch(() => undefined);
// Notepad asks to save the typed text; don't leave it behind on the runner.
await new Promise((r) => setTimeout(r, 500));
try {
  notepad?.kill();
} catch {
  // already gone
}
ui.stop();

helper.stop();
console.log(results.join('\n'));
