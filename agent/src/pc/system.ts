import { readFile } from 'node:fs/promises';
import { HANDLED, HttpError, requireString, type Router } from '../http.js';
import type { FfmpegManager } from './ffmpeg.js';
import type { WindowsHelper } from './helper.js';
import { keyCodes } from './keys.js';
import { run } from './proc.js';
import type { OutputInfo } from './stream.js';

function requireWindows(): void {
  if (process.platform !== 'win32') throw new HttpError(501, 'This feature needs Windows.');
}

function imageType(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
  if (buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return 'application/octet-stream';
}

/** Control Center (volume, media, power), wallpaper, monitors and live screen previews. */
export function registerSystemRoutes(router: Router, helper: WindowsHelper, input: WindowsHelper, ffmpeg: FfmpegManager): void {
  router.get('/api/system/status', async () => {
    requireWindows();
    return helper.call('status');
  });

  router.post('/api/system/volume', async (ctx) => {
    requireWindows();
    const body = await ctx.json<{ level?: number; muted?: boolean }>();
    const level = typeof body.level === 'number' ? Math.round(Math.min(100, Math.max(0, body.level))) : -1;
    const mute = typeof body.muted === 'boolean' ? String(body.muted) : '';
    return helper.call('volume', { level, mute });
  });

  router.post('/api/system/media', async (ctx) => {
    requireWindows();
    const { action } = await ctx.json<{ action?: string }>();
    await input.call('media', { action: requireString(action, 'action') });
    return { ok: true };
  });

  router.post('/api/system/keys', async (ctx) => {
    requireWindows();
    const { keys } = await ctx.json<{ keys?: string[] }>();
    await input.call('input', { k: 'keys', keys: keyCodes(keys) });
    return { ok: true };
  });

  router.post('/api/system/power', async (ctx) => {
    requireWindows();
    const { action } = await ctx.json<{ action?: string }>();
    switch (action) {
      case 'lock':
      case 'sleep':
      case 'displayoff':
        await helper.call('power', { action });
        return { ok: true };
      case 'restart':
      case 'shutdown': {
        const flag = action === 'restart' ? '/r' : '/s';
        const res = await run('shutdown', [flag, '/t', '10', '/c', `Remote PC: ${action} requested from your phone`]);
        if (res.code !== 0) throw new HttpError(500, res.stderr.trim() || res.stdout.trim() || `shutdown failed (${res.code})`);
        return { ok: true, inSeconds: 10 };
      }
      case 'cancel': {
        await run('shutdown', ['/a']);
        return { ok: true };
      }
      default:
        throw new HttpError(400, 'Unknown power action');
    }
  });

  router.get('/api/desktop/wallpaper', async ({ res }) => {
    requireWindows();
    const file = await helper.call<string | null>('wallpaper');
    if (!file) throw new HttpError(404, 'No wallpaper (solid color or slideshow)');
    const buf = await readFile(file);
    res.writeHead(200, { 'content-type': imageType(buf), 'content-length': buf.length, 'cache-control': 'max-age=600' });
    res.end(buf);
    return HANDLED;
  });

  router.get('/api/screen/outputs', async () => {
    requireWindows();
    return helper.call<OutputInfo[]>('outputs');
  });

  // Still image of a monitor for the home screen's live preview.
  router.get('/api/screen/thumbnail', async ({ query, res }) => {
    requireWindows();
    const outputs = await helper.call<OutputInfo[]>('outputs');
    const index = Number(query.get('output') ?? -1);
    const out = outputs.find((o) => o.index === index) ?? outputs.find((o) => o.primary) ?? outputs[0];
    if (!out) throw new HttpError(404, 'No monitors');
    const width = Math.min(1600, Math.max(160, Number(query.get('width') ?? 800) || 800));
    const b64 = await helper.call<string | null>('shot', { x: out.x, y: out.y, w: out.width, h: out.height, width });
    if (!b64) throw new HttpError(503, 'The screen cannot be captured right now (is the PC locked?)');
    const jpg = Buffer.from(b64, 'base64');
    res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': jpg.length, 'cache-control': 'no-store' });
    res.end(jpg);
    return HANDLED;
  });

  router.get('/api/stream/status', async () => {
    const path = await ffmpeg.find();
    return { ffmpeg: path ? 'ready' : ffmpeg.status() === 'downloading' ? 'downloading' : 'missing', path, preferred: ffmpeg.preferred };
  });
}
