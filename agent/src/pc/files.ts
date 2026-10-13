import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { HANDLED, HttpError, requireString, type Router } from '../http.js';
import type { WindowsHelper } from './helper.js';

export interface FileEntry {
  name: string;
  path: string;
  dir: boolean;
  size: number;
  mtime: number;
  hidden: boolean;
}

const SYSTEM_NAMES = new Set([
  'desktop.ini',
  'thumbs.db',
  '$recycle.bin',
  'system volume information',
  'pagefile.sys',
  'swapfile.sys',
  'hiberfil.sys',
  'dumpstack.log.tmp',
]);

const MIME: Record<string, string> = {
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.json': 'application/json',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.ts': 'text/plain; charset=utf-8',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export function mimeFor(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

export function isHiddenName(name: string): boolean {
  const lower = name.toLowerCase();
  return name.startsWith('.') || SYSTEM_NAMES.has(lower) || lower.startsWith('ntuser.');
}

function normalize(p: string): string {
  if (!p) throw new HttpError(400, 'missing path');
  if (!path.isAbsolute(p)) throw new HttpError(400, 'path must be absolute');
  return path.resolve(p);
}

export async function listDir(dir: string): Promise<{ path: string; parent: string | null; entries: FileEntry[] }> {
  const full = normalize(dir);
  let dirents;
  try {
    dirents = await readdir(full, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new HttpError(404, 'Folder not found');
    if (code === 'EPERM' || code === 'EACCES') throw new HttpError(403, 'Access denied');
    if (code === 'ENOTDIR') throw new HttpError(400, 'Not a folder');
    throw err;
  }
  const entries = await Promise.all(
    dirents.map(async (d): Promise<FileEntry | null> => {
      const p = path.join(full, d.name);
      try {
        const s = await stat(p);
        return { name: d.name, path: p, dir: s.isDirectory(), size: s.isDirectory() ? 0 : s.size, mtime: s.mtimeMs, hidden: isHiddenName(d.name) };
      } catch {
        // Broken links and locked system files.
        return { name: d.name, path: p, dir: d.isDirectory(), size: 0, mtime: 0, hidden: true };
      }
    }),
  );
  const list = entries.filter((e): e is FileEntry => e !== null);
  list.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) : a.dir ? -1 : 1));
  const parent = path.dirname(full);
  return { path: full, parent: parent === full ? null : parent, entries: list };
}

async function knownPlaces(helper: WindowsHelper): Promise<Array<{ name: string; path: string; icon: string }>> {
  const home = os.homedir();
  let folders: Record<string, string> = {
    home,
    desktop: path.join(home, 'Desktop'),
    documents: path.join(home, 'Documents'),
    downloads: path.join(home, 'Downloads'),
    pictures: path.join(home, 'Pictures'),
    videos: path.join(home, 'Videos'),
    music: path.join(home, 'Music'),
  };
  if (process.platform === 'win32') {
    // Desktop/Documents are often redirected to OneDrive; ask Windows where they are.
    folders = { ...folders, ...(await helper.call<Record<string, string>>('folders').catch(() => ({}))) };
  }
  const places = [
    { name: 'Home', key: 'home', icon: 'house' },
    { name: 'Desktop', key: 'desktop', icon: 'menubar.dock.rectangle' },
    { name: 'Documents', key: 'documents', icon: 'doc' },
    { name: 'Downloads', key: 'downloads', icon: 'arrow.down.circle' },
    { name: 'Pictures', key: 'pictures', icon: 'photo' },
    { name: 'Videos', key: 'videos', icon: 'film' },
    { name: 'Music', key: 'music', icon: 'music.note' },
  ];
  return places.filter((p) => folders[p.key] && existsSync(folders[p.key])).map((p) => ({ name: p.name, path: folders[p.key], icon: p.icon }));
}

function drives(): Array<{ name: string; path: string }> {
  if (process.platform !== 'win32') return [{ name: '/', path: '/' }];
  const out: Array<{ name: string; path: string }> = [];
  for (let c = 67; c <= 90; c++) {
    const letter = String.fromCharCode(c);
    if (existsSync(`${letter}:\\`)) out.push({ name: `${letter}:`, path: `${letter}:\\` });
  }
  return out;
}

async function streamFile(ctx: Parameters<Parameters<Router['get']>[1]>[0], file: string, download: boolean) {
  const s = await stat(file).catch(() => null);
  if (!s) throw new HttpError(404, 'File not found');
  if (s.isDirectory()) throw new HttpError(400, 'That is a folder');
  const headers: Record<string, string | number> = {
    'content-type': mimeFor(file),
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    'last-modified': new Date(s.mtimeMs).toUTCString(),
  };
  if (download) headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`;

  const range = ctx.req.headers.range;
  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
  if (match && s.size > 0) {
    let start = match[1] ? Number(match[1]) : NaN;
    let end = match[2] ? Number(match[2]) : s.size - 1;
    if (Number.isNaN(start)) {
      // suffix range: last N bytes
      start = Math.max(0, s.size - end);
      end = s.size - 1;
    }
    end = Math.min(end, s.size - 1);
    if (start > end || start >= s.size) {
      ctx.res.writeHead(416, { 'content-range': `bytes */${s.size}` });
      ctx.res.end();
      return HANDLED;
    }
    ctx.res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${s.size}`, 'content-length': end - start + 1 });
    if (ctx.req.method === 'HEAD') {
      ctx.res.end();
      return HANDLED;
    }
    await pipeline(createReadStream(file, { start, end }), ctx.res);
    return HANDLED;
  }
  ctx.res.writeHead(200, { ...headers, 'content-length': s.size });
  if (ctx.req.method === 'HEAD') {
    ctx.res.end();
    return HANDLED;
  }
  await pipeline(createReadStream(file), ctx.res);
  return HANDLED;
}

export function registerFileRoutes(router: Router, helper: WindowsHelper): void {
  router.get('/api/fs/roots', async () => ({ places: await knownPlaces(helper), drives: drives() }));

  router.get('/api/fs/list', async ({ query }) => listDir(query.get('path') ?? ''));

  router.get('/api/fs/file', async (ctx) => streamFile(ctx, normalize(ctx.query.get('path') ?? ''), ctx.query.get('download') === '1'));
  router.add('HEAD', '/api/fs/file', async (ctx) => streamFile(ctx, normalize(ctx.query.get('path') ?? ''), false));

  // Raw body upload: PUT /api/fs/file?path=C:\Users\me\Desktop\photo.jpg&overwrite=1
  router.put('/api/fs/file', async (ctx) => {
    const target = normalize(ctx.query.get('path') ?? '');
    const overwrite = ctx.query.get('overwrite') === '1';
    const parent = await stat(path.dirname(target)).catch(() => null);
    if (!parent?.isDirectory()) throw new HttpError(404, 'Destination folder not found');
    if (!overwrite && existsSync(target)) throw new HttpError(409, 'A file with that name already exists');
    const tmp = `${target}.uploading-${process.pid}`;
    try {
      await pipeline(ctx.req, createWriteStream(tmp));
      await rename(tmp, target);
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
    const s = await stat(target);
    return { path: target, size: s.size };
  });

  router.post('/api/fs/mkdir', async (ctx) => {
    const body = await ctx.json<{ path?: string }>();
    const target = normalize(requireString(body.path, 'path'));
    if (existsSync(target)) throw new HttpError(409, 'Already exists');
    await mkdir(target, { recursive: true });
    return { path: target };
  });

  router.post('/api/fs/rename', async (ctx) => {
    const body = await ctx.json<{ from?: string; to?: string }>();
    const from = normalize(requireString(body.from, 'from'));
    const to = normalize(requireString(body.to, 'to'));
    if (existsSync(to)) throw new HttpError(409, 'Something with that name already exists');
    await rename(from, to);
    return { path: to };
  });

  router.post('/api/fs/delete', async (ctx) => {
    const body = await ctx.json<{ path?: string; permanent?: boolean }>();
    const target = normalize(requireString(body.path, 'path'));
    if (!existsSync(target)) throw new HttpError(404, 'Not found');
    if (process.platform === 'win32' && !body.permanent) {
      await helper.call('recycle', { path: target }, 60_000);
      return { recycled: true };
    }
    await rm(target, { recursive: true, force: false });
    return { recycled: false };
  });

  // Open a file or folder on the PC with its default app.
  router.post('/api/fs/open', async (ctx) => {
    const body = await ctx.json<{ path?: string }>();
    const target = normalize(requireString(body.path, 'path'));
    if (!existsSync(target)) throw new HttpError(404, 'Not found');
    if (process.platform !== 'win32') throw new HttpError(501, 'This feature needs Windows.');
    spawn('explorer.exe', [target], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
    return { ok: true };
  });
}
