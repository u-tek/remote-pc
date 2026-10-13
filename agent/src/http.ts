import type { IncomingMessage, ServerResponse } from 'node:http';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  query: URLSearchParams;
  /** Parse the request body as JSON (max 32 MB, enough for a few photos as base64). */
  json<T = Record<string, unknown>>(): Promise<T>;
}

export type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

interface Route {
  method: string;
  regex: RegExp;
  keys: string[];
  handler: Handler;
}

/** Sentinel a handler returns when it has written the response itself (e.g. a file stream). */
export const HANDLED = Symbol('handled');

const MAX_JSON_BYTES = 32 * 1024 * 1024;

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): void {
    const keys: string[] = [];
    const source = pattern
      .split('/')
      .map((seg) => {
        if (seg.startsWith(':')) {
          keys.push(seg.slice(1));
          return '([^/]+)';
        }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    this.routes.push({ method, regex: new RegExp(`^${source}$`), keys, handler });
  }

  get(p: string, h: Handler) {
    this.add('GET', p, h);
  }
  post(p: string, h: Handler) {
    this.add('POST', p, h);
  }
  put(p: string, h: Handler) {
    this.add('PUT', p, h);
  }
  delete(p: string, h: Handler) {
    this.add('DELETE', p, h);
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.regex.exec(url.pathname);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== req.method) continue;
      const params: Record<string, string> = {};
      route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      const ctx: Ctx = { req, res, url, params, query: url.searchParams, json: () => readJson(req) };
      try {
        const result = await route.handler(ctx);
        if (result === HANDLED) return true;
        sendJson(res, 200, result ?? { ok: true });
      } catch (err) {
        const status = err instanceof HttpError ? err.status : 500;
        const message = err instanceof Error ? err.message : String(err);
        if (!res.headersSent) sendJson(res, status, { error: message });
        else res.destroy();
      }
      return true;
    }
    if (pathMatched) {
      sendJson(res, 405, { error: 'method not allowed' });
      return true;
    }
    return false;
  }
}

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_JSON_BYTES) throw new HttpError(413, 'request body too large');
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {} as T;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  } catch {
    throw new HttpError(400, 'invalid JSON body');
  }
}

export function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new HttpError(400, `missing ${name}`);
  return value;
}
