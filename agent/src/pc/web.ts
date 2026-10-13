import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import type { ConfigStore, WebBookmark } from '../config.js';
import { HttpError, type Router } from '../http.js';
import { log } from '../log.js';

interface Forwarder {
  bookmark: WebBookmark;
  server?: net.Server;
  /** Port the phone connects to. */
  publicPort: number;
  mode: 'forward' | 'direct' | 'failed';
  error?: string;
}

/** Ports that are almost never something you want to open in a browser. */
const IGNORED_PORTS = new Set([135, 139, 445, 5040, 5357, 7680, 41641]);

function probe(host: string, port: number, timeoutMs = 600): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

function listen(server: net.Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

/**
 * Makes web UIs that only listen on localhost (dev servers, ComfyUI, Jupyter, …) reachable
 * from the phone by forwarding <tailscale-ip>:<port> to 127.0.0.1:<port>.
 */
export class WebForwarder {
  private forwarders = new Map<string, Forwarder>();

  constructor(
    private readonly store: ConfigStore,
    private readonly forwardHost: string,
    private readonly advertiseHost: string,
    private readonly agentPort: number,
  ) {}

  async startAll(): Promise<void> {
    for (const b of this.store.data.web) await this.ensure(b);
  }

  private async ensure(bookmark: WebBookmark): Promise<Forwarder> {
    const existing = this.forwarders.get(bookmark.id);
    if (existing) return existing;
    const fwd: Forwarder = { bookmark, publicPort: bookmark.port, mode: 'failed' };
    this.forwarders.set(bookmark.id, fwd);
    if (this.forwardHost === '127.0.0.1') {
      fwd.mode = 'direct';
      return fwd;
    }
    const create = () =>
      net.createServer((client) => {
        const upstream = net.connect({ host: '127.0.0.1', port: bookmark.port });
        client.pipe(upstream).pipe(client);
        const close = () => {
          client.destroy();
          upstream.destroy();
        };
        client.on('error', close);
        upstream.on('error', close);
      });
    for (const port of [bookmark.port, bookmark.port + 10000]) {
      const server = create();
      try {
        await listen(server, this.forwardHost, port);
        fwd.server = server;
        fwd.publicPort = port;
        fwd.mode = 'forward';
        fwd.error = undefined;
        return fwd;
      } catch (err) {
        server.close();
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EADDRINUSE' && port === bookmark.port && (await probe(this.advertiseHost, port))) {
          // The app already listens on all interfaces; the phone can reach it directly.
          fwd.mode = 'direct';
          return fwd;
        }
        fwd.error = (err as Error).message;
      }
    }
    log.warn(`web: could not forward port ${bookmark.port}: ${fwd.error}`);
    return fwd;
  }

  private stop(id: string) {
    const fwd = this.forwarders.get(id);
    fwd?.server?.close();
    this.forwarders.delete(id);
  }

  async list() {
    const items = await Promise.all(
      this.store.data.web.map(async (b) => {
        const fwd = await this.ensure(b);
        const up = await probe('127.0.0.1', b.port);
        const pathPart = b.path ? (b.path.startsWith('/') ? b.path : `/${b.path}`) : '/';
        return {
          id: b.id,
          name: b.name,
          port: b.port,
          path: b.path ?? '',
          url: `http://${this.advertiseHost}:${fwd.publicPort}${pathPart}`,
          up,
          mode: fwd.mode,
          error: fwd.error,
        };
      }),
    );
    return { host: this.advertiseHost, items, listening: await this.listening() };
  }

  async add(input: { name?: string; port?: number; path?: string }) {
    const port = Number(input.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new HttpError(400, 'Invalid port');
    if (port === this.agentPort) throw new HttpError(400, 'That is the Remote PC agent port');
    const bookmark: WebBookmark = { id: randomUUID(), name: input.name?.trim() || `Port ${port}`, port, path: input.path?.trim() || undefined };
    this.store.update((c) => c.web.push(bookmark));
    await this.ensure(bookmark);
    return bookmark;
  }

  remove(id: string) {
    this.stop(id);
    this.store.update((c) => {
      c.web = c.web.filter((b) => b.id !== id);
    });
  }

  /** Local TCP ports in LISTEN state with their owning process, for one-tap bookmarking. */
  async listening(): Promise<Array<{ port: number; process: string }>> {
    if (process.platform !== 'win32') return [];
    const netstat = await capture('netstat', ['-ano', '-p', 'TCP']).catch(() => '');
    const pids = new Map<number, number>();
    for (const line of netstat.split(/\r?\n/)) {
      const m = /^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)/i.exec(line);
      if (!m) continue;
      const [, addr, portStr, pidStr] = m;
      if (!['127.0.0.1', '0.0.0.0', '[::]', '[::1]'].includes(addr)) continue;
      const port = Number(portStr);
      if (port >= 49152 || IGNORED_PORTS.has(port) || port === this.agentPort) continue;
      if (!pids.has(port)) pids.set(port, Number(pidStr));
    }
    if (pids.size === 0) return [];
    const tasklist = await capture('tasklist', ['/FO', 'CSV', '/NH']).catch(() => '');
    const names = new Map<number, string>();
    for (const line of tasklist.split(/\r?\n/)) {
      const m = /^"([^"]+)","(\d+)"/.exec(line);
      if (m) names.set(Number(m[2]), m[1].replace(/\.exe$/i, ''));
    }
    return [...pids.entries()].sort((a, b) => a[0] - b[0]).map(([port, pid]) => ({ port, process: names.get(pid) ?? `PID ${pid}` }));
  }

  stopAll() {
    for (const id of [...this.forwarders.keys()]) this.stop(id);
  }
}

function capture(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(command, args, { windowsHide: true });
    let out = '';
    p.stdout.on('data', (d: Buffer) => (out += d.toString()));
    p.on('error', reject);
    p.on('exit', () => resolve(out));
  });
}

export function registerWebRoutes(router: Router, web: WebForwarder): void {
  router.get('/api/web', () => web.list());
  router.post('/api/web', async (ctx) => web.add(await ctx.json<{ name?: string; port?: number; path?: string }>()));
  router.delete('/api/web/:id', ({ params }) => {
    web.remove(params.id);
    return { ok: true };
  });
}
