import { spawn } from 'node:child_process';
import type { WebSocket } from 'ws';
import { HANDLED, HttpError, requireString, type Router } from '../http.js';
import { log } from '../log.js';
import type { Adapter } from './adapters/types.js';
import type { UiBackend, WindowInfo } from './backend.js';
import { appNameFor, documentTitle } from './rules/text.js';
import type { AppSummary, Choice, ClientMessage, ServerMessage } from './schema.js';
import type { SdkHub } from './sdk.js';
import { findNode, WindowSession } from './session.js';

export interface UiServiceOptions {
  backend: UiBackend;
  adapters: Adapter[];
  sdk: SdkHub;
  pollMs: () => number;
  screenReaderFlag: () => boolean;
  /** Windows needed for the window parts (tests pass true with a fake backend). */
  enabled: boolean;
}

/** Process names whose windows are not apps a person would open from the phone. */
const HIDDEN = /^(remote-pc-agent|node|conhost|textinputhost|searchhost|startmenuexperiencehost|shellexperiencehost|lockapp|systemsettingsadminflows)$/i;

/**
 * The phone's "apps": every open window (rewritten natively), plus SDK apps. One WebSocket per
 * open app at /api/ui?app=…; pictures of controls at /api/ui/image; live areas at /api/ui/region.
 */
export class UiService {
  private sessions = new Set<WindowSession>();
  private sockets = new Set<WebSocket>();
  private memory = new Map<number, Record<string, Choice[]>>();
  private crops = new Map<string, Buffer>();
  private icons = new Map<number, Buffer | null>();
  private readerOn = false;

  constructor(private readonly opts: UiServiceOptions) {}

  private requireEnabled(): void {
    if (!this.opts.enabled) throw new HttpError(501, 'Apps need a Windows PC.');
  }

  async apps(): Promise<AppSummary[]> {
    const out: AppSummary[] = [];
    if (this.opts.enabled) {
      const windows = await this.opts.backend.windows();
      for (const w of windows) {
        if (!w.title || HIDDEN.test(w.process)) continue;
        out.push(this.summary(w));
      }
    }
    out.push(...this.opts.sdk.list());
    return out;
  }

  private summary(w: WindowInfo): AppSummary {
    const name = appNameFor(w.process, w.title);
    const adapter = this.opts.adapters.find((a) => a.matches({ process: w.process, title: w.title }));
    const title = documentTitle(w.title, name);
    return {
      id: `w${w.hwnd}`,
      name,
      title: title !== name ? title : undefined,
      icon: { image: `/api/windows/${w.hwnd}/icon` },
      kind: 'window',
      adapter: adapter?.id,
      running: true,
      focused: w.foreground || undefined,
    };
  }

  private async setReader(on: boolean): Promise<void> {
    if (!this.opts.screenReaderFlag() || this.readerOn === on || !this.opts.enabled) return;
    this.readerOn = on;
    await this.opts.backend.screenReader(on).catch((err) => log.warn('screen reader flag', err));
  }

  /** A phone opened an app. */
  attach(ws: WebSocket, url: URL): void {
    this.sockets.add(ws);
    ws.once('close', () => this.sockets.delete(ws));
    const send = (m: ServerMessage) => {
      if (ws.readyState !== ws.OPEN) return;
      ws.send(JSON.stringify(m));
      if (m.type === 'ended') setTimeout(() => ws.close(), 100);
    };
    const app = url.searchParams.get('app') ?? '';
    let handle: ((m: ClientMessage) => void) | undefined;
    let close: () => void = () => undefined;

    if (app.startsWith('sdk:')) {
      const viewer = this.opts.sdk.open(app.slice(4), send);
      if (!viewer) {
        send({ type: 'ended', message: 'That app is not running any more.' });
        ws.close();
        return;
      }
      handle = viewer.handle;
      close = viewer.close;
    } else if (/^w\d+$/.test(app) && this.opts.enabled) {
      const session = new WindowSession(Number(app.slice(1)), { backend: this.opts.backend, adapters: this.opts.adapters, pollMs: this.opts.pollMs(), memory: this.memory }, send);
      this.sessions.add(session);
      void this.setReader(true);
      void session.start();
      handle = (m) => void session.handle(m);
      close = () => {
        session.close();
        this.sessions.delete(session);
        if (this.sessions.size === 0) void this.setReader(false);
      };
    } else {
      send({ type: 'ended', message: this.opts.enabled ? 'Unknown app.' : 'Apps need a Windows PC.' });
      ws.close();
      return;
    }

    let alive = true;
    const heartbeat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 25_000);
    ws.on('pong', () => (alive = true));
    ws.on('message', (raw) => {
      alive = true;
      try {
        const msg = JSON.parse(raw.toString()) as ClientMessage;
        if (msg && typeof msg === 'object' && typeof msg.type === 'string') handle?.(msg);
      } catch {
        // ignore malformed messages
      }
    });
    ws.on('close', () => {
      clearInterval(heartbeat);
      close();
    });
    ws.on('error', () => ws.terminate());
  }

  private latest(hwnd: number) {
    for (const s of this.sessions) if (s.hwnd === hwnd && s.snapshot) return s.snapshot;
    return undefined;
  }

  register(router: Router): void {
    router.get('/api/ui/apps', () => this.apps());

    // Picture of one control (icons, avatars, photos, thumbnails) from the latest snapshot.
    router.get('/api/ui/image', async ({ query, res }) => {
      this.requireEnabled();
      const app = requireString(query.get('app'), 'app');
      const nodeId = requireString(query.get('node'), 'node');
      const hwnd = Number(app.slice(1));
      const snap = this.latest(hwnd);
      const node = snap ? findNode(snap, nodeId) : undefined;
      if (!node?.r) throw new HttpError(404, 'That picture is not on screen any more.');
      const [x, y, w, h] = node.r;
      const key = `${hwnd}:${nodeId}:${w}x${h}`;
      let img = this.crops.get(key);
      const png = w <= 160 && h <= 160;
      if (!img) {
        img = await this.opts.backend.crop(hwnd, [x, y, w, h], Math.min(w, 1200), png ? 'png' : 'jpeg');
        if (this.crops.size > 500) this.crops.delete(this.crops.keys().next().value!);
        this.crops.set(key, img);
      }
      res.writeHead(200, { 'content-type': png ? 'image/png' : 'image/jpeg', 'content-length': img.length, 'cache-control': 'max-age=60' });
      res.end(img);
      return HANDLED;
    });

    // A live area of a window (video, canvas): a fresh JPEG each time.
    router.get('/api/ui/region', async ({ query, res }) => {
      this.requireEnabled();
      const app = requireString(query.get('app'), 'app');
      const rect = requireString(query.get('rect'), 'rect').split(',').map(Number);
      if (rect.length !== 4 || rect.some((v) => !Number.isFinite(v))) throw new HttpError(400, 'rect must be x,y,w,h');
      const width = Math.min(1600, Math.max(64, Number(query.get('w') ?? 800) || 800));
      const hwnd = Number(app.slice(1));
      await this.opts.backend.invalidate(hwnd);
      const img = await this.opts.backend.crop(hwnd, rect as [number, number, number, number], width, 'jpeg');
      res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': img.length, 'cache-control': 'no-store' });
      res.end(img);
      return HANDLED;
    });

    router.get('/api/windows/:hwnd/icon', async ({ params, res }) => {
      this.requireEnabled();
      const hwnd = Number(params.hwnd);
      let png = this.icons.get(hwnd);
      if (png === undefined) {
        png = await this.opts.backend.windowIcon(hwnd);
        if (this.icons.size > 300) this.icons.clear();
        this.icons.set(hwnd, png);
      }
      if (!png) throw new HttpError(404, 'No icon');
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length, 'cache-control': 'max-age=3600' });
      res.end(png);
      return HANDLED;
    });

    // Start an app from the Start menu and return the window it opens, so the phone can show it.
    router.post('/api/ui/launch', async (ctx) => {
      this.requireEnabled();
      const { id } = await ctx.json<{ id?: string }>();
      const appId = requireString(id, 'id');
      const before = new Set((await this.opts.backend.windows()).map((w) => w.hwnd));
      spawn('explorer.exe', [`shell:AppsFolder\\${appId}`], { detached: true, stdio: 'ignore' }).unref();
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 400));
        const fresh = (await this.opts.backend.windows()).find((w) => !before.has(w.hwnd) && w.title && !HIDDEN.test(w.process));
        if (fresh) return { app: this.summary(fresh) };
      }
      return { app: null };
    });
  }

  shutdown(): void {
    for (const s of this.sessions) s.close();
    this.sessions.clear();
    for (const ws of this.sockets) ws.terminate();
    this.sockets.clear();
    void this.setReader(false);
  }
}
