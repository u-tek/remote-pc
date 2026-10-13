import { spawn, type ChildProcess } from 'node:child_process';
import type { WebSocket } from 'ws';
import { log } from '../log.js';
import { buildArgs, outputSize, pipelinesFor, QUALITIES, type Capture, type FfmpegManager, type Pipeline, type Probe, type Quality } from './ffmpeg.js';
import { configMessage, FlvParser, frameMessage, parseAvcConfig, splitNalus } from './flv.js';
import type { WindowsHelper } from './helper.js';
import { keyCodes } from './keys.js';

export interface OutputInfo {
  index: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  primary: boolean;
  dxgi: boolean;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  minimized?: boolean;
}

export interface StreamDeps {
  ffmpeg: FfmpegManager;
  /** Main helper: monitors, window bounds and placement. */
  helper: WindowsHelper;
  /** Separate helper process for input so clicks never queue behind slow requests. */
  input: WindowsHelper;
  defaultQuality: string;
  /** Tests only: stream a synthetic pattern instead of the screen. */
  testSource?: boolean;
}

const MAX_BUFFERED = 2 * 1024 * 1024;
const RESUME_BUFFERED = 256 * 1024;

const clamp01 = (n: unknown) => Math.min(1, Math.max(0, Number(n) || 0));
const evenDown = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

/**
 * One phone watching (and controlling) the PC screen. Owns an ffmpeg process that captures the
 * desktop or one window, encodes H.264 with the best encoder that works, and streams it as
 * binary WebSocket messages. Text messages from the phone are mouse/keyboard input.
 */
export class StreamSession {
  private proc?: ChildProcess;
  private closed = false;
  private relaunching = false;
  private qualityName: string;
  private quality: Quality;
  private mode: 'desktop' | 'window';
  private outputIndex: number;
  private hwnd?: number;
  private fit: boolean;
  private aspect: number;
  private savedPlacement?: number[];
  private region: Rect = { x: 0, y: 0, width: 0, height: 0 };
  /** Raw window bounds when capture started (app mode), to notice moves and resizes. */
  private lastBounds?: Rect;
  private capture?: Capture;
  private ffmpegPath?: string;
  private probe?: Probe;
  private outputs: OutputInfo[] = [];
  private skipping = false;
  private lastCongestedNotice = 0;
  private lastKeyframeRequest = 0;
  private watchTimer?: NodeJS.Timeout;
  private relPending = false;
  private relAccum = { x: 0, y: 0 };
  private frames = 0;

  constructor(
    private readonly ws: WebSocket,
    url: URL,
    private readonly deps: StreamDeps,
  ) {
    const q = url.searchParams;
    this.qualityName = QUALITIES[q.get('quality') ?? ''] ? q.get('quality')! : deps.defaultQuality in QUALITIES ? deps.defaultQuality : 'balanced';
    this.quality = QUALITIES[this.qualityName];
    this.mode = q.get('mode') === 'window' ? 'window' : 'desktop';
    this.outputIndex = Number(q.get('output') ?? -1);
    this.hwnd = q.get('hwnd') ? Number(q.get('hwnd')) : undefined;
    this.fit = q.get('fit') === '1';
    this.aspect = Math.min(3, Math.max(0.2, Number(q.get('aspect') ?? 0.46) || 0.46));
    ws.on('message', (raw, isBinary) => {
      if (!isBinary) this.onMessage(raw.toString());
    });
    ws.on('close', () => void this.close());
    ws.on('error', () => void this.close());
  }

  private send(obj: Record<string, unknown>) {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(obj));
  }

  private status(message: string) {
    this.send({ type: 'status', message });
  }

  async start(): Promise<void> {
    try {
      if (this.mode === 'window' && !this.hwnd) throw new Error('No window selected');
      this.status('Starting…');
      this.ffmpegPath = this.deps.testSource ? (await this.deps.ffmpeg.find()) ?? 'ffmpeg' : await this.deps.ffmpeg.ensure((m) => this.status(m));
      this.status('Checking your graphics card…');
      this.probe = await this.deps.ffmpeg.probe(this.ffmpegPath);
      this.status('Connecting to the screen…');
      this.capture = await this.resolveCapture();
      await this.launch();
      if (this.mode === 'window') this.watchTimer = setInterval(() => void this.watchWindow(), 1500);
    } catch (err) {
      this.fail(err);
    }
  }

  private fail(err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn('stream:', message);
    this.send({ type: 'error', message });
    setTimeout(() => this.ws.close(1011, 'stream failed'), 300);
  }

  private outputFor(rect: Rect): OutputInfo | undefined {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    return (
      this.outputs.find((o) => cx >= o.x && cx < o.x + o.width && cy >= o.y && cy < o.y + o.height) ??
      this.outputs.find((o) => o.primary) ??
      this.outputs[0]
    );
  }

  /** Work out the capture region (and, in app mode, shape the window to fit the phone). */
  private async resolveCapture(): Promise<Capture> {
    if (this.deps.testSource) {
      this.outputs = [{ index: 0, name: 'Test', x: 0, y: 0, width: 1280, height: 720, primary: true, dxgi: false }];
      this.region = { x: 0, y: 0, width: 1280, height: 720 };
      return { kind: 'test', width: 1280, height: 720 };
    }
    this.outputs = await this.deps.helper.call<OutputInfo[]>('outputs');
    if (!this.outputs.length) throw new Error('No monitors found');
    const ddagrab = Boolean(this.probe?.ddagrab);

    if (this.mode === 'desktop') {
      const out = this.outputs.find((o) => o.index === this.outputIndex) ?? this.outputs.find((o) => o.primary) ?? this.outputs[0];
      this.outputIndex = out.index;
      this.region = { x: out.x, y: out.y, width: out.width, height: out.height };
      if (ddagrab && out.dxgi) return { kind: 'ddagrab', output: out.index, x: 0, y: 0, width: out.width, height: out.height, full: true };
      return { kind: 'gdigrab', ...this.region };
    }

    // App mode: one window.
    let bounds = await this.deps.helper.call<Rect>('winbounds', { hwnd: this.hwnd });
    const monitor = this.outputFor(bounds);
    if (!monitor) throw new Error('No monitors found');
    if (this.fit) {
      if (!this.savedPlacement) this.savedPlacement = await this.deps.helper.call<number[]>('getplacement', { hwnd: this.hwnd });
      const height = Math.round(monitor.height * 0.9);
      const width = Math.min(monitor.width, Math.round(height * this.aspect));
      bounds = await this.deps.helper.call<Rect>('winplace', {
        hwnd: this.hwnd,
        x: monitor.x + Math.round((monitor.width - width) / 2),
        y: monitor.y + Math.round((monitor.height - height) / 2),
        w: width,
        h: height,
      });
    } else {
      await this.deps.helper.call('window', { hwnd: this.hwnd, action: bounds.minimized ? 'restore' : 'focus' });
      if (bounds.minimized) await this.deps.helper.call('window', { hwnd: this.hwnd, action: 'focus' });
      bounds = await this.deps.helper.call<Rect>('winbounds', { hwnd: this.hwnd });
    }
    this.lastBounds = bounds;
    const out = this.outputFor(bounds) ?? monitor;
    const x1 = Math.max(bounds.x, out.x);
    const y1 = Math.max(bounds.y, out.y);
    const x2 = Math.min(bounds.x + bounds.width, out.x + out.width);
    const y2 = Math.min(bounds.y + bounds.height, out.y + out.height);
    if (x2 - x1 < 16 || y2 - y1 < 16) throw new Error('That window is off screen or too small to show');
    this.region = { x: x1, y: y1, width: evenDown(x2 - x1), height: evenDown(y2 - y1) };
    if (ddagrab && out.dxgi) {
      return { kind: 'ddagrab', output: out.index, x: x1 - out.x, y: y1 - out.y, width: this.region.width, height: this.region.height, full: false };
    }
    return { kind: 'gdigrab', ...this.region };
  }

  private async launch() {
    const candidates = pipelinesFor(this.probe!, this.capture!.kind);
    const preferred = this.deps.ffmpeg.preferred;
    if (preferred) {
      const i = candidates.findIndex((c) => c.encoder === preferred.encoder && c.gpu === preferred.gpu);
      if (i > 0) candidates.unshift(...candidates.splice(i, 1));
    }
    let lastError = '';
    for (const pipeline of candidates) {
      if (this.closed) return;
      try {
        await this.run(pipeline);
        this.deps.ffmpeg.preferred = pipeline;
        return;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        log.warn(`stream: ${pipeline.encoder}${pipeline.gpu ? ' (gpu)' : ''} failed: ${lastError.split('\n')[0]}`);
      }
    }
    if (/AcquireNextFrame|access lost|ACCESS_LOST|E_ACCESSDENIED|Desktop duplication access denied/i.test(lastError)) {
      throw new Error('Windows is showing a secure screen (lock screen or an admin prompt). Unlock the PC to view it.');
    }
    throw new Error(`Could not start screen capture: ${lastError.split('\n')[0] || 'unknown error'}`);
  }

  /** Start ffmpeg with one pipeline; resolves once video is flowing. */
  private run(pipeline: Pipeline): Promise<void> {
    const out = outputSize(this.region.width, this.region.height, this.quality.maxDim);
    const args = buildArgs(pipeline, this.capture!, this.quality, out);
    const proc = spawn(this.ffmpegPath!, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = proc;
    const parser = new FlvParser();
    let lengthSize = 4;
    let stderr = '';
    return new Promise<void>((resolve, reject) => {
      let started = false;
      const timer = setTimeout(() => {
        if (!started) {
          proc.kill();
          reject(new Error(`no video after 10s ${stderr}`));
        }
      }, 10_000);
      proc.stdout!.on('data', (chunk: Buffer) => {
        let tags;
        try {
          tags = parser.push(chunk);
        } catch (err) {
          proc.kill();
          reject(err);
          return;
        }
        for (const tag of tags) {
          if (tag.packetType === 0) {
            const cfg = parseAvcConfig(tag.data);
            lengthSize = cfg.lengthSize;
            if (cfg.sps[0] && cfg.pps[0]) this.sendBinary(configMessage(cfg.sps[0], cfg.pps[0]), true);
          } else if (tag.packetType === 1) {
            if (!started) {
              started = true;
              clearTimeout(timer);
              this.send({
                type: 'meta',
                width: out.width,
                height: out.height,
                region: this.region,
                encoder: pipeline.encoder.replace('h264_', '') + (pipeline.gpu ? ' · GPU' : ''),
                quality: this.qualityName,
                mode: this.mode,
                output: this.outputIndex,
                outputs: this.outputs.map((o) => ({ index: o.index, name: o.name, width: o.width, height: o.height, primary: o.primary })),
              });
              resolve();
            }
            this.frames++;
            this.sendFrame(splitNalus(tag.data, lengthSize), tag.keyframe);
          }
        }
      });
      proc.stderr!.on('data', (d: Buffer) => {
        stderr = (stderr + d.toString()).slice(-2000);
      });
      proc.on('error', (err) => {
        clearTimeout(timer);
        if (!started) reject(err);
      });
      proc.on('exit', (code) => {
        clearTimeout(timer);
        if (!started) {
          reject(new Error(stderr.trim() || `ffmpeg exited (${code})`));
        } else if (this.proc === proc && !this.closed && !this.relaunching) {
          log.warn(`stream: ffmpeg exited mid-stream (${code}) ${stderr.trim()}`);
          // The display mode changed, a game went fullscreen, or the PC got locked: try again.
          void this.relaunch(true);
        }
      });
    });
  }

  private sendBinary(data: Buffer, force = false) {
    if (this.ws.readyState !== this.ws.OPEN) return;
    if (!force && this.ws.bufferedAmount > MAX_BUFFERED) return;
    this.ws.send(data, { binary: true });
  }

  private sendFrame(nalus: Buffer[], keyframe: boolean) {
    if (this.ws.readyState !== this.ws.OPEN || nalus.length === 0) return;
    const buffered = this.ws.bufferedAmount;
    if (this.skipping) {
      // Frames depend on each other; after dropping, resume only at a keyframe.
      if (!keyframe || buffered > RESUME_BUFFERED) return;
      this.skipping = false;
    }
    if (buffered > MAX_BUFFERED) {
      this.skipping = true;
      if (Date.now() - this.lastCongestedNotice > 5000) {
        this.lastCongestedNotice = Date.now();
        this.send({ type: 'congested' });
      }
      return;
    }
    this.ws.send(frameMessage(nalus, keyframe), { binary: true });
  }

  private async stopProc() {
    const proc = this.proc;
    this.proc = undefined;
    if (!proc || proc.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 2000);
      proc.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      proc.kill();
    });
  }

  private async relaunch(recompute: boolean) {
    if (this.relaunching || this.closed) return;
    this.relaunching = true;
    try {
      await this.stopProc();
      if (recompute) this.capture = await this.resolveCapture();
      this.skipping = false;
      await this.launch();
    } catch (err) {
      this.fail(err);
    } finally {
      this.relaunching = false;
    }
  }

  private async watchWindow() {
    if (this.closed || this.relaunching || !this.hwnd) return;
    try {
      const b = await this.deps.helper.call<Rect>('winbounds', { hwnd: this.hwnd });
      const last = this.lastBounds;
      const moved =
        !last || Math.abs(b.x - last.x) > 6 || Math.abs(b.y - last.y) > 6 || Math.abs(b.width - last.width) > 6 || Math.abs(b.height - last.height) > 6;
      if (b.minimized || moved) {
        this.send({ type: 'status', message: 'Window moved, following it…' });
        await this.relaunch(true);
      }
    } catch {
      this.send({ type: 'ended', message: 'The window was closed.' });
      this.ws.close(1000, 'window closed');
    }
  }

  private toScreen(nx: unknown, ny: unknown) {
    return {
      x: Math.round(this.region.x + clamp01(nx) * (this.region.width - 1)),
      y: Math.round(this.region.y + clamp01(ny) * (this.region.height - 1)),
    };
  }

  private input(kind: string, args: Record<string, unknown> = {}) {
    if (this.deps.testSource) return;
    this.deps.input.call('input', { k: kind, ...args }, 5000).catch((err: Error) => {
      if (/blocked/i.test(err.message)) this.send({ type: 'status', message: err.message });
    });
  }

  /** Trackpad movement: coalesce deltas while a move is in flight, then report the cursor. */
  private async rel(dx: number, dy: number) {
    this.relAccum.x += dx;
    this.relAccum.y += dy;
    if (this.relPending || this.deps.testSource) return;
    this.relPending = true;
    try {
      while (this.relAccum.x !== 0 || this.relAccum.y !== 0) {
        const x = Math.round(this.relAccum.x);
        const y = Math.round(this.relAccum.y);
        this.relAccum = { x: 0, y: 0 };
        if (x === 0 && y === 0) break;
        const pos = await this.deps.input.call<number[] | null>('input', { k: 'rel', x, y }, 5000);
        if (pos) {
          this.send({ type: 'cursor', x: (pos[0] - this.region.x) / this.region.width, y: (pos[1] - this.region.y) / this.region.height });
        }
      }
    } catch {
      // ignore; the next movement will try again
    } finally {
      this.relPending = false;
    }
  }

  private onMessage(raw: string) {
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const button = m.b === 'right' || m.b === 'middle' ? m.b : 'left';
    const hasPoint = m.x !== undefined && m.y !== undefined;
    try {
      switch (m.t) {
        case 'move':
          this.input('move', this.toScreen(m.x, m.y));
          break;
        case 'down':
        case 'up':
        case 'click':
          this.input(m.t, { at: hasPoint, ...(hasPoint ? this.toScreen(m.x, m.y) : {}), b: button, n: Number(m.n) || 1 });
          break;
        case 'rel':
          void this.rel(Number(m.dx) || 0, Number(m.dy) || 0);
          break;
        case 'scroll': {
          const dx = Math.max(-2400, Math.min(2400, Math.round(Number(m.dx) || 0)));
          const dy = Math.max(-2400, Math.min(2400, Math.round(Number(m.dy) || 0)));
          if (dx || dy) this.input('scroll', { x: dx, y: dy });
          break;
        }
        case 'keys':
          this.input('keys', { keys: keyCodes(m.keys) });
          break;
        case 'text':
          if (typeof m.s === 'string' && m.s) this.input('text', { s: m.s.slice(0, 4000) });
          break;
        case 'quality':
          if (typeof m.q === 'string' && QUALITIES[m.q] && m.q !== this.qualityName) {
            this.qualityName = m.q;
            this.quality = QUALITIES[m.q];
            void this.relaunch(false);
          }
          break;
        case 'keyframe':
          if (Date.now() - this.lastKeyframeRequest > 3000) {
            this.lastKeyframeRequest = Date.now();
            void this.relaunch(false);
          }
          break;
        case 'output':
          if (this.mode === 'desktop' && Number(m.i) !== this.outputIndex) {
            this.outputIndex = Number(m.i);
            void this.relaunch(true);
          }
          break;
        default:
          break;
      }
    } catch (err) {
      this.send({ type: 'status', message: err instanceof Error ? err.message : String(err) });
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.watchTimer) clearInterval(this.watchTimer);
    await this.stopProc();
    if (this.savedPlacement && this.hwnd) {
      // Put the window back the way it was on the PC.
      await this.deps.helper.call('setplacement', { hwnd: this.hwnd, p: this.savedPlacement }).catch(() => undefined);
    }
    log.info(`stream: closed after ${this.frames} frames`);
  }
}
