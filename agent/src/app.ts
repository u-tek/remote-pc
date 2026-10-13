import { readFileSync } from 'node:fs';
import os from 'node:os';
import { ClaudeProvider, type ClaudeSdk } from './agents/claude.js';
import { OpenCodeProvider } from './agents/opencode.js';
import { registerAgentRoutes } from './agents/routes.js';
import type { AgentKind, AgentProvider } from './agents/types.js';
import { configDir, type ConfigStore } from './config.js';
import { Router } from './http.js';
import { Hub } from './hub.js';
import type { BindPlan } from './net.js';
import { FfmpegManager } from './pc/ffmpeg.js';
import { registerFileRoutes } from './pc/files.js';
import { WindowsHelper } from './pc/helper.js';
import { registerShellRoutes } from './pc/shell.js';
import { StreamSession } from './pc/stream.js';
import { registerSystemRoutes } from './pc/system.js';
import { registerWebRoutes, WebForwarder } from './pc/web.js';
import { createApp } from './server.js';

export const VERSION: string = (() => {
  try {
    return (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
  } catch {
    return '0.0.0';
  }
})();

export interface AgentOptions {
  store: ConfigStore;
  plan: BindPlan;
  helper?: WindowsHelper;
  providers?: Partial<Record<AgentKind, AgentProvider>>;
  claudeSdk?: ClaudeSdk;
  inputHelper?: WindowsHelper;
  /** Tests: stream a synthetic pattern instead of the real screen. */
  testStream?: boolean;
}

/** Wire every feature onto one router. Kept separate from index.ts so tests can build it. */
export function buildAgent(opts: AgentOptions) {
  const { store, plan } = opts;
  const hub = new Hub();
  const helper = opts.helper ?? new WindowsHelper();
  const inputHelper = opts.inputHelper ?? new WindowsHelper();
  const ffmpeg = new FfmpegManager(configDir(), store.data.stream.ffmpeg);
  const claude = new ClaudeProvider(store.data, hub, opts.claudeSdk);
  const opencode = new OpenCodeProvider(store.data, hub);
  const providers: Record<AgentKind, AgentProvider> = { claude, opencode, ...(opts.providers ?? {}) };
  const web = new WebForwarder(store, plan.forwardHost, plan.advertise, store.data.port);
  const router = new Router();

  const info = async () => {
    const agents: Record<string, { available: boolean; detail?: string }> = {};
    for (const [k, p] of Object.entries(providers)) agents[k] = await p.status();
    return {
      name: store.data.name,
      version: VERSION,
      platform: process.platform,
      hostname: os.hostname(),
      windows: process.platform === 'win32',
      stream: process.platform === 'win32' || Boolean(opts.testStream),
      host: plan.advertise,
      agents,
    };
  };

  router.get('/api/info', info);
  registerAgentRoutes(router, hub, store, providers);
  registerFileRoutes(router, helper);
  registerShellRoutes(router, helper);
  registerWebRoutes(router, web);
  registerSystemRoutes(router, helper, inputHelper, ffmpeg);

  const app = createApp({
    token: () => store.data.token,
    hub,
    router,
    hello: async () => ({ info: await info(), approvals: hub.pendingApprovals(), questions: hub.pendingQuestions() }),
    sockets: {
      '/api/stream': (ws, url) => {
        if (process.platform !== 'win32' && !opts.testStream) {
          ws.send(JSON.stringify({ type: 'error', message: 'The live desktop needs a Windows PC.' }));
          ws.close();
          return;
        }
        void new StreamSession(ws, url, {
          ffmpeg,
          helper,
          input: inputHelper,
          defaultQuality: store.data.stream.quality,
          testSource: opts.testStream,
        }).start();
      },
    },
  });

  return {
    app,
    hub,
    helper,
    providers,
    web,
    async warmUp() {
      helper.warmUp();
      inputHelper.warmUp();
      opencode.warmUp();
      await web.startAll();
    },
    async shutdown() {
      web.stopAll();
      helper.stop();
      inputHelper.stop();
      app.close();
      await Promise.all(Object.values(providers).map((p) => p.shutdown().catch(() => undefined)));
    },
  };
}
