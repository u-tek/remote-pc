import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import WebSocket, { WebSocketServer } from 'ws';
import { AgentListener } from '../src/listen.js';

const hasOpenssl = spawnSync('openssl', ['version']).status === 0;

function get(url: string): Promise<string> {
  const lib = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    lib
      .get(url, { rejectUnauthorized: false }, (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => resolve(body));
      })
      .on('error', reject);
  });
}

function echo(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { rejectUnauthorized: false });
    ws.on('open', () => ws.send('ping'));
    ws.on('message', (m) => {
      resolve(m.toString());
      ws.close();
    });
    ws.on('error', reject);
  });
}

describe('one port for HTTP and HTTPS', { skip: hasOpenssl ? undefined : 'openssl not installed' }, () => {
  let listener: AgentListener;
  let port: number;
  let creds: { cert: Buffer; key: Buffer };

  before(async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'rpc-tls-'));
    const res = spawnSync('openssl', [
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:prime256v1',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-keyout',
      path.join(dir, 'k.pem'),
      '-out',
      path.join(dir, 'c.pem'),
    ]);
    assert.equal(res.status, 0, res.stderr.toString());
    creds = { cert: readFileSync(path.join(dir, 'c.pem')), key: readFileSync(path.join(dir, 'k.pem')) };

    const wss = new WebSocketServer({ noServer: true });
    wss.on('connection', (ws) => ws.on('message', (m) => ws.send(`echo ${m.toString()}`)));
    listener = new AgentListener(
      (req, res) => res.end(`ok ${(req.socket as { encrypted?: boolean }).encrypted ? 'secure' : 'plain'}`),
      (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req)),
    );
    await new Promise<void>((r) => listener.server.listen(0, '127.0.0.1', r));
    port = (listener.server.address() as AddressInfo).port;
  });
  after(() => listener.close());

  it('serves plain HTTP and WebSockets before HTTPS is on', async () => {
    assert.equal(listener.tls, false);
    assert.equal(await get(`http://127.0.0.1:${port}/`), 'ok plain');
    assert.equal(await echo(`ws://127.0.0.1:${port}/`), 'echo ping');
  });

  it('adds HTTPS and secure WebSockets on the same port, keeping HTTP', async () => {
    listener.setTls(creds);
    assert.equal(listener.tls, true);
    assert.equal(await get(`https://127.0.0.1:${port}/`), 'ok secure');
    assert.equal(await echo(`wss://127.0.0.1:${port}/`), 'echo ping');
    assert.equal(await get(`http://127.0.0.1:${port}/`), 'ok plain');
    assert.equal(await echo(`ws://127.0.0.1:${port}/`), 'echo ping');
  });

  it('takes a renewed certificate without restarting', async () => {
    listener.setTls(creds);
    assert.equal(await get(`https://127.0.0.1:${port}/`), 'ok secure');
  });
});
