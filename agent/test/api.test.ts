import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { startTestAgent, type TestAgent } from './helpers.js';

describe('agent HTTP API', () => {
  let t: TestAgent;
  let files: string;

  before(async () => {
    t = await startTestAgent();
    files = path.join(t.dir, 'files');
    mkdirSync(files);
    writeFileSync(path.join(files, 'hello.txt'), 'hello world');
    mkdirSync(path.join(files, 'sub'));
  });
  after(() => t.close());

  it('rejects requests without the token', async () => {
    const res = await fetch(`${t.base}/api/info`);
    assert.equal(res.status, 401);
    const wrong = await fetch(`${t.base}/api/info`, { headers: { authorization: 'Bearer nope' } });
    assert.equal(wrong.status, 401);
  });

  it('accepts the token as a query parameter (for image and video URLs)', async () => {
    const res = await fetch(`${t.base}/api/info?token=${encodeURIComponent(t.token)}`);
    assert.equal(res.status, 200);
  });

  it('serves info', async () => {
    const { status, data } = await t.call('GET', '/api/info');
    assert.equal(status, 200);
    assert.equal(data.version, '0.1.0');
    assert.equal(data.agents.opencode.available, false);
  });

  it('lists a folder with folders first', async () => {
    const { data } = await t.call('GET', `/api/fs/list?path=${encodeURIComponent(files)}`);
    assert.deepEqual(
      data.entries.map((e: { name: string }) => e.name),
      ['sub', 'hello.txt'],
    );
    assert.equal(data.parent, t.dir);
  });

  it('rejects relative paths', async () => {
    const { status } = await t.call('GET', '/api/fs/list?path=relative/dir');
    assert.equal(status, 400);
  });

  it('downloads whole files and byte ranges', async () => {
    const url = `${t.base}/api/fs/file?path=${encodeURIComponent(path.join(files, 'hello.txt'))}`;
    const whole = await fetch(url, { headers: { authorization: `Bearer ${t.token}` } });
    assert.equal(await whole.text(), 'hello world');
    assert.equal(whole.headers.get('content-type'), 'text/plain; charset=utf-8');
    const part = await fetch(url, { headers: { authorization: `Bearer ${t.token}`, range: 'bytes=6-' } });
    assert.equal(part.status, 206);
    assert.equal(await part.text(), 'world');
    assert.equal(part.headers.get('content-range'), 'bytes 6-10/11');
  });

  it('uploads, refuses to overwrite, renames, makes folders and deletes', async () => {
    const target = path.join(files, 'up.bin');
    const up = await t.call('PUT', `/api/fs/file?path=${encodeURIComponent(target)}`, 'uploaded!', { 'content-type': 'application/octet-stream' });
    assert.equal(up.status, 200);
    assert.equal(readFileSync(target, 'utf8'), 'uploaded!');

    const again = await t.call('PUT', `/api/fs/file?path=${encodeURIComponent(target)}`, 'x', { 'content-type': 'application/octet-stream' });
    assert.equal(again.status, 409);

    const renamed = path.join(files, 'renamed.bin');
    assert.equal((await t.call('POST', '/api/fs/rename', { from: target, to: renamed })).status, 200);
    assert.equal((await t.call('POST', '/api/fs/mkdir', { path: path.join(files, 'new') })).status, 200);
    const del = await t.call('POST', '/api/fs/delete', { path: renamed });
    assert.equal(del.status, 200);
    const { data } = await t.call('GET', `/api/fs/list?path=${encodeURIComponent(files)}`);
    assert.deepEqual(
      data.entries.map((e: { name: string }) => e.name),
      ['new', 'sub', 'hello.txt'],
    );
  });

  it('pins and unpins projects', async () => {
    const pin = await t.call('POST', '/api/projects', { path: files });
    assert.deepEqual(pin.data.pinned, [files]);
    const unpin = await t.call('DELETE', `/api/projects?path=${encodeURIComponent(files)}`);
    assert.deepEqual(unpin.data.pinned, []);
  });

  it('reports Windows-only features clearly on other platforms', async () => {
    if (process.platform === 'win32') return;
    const { status, data } = await t.call('GET', '/api/apps');
    assert.equal(status, 501);
    assert.match(data.error, /Windows/);
  });

  it('returns 404 for unknown approvals', async () => {
    const { status } = await t.call('POST', '/api/approvals/nope', { decision: 'allow' });
    assert.equal(status, 404);
  });

  it('manages web bookmarks', async () => {
    const add = await t.call('POST', '/api/web', { name: 'Dev server', port: 5173 });
    assert.equal(add.status, 200);
    const list = await t.call('GET', '/api/web');
    assert.equal(list.data.items.length, 1);
    assert.equal(list.data.items[0].url, 'http://127.0.0.1:5173/');
    assert.equal((await t.call('DELETE', `/api/web/${add.data.id}`)).status, 200);
    assert.equal((await t.call('GET', '/api/web')).data.items.length, 0);
  });
});
