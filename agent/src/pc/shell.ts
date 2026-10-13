import { spawn } from 'node:child_process';
import { HANDLED, HttpError, requireString, type Router } from '../http.js';
import type { WindowsHelper } from './helper.js';

interface AppEntry {
  name: string;
  id: string;
}

const WINDOW_ACTIONS = new Set(['focus', 'minimize', 'maximize', 'restore', 'close']);

function requireWindows(): void {
  if (process.platform !== 'win32') throw new HttpError(501, 'This feature needs Windows.');
}

/** Run a command and resolve when it exits (used for taskkill). */
function run(command: string, args: string[]): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(command, args, { windowsHide: true });
    let output = '';
    p.stdout.on('data', (d: Buffer) => (output += d.toString()));
    p.stderr.on('data', (d: Buffer) => (output += d.toString()));
    p.on('error', reject);
    p.on('exit', (code) => resolve({ code, output }));
  });
}

export function registerShellRoutes(router: Router, helper: WindowsHelper): void {
  let appsCache: { at: number; apps: AppEntry[] } | undefined;
  const iconCache = new Map<string, Buffer | null>();

  // ---- Start menu ----
  router.get('/api/apps', async ({ query }) => {
    requireWindows();
    if (!appsCache || Date.now() - appsCache.at > 10 * 60_000 || query.get('refresh') === '1') {
      const apps = await helper.call<AppEntry[]>('apps', {}, 60_000);
      const seen = new Set<string>();
      const unique = apps.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
      unique.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      appsCache = { at: Date.now(), apps: unique };
    }
    return appsCache.apps;
  });

  router.get('/api/apps/icon', async ({ query, res }) => {
    requireWindows();
    const id = requireString(query.get('id'), 'id');
    let png = iconCache.get(id);
    if (png === undefined) {
      const b64 = await helper.call<string | null>('appicon', { id, size: 96 }).catch(() => null);
      png = b64 ? Buffer.from(b64, 'base64') : null;
      if (iconCache.size > 1000) iconCache.clear();
      iconCache.set(id, png);
    }
    if (!png) throw new HttpError(404, 'No icon');
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length, 'cache-control': 'max-age=86400' });
    res.end(png);
    return HANDLED;
  });

  router.post('/api/apps/launch', async (ctx) => {
    requireWindows();
    const { id } = await ctx.json<{ id?: string }>();
    const appId = requireString(id, 'id');
    // Works for both classic and Store apps.
    spawn('explorer.exe', [`shell:AppsFolder\\${appId}`], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
  });

  // ---- Window switcher ----
  router.get('/api/windows', async () => {
    requireWindows();
    return helper.call('windows');
  });

  router.get('/api/windows/:hwnd/thumbnail', async ({ params, query, res }) => {
    requireWindows();
    const width = Math.min(1200, Math.max(120, Number(query.get('width') ?? 480) || 480));
    const b64 = await helper.call<string | null>('thumb', { hwnd: Number(params.hwnd), width });
    if (!b64) throw new HttpError(404, 'Window cannot be captured right now (minimized?)');
    const jpg = Buffer.from(b64, 'base64');
    res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': jpg.length, 'cache-control': 'no-store' });
    res.end(jpg);
    return HANDLED;
  });

  router.post('/api/windows/:hwnd/:action', async ({ params }) => {
    requireWindows();
    if (!WINDOW_ACTIONS.has(params.action)) throw new HttpError(400, `Unknown action ${params.action}`);
    const ok = await helper.call<boolean>('window', { hwnd: Number(params.hwnd), action: params.action });
    return { ok };
  });

  // ---- Task Manager ----
  router.get('/api/processes', async () => {
    requireWindows();
    return helper.call('processes', {}, 30_000);
  });

  router.post('/api/processes/:pid/kill', async ({ params, query }) => {
    requireWindows();
    const pid = Number(params.pid);
    if (!Number.isInteger(pid) || pid <= 4) throw new HttpError(400, 'Invalid process id');
    if (pid === process.pid) throw new HttpError(400, 'That is the Remote PC agent itself');
    const args = ['/PID', String(pid), '/F'];
    if (query.get('tree') === '1') args.push('/T');
    const { code, output } = await run('taskkill', args);
    if (code !== 0) throw new HttpError(500, output.trim() || `taskkill failed (${code})`);
    return { ok: true };
  });

  // ---- Clipboard ----
  router.get('/api/clipboard', async () => {
    requireWindows();
    return helper.call('clip_get');
  });

  router.post('/api/clipboard', async (ctx) => {
    requireWindows();
    const body = await ctx.json<{ text?: string; image?: string }>();
    if (typeof body.image === 'string' && body.image.length > 0) {
      await helper.call('clip_set_image', { data: body.image }, 30_000);
    } else {
      await helper.call('clip_set', { text: typeof body.text === 'string' ? body.text : '' });
    }
    return { ok: true };
  });
}
