import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { Router, sendJson } from './http.js';
import type { Hub, HubEvent } from './hub.js';
import { log } from './log.js';

export interface AppOptions {
  token: () => string;
  hub: Hub;
  router: Router;
  /** Extra data sent to each WebSocket client when it connects. */
  hello: () => Promise<Record<string, unknown>>;
  /** Other authenticated WebSocket endpoints, keyed by path (e.g. the screen stream). */
  sockets?: Record<string, (ws: WebSocket, url: URL) => void>;
}

function tokenFrom(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  const url = new URL(req.url ?? '/', 'http://localhost');
  return url.searchParams.get('token') ?? undefined;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Slows down token guessing: after 10 failures from one address, refuse it for a while. */
class FailureLimiter {
  private failures = new Map<string, { count: number; first: number }>();

  blocked(ip: string): boolean {
    const f = this.failures.get(ip);
    if (!f) return false;
    if (Date.now() - f.first > 5 * 60_000) {
      this.failures.delete(ip);
      return false;
    }
    return f.count >= 10;
  }

  fail(ip: string): void {
    const f = this.failures.get(ip);
    if (!f || Date.now() - f.first > 5 * 60_000) this.failures.set(ip, { count: 1, first: Date.now() });
    else f.count++;
  }
}

export function createApp(opts: AppOptions) {
  const limiter = new FailureLimiter();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

  const authorized = (req: IncomingMessage): 'ok' | 'denied' | 'blocked' => {
    const ip = req.socket.remoteAddress ?? 'unknown';
    if (limiter.blocked(ip)) return 'blocked';
    const token = tokenFrom(req);
    if (token && safeEqual(token, opts.token())) return 'ok';
    limiter.fail(ip);
    return 'denied';
  };

  async function handler(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/health') return sendJson(res, 200, { ok: true });
    if (!url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'not found' });
    const auth = authorized(req);
    if (auth === 'blocked') return sendJson(res, 429, { error: 'Too many failed attempts, try again later' });
    if (auth === 'denied') return sendJson(res, 401, { error: 'Invalid or missing token. Pair the app again.' });
    try {
      const handled = await opts.router.handle(req, res);
      if (!handled) sendJson(res, 404, { error: 'not found' });
    } catch (err) {
      log.error('request failed', req.method, url.pathname, err);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
    }
  }

  function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const extra = opts.sockets?.[url.pathname];
    if ((url.pathname !== '/api/ws' && !extra) || authorized(req) !== 'ok') {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    // Low latency matters more than packet efficiency for input and video.
    if ('setNoDelay' in socket && typeof socket.setNoDelay === 'function') socket.setNoDelay(true);
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (extra) extra(ws, url);
      else void onConnection(ws);
    });
  }

  async function onConnection(ws: WebSocket) {
    let alive = true;
    const send = (data: unknown) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(data));
    };
    const unsubscribe = opts.hub.onEvent((e: HubEvent) => send(e));
    const heartbeat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, 25_000);
    ws.on('pong', () => (alive = true));
    ws.on('message', (raw) => {
      alive = true;
      try {
        const msg = JSON.parse(raw.toString()) as { type?: string };
        if (msg.type === 'ping') send({ type: 'pong' });
      } catch {
        // ignore malformed client messages
      }
    });
    ws.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
    ws.on('error', () => ws.terminate());
    send({ type: 'hello', ...(await opts.hello()) });
  }

  return { handler, upgrade, close: () => wss.close() };
}
