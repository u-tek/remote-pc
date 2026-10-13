import type { WebSocket } from 'ws';
import { log } from '../log.js';
import type { AppSummary, AppView, ClientMessage, Icon, ServerMessage } from './schema.js';
import { PROTOCOL_VERSION } from './schema.js';

/** What an SDK app sends. */
type FromApp =
  | { type: 'hello'; protocol?: number; app: { id: string; name: string; icon?: Icon; tint?: string; description?: string } }
  | { type: 'view'; view: Omit<AppView, 'v' | 'app'> & Partial<Pick<AppView, 'v' | 'app'>> }
  | { type: 'toast'; text: string };

/** What the agent sends to an SDK app. */
export type ToApp =
  | { type: 'welcome'; protocol: number }
  | { type: 'open'; viewers: number }
  | { type: 'close' }
  | ClientMessage;

interface SdkApp {
  id: string;
  name: string;
  icon?: Icon;
  tint?: string;
  description?: string;
  ws: WebSocket;
  view?: AppView;
  viewers: Set<(m: ServerMessage) => void>;
}

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/**
 * Apps on the PC that draw their own phone UI with the SDK. Each connects to /api/sdk (localhost
 * only, SDK token), says hello, and sends views; the agent relays phone actions back to it.
 */
export class SdkHub {
  private apps = new Map<string, SdkApp>();

  attach(ws: WebSocket): void {
    let app: SdkApp | undefined;
    const sendApp = (m: ToApp) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
    };
    sendApp({ type: 'welcome', protocol: PROTOCOL_VERSION });

    ws.on('message', (raw) => {
      let msg: FromApp;
      try {
        msg = JSON.parse(raw.toString()) as FromApp;
      } catch {
        return;
      }
      if (msg.type === 'hello') {
        const info = msg.app ?? { id: '', name: '' };
        if (!info.id || !ID_RE.test(info.id) || !info.name) {
          ws.close(4000, 'hello needs app.id (letters, digits, . _ -) and app.name');
          return;
        }
        const existing = this.apps.get(info.id);
        if (existing && existing.ws !== ws) existing.ws.close(4001, 'replaced by a newer connection');
        app = { id: info.id, name: String(info.name).slice(0, 60), icon: info.icon, tint: info.tint, description: info.description, ws, viewers: existing?.viewers ?? new Set() };
        this.apps.set(info.id, app);
        log.info(`sdk app connected: ${app.id}`);
        if (app.viewers.size) sendApp({ type: 'open', viewers: app.viewers.size });
        return;
      }
      if (!app) return;
      if (msg.type === 'view' && msg.view && Array.isArray(msg.view.screens)) {
        const view: AppView = {
          ...msg.view,
          v: 1,
          app: { id: `sdk:${app.id}`, name: app.name, icon: app.icon, tint: app.tint, source: 'sdk' },
        };
        app.view = view;
        for (const v of app.viewers) v({ type: 'view', view });
      } else if (msg.type === 'toast' && typeof msg.text === 'string' && app.view) {
        for (const v of app.viewers) v({ type: 'view', view: { ...app.view, toast: msg.text } });
      }
    });

    ws.on('close', () => {
      if (app && this.apps.get(app.id)?.ws === ws) {
        this.apps.delete(app.id);
        for (const v of app.viewers) v({ type: 'ended', message: `${app.name} disconnected.` });
        log.info(`sdk app disconnected: ${app.id}`);
      }
    });
    ws.on('error', () => ws.terminate());
  }

  list(): AppSummary[] {
    return [...this.apps.values()].map((a) => ({
      id: `sdk:${a.id}`,
      name: a.name,
      title: a.description,
      icon: a.icon ?? { symbol: 'app.connected.to.app.below.fill', color: 'indigo', style: 'tile' },
      kind: 'sdk',
      running: true,
    }));
  }

  has(id: string): boolean {
    return this.apps.has(id);
  }

  /** A phone opened an SDK app: relay its view and forward its actions. */
  open(id: string, send: (m: ServerMessage) => void): { handle(m: ClientMessage): void; close(): void } | undefined {
    const app = this.apps.get(id);
    if (!app) return undefined;
    app.viewers.add(send);
    const tell = (m: ToApp) => {
      const current = this.apps.get(id);
      if (current && current.ws.readyState === current.ws.OPEN) current.ws.send(JSON.stringify(m));
    };
    tell({ type: 'open', viewers: app.viewers.size });
    if (app.view) send({ type: 'view', view: app.view });
    else send({ type: 'status', message: `Waiting for ${app.name}…` });
    return {
      handle: (m) => tell(m),
      close: () => {
        const current = this.apps.get(id) ?? app;
        current.viewers.delete(send);
        if (current.viewers.size === 0) tell({ type: 'close' });
      },
    };
  }
}
