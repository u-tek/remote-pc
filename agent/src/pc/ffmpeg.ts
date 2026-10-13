import { createWriteStream, existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { log } from '../log.js';
import { run } from './proc.js';

export interface Quality {
  maxDim: number;
  fps: number;
  kbps: number;
}

export const QUALITIES: Record<string, Quality> = {
  high: { maxDim: 1920, fps: 60, kbps: 12000 },
  balanced: { maxDim: 1600, fps: 60, kbps: 6000 },
  low: { maxDim: 1280, fps: 30, kbps: 2500 },
  saver: { maxDim: 960, fps: 24, kbps: 1000 },
};

/** What to capture. Coordinates for ddagrab are relative to the monitor (DXGI output). */
export type Capture =
  | { kind: 'ddagrab'; output: number; x: number; y: number; width: number; height: number; full: boolean }
  | { kind: 'gdigrab'; x: number; y: number; width: number; height: number }
  | { kind: 'test'; width: number; height: number };

export interface Pipeline {
  encoder: string;
  /** Keep frames on the GPU (scale_d3d11) instead of copying them back to the CPU. */
  gpu: boolean;
}

export interface Probe {
  encoders: string[];
  ddagrab: boolean;
  scaleD3d11: boolean;
}

const HW_ENCODERS = ['h264_nvenc', 'h264_amf', 'h264_qsv', 'h264_mf'];

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

/** Fit the captured size inside `maxDim` (long side), keeping even dimensions for the encoder. */
export function outputSize(width: number, height: number, maxDim: number): { width: number; height: number } {
  const scale = Math.min(1, maxDim / Math.max(width, height));
  return { width: even(Math.round(width * scale)), height: even(Math.round(height * scale)) };
}

function encoderArgs(encoder: string, q: Quality): string[] {
  const br = `${q.kbps}k`;
  const buf = `${Math.max(200, Math.round(q.kbps / 2))}k`;
  const gop = String(q.fps * 2);
  switch (encoder) {
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', 'p1', '-tune', 'ull', '-zerolatency', '1', '-rc', 'cbr', '-b:v', br, '-maxrate', br, '-bufsize', buf, '-g', gop, '-bf', '0'];
    case 'h264_amf':
      return ['-c:v', 'h264_amf', '-usage', 'ultralowlatency', '-quality', 'speed', '-rc', 'cbr', '-b:v', br, '-maxrate', br, '-bufsize', buf, '-g', gop, '-bf', '0'];
    case 'h264_qsv':
      return ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-async_depth', '1', '-b:v', br, '-maxrate', br, '-bufsize', buf, '-g', gop, '-bf', '0'];
    case 'h264_mf':
      return ['-c:v', 'h264_mf', '-hw_encoding', '1', '-scenario', 'display_remoting', '-rate_control', 'cbr', '-b:v', br, '-g', gop];
    default:
      return ['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-b:v', br, '-maxrate', br, '-bufsize', buf, '-g', gop, '-bf', '0'];
  }
}

/** Build the ffmpeg command line for one capture → H.264 → FLV-on-stdout pipeline. */
export function buildArgs(p: Pipeline, cap: Capture, q: Quality, out: { width: number; height: number }): string[] {
  const pix = p.encoder === 'libx264' ? 'yuv420p' : 'nv12';
  const cpuScale = [`scale=${out.width}:${out.height}:flags=bilinear`, `format=${pix}`];
  let input: string[];
  let filters: string[];
  switch (cap.kind) {
    case 'ddagrab': {
      const opts = [`output_idx=${cap.output}`, `framerate=${q.fps}`, 'draw_mouse=1'];
      if (!cap.full) opts.push(`video_size=${cap.width}x${cap.height}`, `offset_x=${cap.x}`, `offset_y=${cap.y}`);
      input = ['-fflags', 'nobuffer', '-f', 'lavfi', '-i', `ddagrab=${opts.join(':')}`];
      filters = p.gpu ? [`scale_d3d11=width=${out.width}:height=${out.height}:format=nv12`] : ['hwdownload', 'format=bgra', ...cpuScale];
      break;
    }
    case 'gdigrab':
      input = [
        '-fflags', 'nobuffer', '-f', 'gdigrab', '-framerate', String(q.fps), '-draw_mouse', '1',
        '-offset_x', String(cap.x), '-offset_y', String(cap.y), '-video_size', `${cap.width}x${cap.height}`, '-i', 'desktop',
      ];
      filters = cpuScale;
      break;
    case 'test':
      input = ['-re', '-f', 'lavfi', '-i', `testsrc2=size=${cap.width}x${cap.height}:rate=${q.fps}`];
      filters = cpuScale;
      break;
  }
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    ...input,
    '-vf', filters.join(','),
    ...encoderArgs(p.encoder, q),
    '-an', '-flags', '+low_delay', '-flush_packets', '1',
    '-f', 'flv', '-flvflags', 'no_duration_filesize', 'pipe:1',
  ];
}

/** Candidate pipelines, best first. The streamer falls back down this list when one fails. */
export function pipelinesFor(probe: Probe, capture: Capture['kind']): Pipeline[] {
  const list: Pipeline[] = [];
  for (const encoder of probe.encoders) {
    if (capture === 'ddagrab' && probe.scaleD3d11 && (encoder === 'h264_nvenc' || encoder === 'h264_amf')) list.push({ encoder, gpu: true });
    list.push({ encoder, gpu: false });
  }
  return list;
}

/** Finds ffmpeg (or downloads a build on Windows) and works out which H.264 encoders really work. */
export class FfmpegManager {
  private located?: string;
  private downloading?: Promise<string>;
  private listeners = new Set<(message: string) => void>();
  private probes = new Map<string, Promise<Probe>>();
  /** Last pipeline that worked, tried first next time. */
  preferred?: Pipeline;

  constructor(
    private readonly dir: string,
    private readonly configured?: string,
  ) {}

  private downloadDir() {
    return path.join(this.dir, 'ffmpeg');
  }

  private findExe(dir: string, depth = 0): string | undefined {
    if (depth > 4 || !existsSync(dir)) return undefined;
    for (const entry of readdirSync(dir)) {
      const p = path.join(dir, entry);
      if (/^ffmpeg(\.exe)?$/i.test(entry) && statSync(p).isFile()) return p;
      if (statSync(p).isDirectory()) {
        const found = this.findExe(p, depth + 1);
        if (found) return found;
      }
    }
    return undefined;
  }

  async find(): Promise<string | undefined> {
    if (this.located && existsSync(this.located)) return this.located;
    if (this.configured && existsSync(this.configured)) return (this.located = this.configured);
    const downloaded = this.findExe(this.downloadDir());
    if (downloaded) return (this.located = downloaded);
    const which = await run(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], 10_000).catch(() => undefined);
    const first = which?.code === 0 ? which.stdout.split(/\r?\n/).map((l) => l.trim()).find(Boolean) : undefined;
    if (first) return (this.located = first);
    return undefined;
  }

  status(): 'downloading' | 'unknown' {
    return this.downloading ? 'downloading' : 'unknown';
  }

  /** Resolve the ffmpeg path, downloading it on Windows if needed. Progress goes to `onProgress`. */
  async ensure(onProgress: (message: string) => void): Promise<string> {
    const found = await this.find();
    if (found) return found;
    if (process.platform !== 'win32') throw new Error('FFmpeg is not installed. Install it (e.g. apt install ffmpeg) and try again.');
    this.listeners.add(onProgress);
    try {
      if (!this.downloading) {
        this.downloading = this.download().finally(() => {
          this.downloading = undefined;
        });
      }
      return await this.downloading;
    } finally {
      this.listeners.delete(onProgress);
    }
  }

  private emit(message: string) {
    for (const l of this.listeners) l(message);
  }

  private async download(): Promise<string> {
    const arch = process.arch === 'arm64' ? 'winarm64' : 'win64';
    const url = `https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-${arch}-gpl.zip`;
    const target = this.downloadDir();
    const zip = path.join(this.dir, 'ffmpeg-download.zip');
    await mkdir(target, { recursive: true });
    log.info(`ffmpeg: downloading ${url}`);
    this.emit('Downloading FFmpeg for screen streaming (one time)…');
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`FFmpeg download failed (${res.status})`);
    const total = Number(res.headers.get('content-length') ?? 0);
    let received = 0;
    let lastPct = -1;
    const progress = new Transform({
      transform: (chunk: Buffer, _enc, cb) => {
        received += chunk.length;
        const pct = total ? Math.floor((received / total) * 100) : -1;
        if (pct >= 0 && pct !== lastPct && pct % 5 === 0) {
          lastPct = pct;
          this.emit(`Downloading FFmpeg… ${pct}%`);
        }
        cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), progress, createWriteStream(zip));
    this.emit('Unpacking FFmpeg…');
    // Windows 10+ ships bsdtar, which unpacks zips much faster than Expand-Archive.
    let unpacked = await run('tar', ['-xf', zip, '-C', target], 300_000).catch(() => undefined);
    if (unpacked?.code !== 0) {
      unpacked = await run('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${target}' -Force`], 600_000);
    }
    await rm(zip, { force: true });
    const exe = this.findExe(target);
    if (!exe) throw new Error(`Could not unpack FFmpeg: ${unpacked?.stderr ?? ''}`.trim());
    log.info(`ffmpeg: installed at ${exe}`);
    this.located = exe;
    return exe;
  }

  /** Which H.264 encoders actually work on this machine (hardware ones are test-encoded). */
  probe(ffmpeg: string): Promise<Probe> {
    let p = this.probes.get(ffmpeg);
    if (!p) {
      p = this.doProbe(ffmpeg);
      this.probes.set(ffmpeg, p);
      p.catch(() => this.probes.delete(ffmpeg));
    }
    return p;
  }

  private async doProbe(ffmpeg: string): Promise<Probe> {
    const [enc, filt] = await Promise.all([run(ffmpeg, ['-hide_banner', '-encoders']), run(ffmpeg, ['-hide_banner', '-filters'])]);
    const has = (text: string, name: string) => new RegExp(`\\s${name}\\s`).test(text);
    const encoders: string[] = [];
    for (const e of HW_ENCODERS) {
      if (!has(enc.stdout, e)) continue;
      const test = await run(
        ffmpeg,
        ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=30', '-frames:v', '3', ...encoderArgs(e, QUALITIES.balanced), '-f', 'null', '-'],
        20_000,
      ).catch(() => undefined);
      if (test?.code === 0) encoders.push(e);
    }
    if (has(enc.stdout, 'libx264')) encoders.push('libx264');
    const probe: Probe = { encoders, ddagrab: has(filt.stdout, 'ddagrab'), scaleD3d11: has(filt.stdout, 'scale_d3d11') };
    log.info(`ffmpeg: encoders ${encoders.join(', ') || 'none'}; ddagrab ${probe.ddagrab}; scale_d3d11 ${probe.scaleD3d11}`);
    if (!encoders.length) throw new Error('This FFmpeg has no usable H.264 encoder.');
    return probe;
  }
}
