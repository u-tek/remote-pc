import { mkdtempSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { buildAgent, type AgentOptions } from '../src/app.js';
import { ConfigStore } from '../src/config.js';

export interface TestAgent {
  base: string;
  token: string;
  dir: string;
  agent: ReturnType<typeof buildAgent>;
  call<T = any>(method: string, route: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; data: T }>;
  close(): Promise<void>;
}

export async function startTestAgent(extra: Partial<AgentOptions> = {}): Promise<TestAgent> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rpc-test-'));
  writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ bind: 'localhost', opencode: { enabled: false } }));
  const store = new ConfigStore(dir);
  const agent = buildAgent({
    store,
    plan: { listen: ['127.0.0.1'], advertise: '127.0.0.1', forwardHost: '127.0.0.1' },
    ...extra,
  });
  const server = http.createServer((req, res) => void agent.app.handler(req, res));
  server.on('upgrade', agent.app.upgrade);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const token = store.data.token;
  return {
    base,
    token,
    dir,
    agent,
    async call(method, route, body, headers = {}) {
      const res = await fetch(base + route, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
        body: body === undefined ? undefined : typeof body === 'string' || body instanceof Uint8Array ? (body as string) : JSON.stringify(body),
      });
      const text = await res.text();
      let data: unknown = text;
      try {
        data = JSON.parse(text);
      } catch {
        // non-JSON body
      }
      return { status: res.status, data: data as any };
    },
    async close() {
      await agent.shutdown();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

export async function waitFor<T>(fn: () => T | undefined | Promise<T | undefined>, timeoutMs = 3000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
}
