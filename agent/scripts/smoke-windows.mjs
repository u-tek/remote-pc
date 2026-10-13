// Exercises the real PowerShell/C# helper on Windows (run in CI on windows-latest).
// Usage: npm run build && node scripts/smoke-windows.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WindowsHelper } from '../dist/pc/helper.js';

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
await step('bad op reports an error', async () => {
  await assert.rejects(helper.call('nope'), /unknown op/);
});

helper.stop();
console.log(results.join('\n'));
