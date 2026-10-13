import { readFileSync } from 'node:fs';
import os from 'node:os';
import { ClaudeProvider, type ClaudeSdk } from './agents/claude.js';
import { OpenCodeProvider } from './agents/opencode.js';
import { registerAgentRoutes } from './agents/routes.js';
import type { AgentKind, AgentProvider } from './agents/types.js';
import type { ConfigStore } from './config.js';
import { Router } from './http.js';
import { Hub } from './hub.js';
import type { BindPlan } from './net.js';
import { registerFileRoutes } from './pc/files.js';
import { WindowsHelper } from './pc/helper.js';
import { registerShellRoutes } from './pc/shell.js';
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
}

/** Wire every feature onto one router. Kept separate from index.ts so tests can build it. */
export function buildAgent(opts: AgentOptions) {
  const { store, plan } = opts;
  const hub = new Hub();
  const helper = opts.helper ?? new WindowsHelper();
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
      host: plan.advertise,
      agents,
    };
  };

  router.get('/api/info', info);
  registerAgentRoutes(router, hub, store, providers);
  registerFileRoutes(router, helper);
  registerShellRoutes(router, helper);
  registerWebRoutes(router, web);

  const app = createApp({
    token: () => store.data.token,
    hub,
    router,
    hello: async () => ({ info: await info(), approvals: hub.pendingApprovals(), questions: hub.pendingQuestions() }),
  });

  return {
    app,
    hub,
    helper,
    providers,
    web,
    async warmUp() {
      helper.warmUp();
      opencode.warmUp();
      await web.startAll();
    },
    async shutdown() {
      web.stopAll();
      helper.stop();
      app.close();
      await Promise.all(Object.values(providers).map((p) => p.shutdown().catch(() => undefined)));
    },
  };
}
