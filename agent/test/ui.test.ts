import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import WebSocket from 'ws';
import type { UiBackend, WindowInfo } from '../src/ui/backend.js';
import type { AppView, ServerMessage } from '../src/ui/schema.js';
import type { UNode, USnapshot } from '../src/ui/uia.js';
import * as apps from './fixtures/uia/apps.js';
import { startTestAgent, waitFor, type TestAgent } from './helpers.js';

/** A pretend Windows: one Settings window whose toggles and navigation respond to actions. */
class FakeBackend implements UiBackend {
  snap: USnapshot = apps.settingsDisplay();
  calls: Array<[string, string, string | undefined]> = [];
  windowsList: WindowInfo[] = [{ hwnd: 77, title: 'Settings', process: 'ApplicationFrameHost', pid: 1, minimized: false, maximized: false, foreground: true }];

  private find(id: string, n: UNode = this.snap.root): UNode | undefined {
    if (n.id === id) return n;
    for (const k of n.c ?? []) {
      const f = this.find(id, k);
      if (f) return f;
    }
    return undefined;
  }

  async windows() {
    return this.windowsList;
  }
  async snapshot(hwnd: number) {
    if (hwnd !== 77) throw new Error('That window is gone.');
    return structuredClone(this.snap);
  }
  async act(_hwnd: number, id: string, op: string, value?: string) {
    this.calls.push([op, id, value]);
    const n = this.find(id);
    if (!n) throw new Error('That control is no longer on screen.');
    if (op === 'toggle') n.tog = value === 'true' ? 1 : value === 'false' ? 0 : n.tog === 1 ? 0 : 1;
    return 'ok';
  }
  async windowKeys() {}
  async windowText() {}
  async tap() {}
  async wheel() {}
  async crop() {
    return Buffer.from('png');
  }
  async invalidate() {}
  async windowIcon() {
    return Buffer.from('icon');
  }
  async screenReader() {}
}

function connect(t: TestAgent, path: string, headers: Record<string, string> = { authorization: `Bearer ${t.token}` }) {
  const ws = new WebSocket(t.base.replace('http', 'ws') + path, { headers });
  const messages: ServerMessage[] = [];
  ws.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
  return { ws, messages, open: new Promise<void>((resolve, reject) => (ws.once('open', () => resolve()), ws.once('error', reject))) };
}

const lastView = (messages: ServerMessage[]) => [...messages].reverse().find((m) => m.type === 'view') as { view: AppView } | undefined;

describe('native app sessions', () => {
  let t: TestAgent;
  const backend = new FakeBackend();

  before(async () => {
    t = await startTestAgent({ uiBackend: backend });
  });
  after(async () => {
    await t.close();
  });

  it('lists open windows as apps', async () => {
    const { status, data } = await t.call('GET', '/api/ui/apps');
    assert.equal(status, 200);
    assert.equal(data[0].id, 'w77');
    assert.equal(data[0].name, 'Settings');
    assert.equal(data[0].icon.image, '/api/windows/77/icon');
  });

  it('opens Settings natively, navigates, toggles and goes back', async () => {
    const c = connect(t, '/api/ui?app=w77');
    await c.open;
    const first = await waitFor(() => lastView(c.messages));
    assert.equal(first.view.screens.length, 1, 'starts on the sidebar like iOS Settings');
    assert.equal(first.view.screens[0].title, 'Settings');

    const system = first.view.screens[0].sections[1].items.find((i) => 'title' in i && i.title === 'System')!;
    assert.ok(system.kind === 'nav');
    c.ws.send(JSON.stringify({ type: 'action', ref: system.tap.ref }));
    const drilled = await waitFor(() => {
      const v = lastView(c.messages);
      return v && v.view.screens.length === 3 ? v : undefined;
    });
    assert.deepEqual(
      drilled.view.screens.map((s) => s.title),
      ['Settings', 'System', 'Display'],
    );
    assert.equal(backend.calls[0][0], 'select');

    const night = drilled.view.screens[2].sections.flatMap((s) => s.items).find((i) => i.kind === 'toggle')!;
    assert.ok(night.kind === 'toggle' && night.on === false);
    c.ws.send(JSON.stringify({ type: 'action', ref: night.ref, value: true }));
    await waitFor(() => {
      const v = lastView(c.messages);
      const toggle = v?.view.screens.at(-1)?.sections.flatMap((s) => s.items).find((i) => i.kind === 'toggle');
      return toggle && toggle.kind === 'toggle' && toggle.on;
    });
    assert.deepEqual(backend.calls.at(-1)?.slice(0, 1), ['toggle']);
    assert.equal(backend.calls.at(-1)?.[2], 'true');

    c.ws.send(JSON.stringify({ type: 'pop', depth: 1 }));
    await waitFor(() => lastView(c.messages)?.view.screens.length === 1);
    c.ws.close();
  });

  it('serves pictures of controls and window icons', async () => {
    const c = connect(t, '/api/ui?app=w77');
    await c.open;
    const v = await waitFor(() => lastView(c.messages));
    const profile = v.view.screens[0].sections[0].items[0];
    assert.ok(profile.kind === 'profile' && profile.icon?.image);
    const res = await fetch(t.base + profile.icon.image, { headers: { authorization: `Bearer ${t.token}` } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    const icon = await fetch(`${t.base}/api/windows/77/icon`, { headers: { authorization: `Bearer ${t.token}` } });
    assert.equal(icon.status, 200);
    c.ws.close();
  });

  it('tells the phone when the window closes', async () => {
    const c = connect(t, '/api/ui?app=w78');
    await c.open;
    const ended = await waitFor(() => c.messages.find((m) => m.type === 'ended'));
    assert.match((ended as { message: string }).message, /closed/);
  });
});

describe('SDK apps', () => {
  let t: TestAgent;

  before(async () => {
    t = await startTestAgent({ uiBackend: new FakeBackend() });
  });
  after(async () => {
    await t.close();
  });

  it('refuses the SDK socket without the SDK token', async () => {
    const c = connect(t, '/api/sdk', { authorization: `Bearer ${t.token}` });
    await assert.rejects(c.open);
  });

  it('relays an SDK app between the PC program and the phone', async () => {
    const sdkToken = t.agent.store.data.ui.sdkToken;
    const app = connect(t, '/api/sdk', { authorization: `Bearer ${sdkToken}` });
    await app.open;
    const fromPhone: unknown[] = [];
    app.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'action') fromPhone.push(m);
    });
    app.ws.send(JSON.stringify({ type: 'hello', app: { id: 'demo', name: 'Demo', icon: { symbol: 'star.fill', color: 'orange', style: 'tile' } } }));
    app.ws.send(
      JSON.stringify({
        type: 'view',
        view: { screens: [{ id: 'home', title: 'Demo', sections: [{ id: 's', items: [{ id: 'go', kind: 'button', action: { ref: 'go', title: 'Go' } }] }] }] },
      }),
    );
    await waitFor(async () => (await t.call('GET', '/api/ui/apps')).data.some((a: { id: string }) => a.id === 'sdk:demo'));

    const phone = connect(t, '/api/ui?app=sdk:demo');
    await phone.open;
    const v = await waitFor(() => lastView(phone.messages));
    assert.equal(v.view.app.source, 'sdk');
    assert.equal(v.view.screens[0].title, 'Demo');
    phone.ws.send(JSON.stringify({ type: 'action', ref: 'go' }));
    await waitFor(() => fromPhone.length === 1);
    assert.deepEqual(fromPhone[0], { type: 'action', ref: 'go' });

    app.ws.close();
    await waitFor(() => phone.messages.some((m) => m.type === 'ended'));
    phone.ws.close();
  });
});
