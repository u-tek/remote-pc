import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import type { AppView, ServerMessage } from '../src/ui/schema.js';
import { startTestAgent, waitFor, type TestAgent } from './helpers.js';

const SDK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'sdk');
const has = (cmd: string, args: string[]) => spawnSync(cmd, args).status === 0;

/** The same tiny app in each language: a counter with an "Add" button and a "Name" field. */
const CLIENTS: Record<string, { skip?: string; start(env: NodeJS.ProcessEnv): ChildProcess }> = {
  node: {
    start: (env) =>
      spawn(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import { PhoneApp, ui } from ${JSON.stringify(path.join(SDK, 'node', 'index.js'))};
           let count = 0, name = '';
           const app = new PhoneApp({ id: 'counter-node', name: 'Counter' }, () => ui.screen('Count ' + count, [ui.button('Add', () => count++), ui.field('Name', name, (v) => (name = v)), ui.text('Hi ' + name)]));
           await app.connect();`,
        ],
        { env },
      ),
  },
  python: {
    skip: has('python3', ['--version']) ? undefined : 'python3 not installed',
    start: (env) =>
      spawn(
        'python3',
        [
          '-c',
          `import sys; sys.path.insert(0, ${JSON.stringify(path.join(SDK, 'python'))})
from remote_pc import PhoneApp, ui
s = {"count": 0, "name": ""}
app = PhoneApp("counter-python", "Counter", lambda a: ui.screen("Count %d" % s["count"], [ui.button("Add", lambda: s.update(count=s["count"] + 1)), ui.field("Name", s["name"], lambda v: s.update(name=v)), ui.text("Hi " + s["name"])]))
app.run()`,
        ],
        { env },
      ),
  },
  csharp: {
    skip: has('mcs', ['--version']) && has('mono', ['--version']) ? undefined : 'mono not installed',
    start: (env) => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'rpc-cs-'));
      const exe = path.join(dir, 'counter.exe');
      const program = path.join(dir, 'Program.cs');
      writeFileSync(
        program,
        `using RemotePC.Sdk;
         static class P { static void Main() {
           int count = 0; string name = "";
           new PhoneApp("counter-csharp", "Counter", a => Ui.Screen("Count " + count, Ui.Button("Add", () => count++), Ui.Field("Name", name, v => name = v), Ui.Text("Hi " + name))).Run();
         } }`,
      );
      const built = spawnSync('mcs', ['-langversion:5', `-out:${exe}`, program, path.join(SDK, 'csharp', 'RemotePhone.cs')]);
      if (built.status !== 0) throw new Error(built.stdout.toString() + built.stderr.toString());
      return spawn('mono', [exe], { env });
    },
  },
};

describe('SDK clients drive a native phone app end to end', () => {
  let t: TestAgent;
  let env: NodeJS.ProcessEnv;
  const procs: ChildProcess[] = [];

  before(async () => {
    t = await startTestAgent({ uiBackend: { windows: async () => [] } as never });
    env = { ...process.env, REMOTE_PC_SDK_URL: `${t.base.replace('http', 'ws')}/api/sdk`, REMOTE_PC_SDK_TOKEN: t.agent.store.data.ui.sdkToken };
  });
  after(async () => {
    for (const p of procs) p.kill();
    await t.close();
  });

  for (const [lang, client] of Object.entries(CLIENTS)) {
    it(`${lang}`, { skip: client.skip, timeout: 60_000 }, async () => {
      const proc = client.start(env);
      procs.push(proc);
      let stderr = '';
      proc.stderr?.on('data', (d) => (stderr += d));
      const appId = `sdk:counter-${lang}`;
      await waitFor(async () => (await t.call('GET', '/api/ui/apps')).data.some((a: { id: string }) => a.id === appId), 30_000).catch(() => {
        throw new Error(`${lang} client never connected: ${stderr}`);
      });

      const phone = new WebSocket(`${t.base.replace('http', 'ws')}/api/ui?app=${appId}`, { headers: { authorization: `Bearer ${t.token}` } });
      const views: AppView[] = [];
      phone.on('message', (raw) => {
        const m = JSON.parse(raw.toString()) as ServerMessage;
        if (m.type === 'view') views.push(m.view);
      });
      await new Promise((r) => phone.once('open', r));
      const first = await waitFor(() => views.at(-1), 10_000);
      assert.equal(first.screens[0].title, 'Count 0');
      assert.equal(first.app.source, 'sdk');
      const items = first.screens[0].sections[0].items;
      const add = items.find((i) => i.kind === 'button');
      const field = items.find((i) => i.kind === 'field');
      assert.ok(add?.kind === 'button' && field?.kind === 'field');

      phone.send(JSON.stringify({ type: 'action', ref: add.action.ref }));
      phone.send(JSON.stringify({ type: 'action', ref: add.action.ref }));
      await waitFor(() => views.at(-1)?.screens[0].title === 'Count 2', 10_000);
      phone.send(JSON.stringify({ type: 'action', ref: field.ref, value: 'Ada' }));
      const greeted = await waitFor(() => views.find((v) => v.screens[0].sections[0].items.some((i) => i.kind === 'text' && i.text === 'Hi Ada')), 10_000);
      assert.ok(greeted);
      phone.close();
      proc.kill();
    });
  }
});
