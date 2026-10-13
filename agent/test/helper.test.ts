import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { WindowsHelper } from '../src/pc/helper.js';

// A tiny stand-in for helper.ps1 that speaks the same JSON-lines protocol.
const FAKE = `
const rl = require('readline').createInterface({ input: process.stdin });
console.log('noise before ready is ignored');
console.log(JSON.stringify({ ready: true }));
rl.on('line', (line) => {
  const req = JSON.parse(line);
  if (req.op === 'ping') console.log(JSON.stringify({ id: req.id, ok: true, result: 'pong' }));
  else if (req.op === 'echo') setTimeout(() => console.log(JSON.stringify({ id: req.id, ok: true, result: req.args })), 20);
  else if (req.op === 'hang') {}
  else console.log(JSON.stringify({ id: req.id, ok: false, error: 'unknown op: ' + req.op }));
});
`;

describe('Windows helper protocol', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rpc-helper-'));
  const script = path.join(dir, 'fake.cjs');
  writeFileSync(script, FAKE);
  const helper = new WindowsHelper({ command: process.execPath, args: [script] });
  after(() => helper.stop());

  it('waits for ready and matches responses to requests', async () => {
    const [a, b, c] = await Promise.all([helper.call('echo', { n: 1 }), helper.call('ping'), helper.call('echo', { n: 3 })]);
    assert.deepEqual(a, { n: 1 });
    assert.equal(b, 'pong');
    assert.deepEqual(c, { n: 3 });
  });

  it('surfaces errors', async () => {
    await assert.rejects(helper.call('nope'), /unknown op: nope/);
  });

  it('times out', async () => {
    await assert.rejects(helper.call('hang', {}, 100), /timed out/);
  });
});
