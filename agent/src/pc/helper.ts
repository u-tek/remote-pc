import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { HttpError } from '../http.js';
import { log } from '../log.js';

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');

export interface HelperCommand {
  command: string;
  args: string[];
}

export function defaultHelperCommand(): HelperCommand {
  return {
    command: 'powershell.exe',
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', path.join(ASSETS, 'helper.ps1')],
  };
}

/** The UI Automation helper (assets/ui.ps1): its own process so slow apps never block anything else. */
export function uiHelperCommand(): HelperCommand {
  return {
    command: 'powershell.exe',
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', path.join(ASSETS, 'ui.ps1')],
  };
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Talks to a long-lived PowerShell process (assets/helper.ps1) over a JSON-lines protocol.
 * Keeping it alive avoids paying PowerShell startup and C# compile time on every request.
 */
export class WindowsHelper {
  private proc?: ChildProcessWithoutNullStreams;
  private ready?: Promise<void>;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private failures = 0;

  constructor(private readonly cmd: HelperCommand = defaultHelperCommand()) {}

  get supported(): boolean {
    return process.platform === 'win32' || this.cmd.command !== 'powershell.exe';
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    if (!this.supported) return Promise.reject(new HttpError(501, 'This feature needs Windows.'));
    if (this.cmd.command === 'powershell.exe' && !existsSync(path.join(ASSETS, 'helper.ps1'))) {
      return Promise.reject(new HttpError(500, `helper.ps1 missing from ${ASSETS}`));
    }
    this.ready = new Promise<void>((resolve, reject) => {
      const proc = spawn(this.cmd.command, this.cmd.args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      this.proc = proc;
      let isReady = false;
      const startupTimer = setTimeout(() => {
        if (!isReady) {
          proc.kill();
          reject(new Error('Windows helper did not start within 60s'));
        }
      }, 60_000);
      const rl = createInterface({ input: proc.stdout });
      rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) return;
        let msg: { ready?: boolean; id?: number; ok?: boolean; result?: unknown; error?: string };
        try {
          msg = JSON.parse(trimmed);
        } catch {
          return;
        }
        if (msg.ready) {
          isReady = true;
          clearTimeout(startupTimer);
          this.failures = 0;
          resolve();
          return;
        }
        const p = msg.id !== undefined ? this.pending.get(msg.id) : undefined;
        if (!p) return;
        this.pending.delete(msg.id!);
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new HttpError(500, msg.error ?? 'helper error'));
      });
      let stderr = '';
      proc.stderr.on('data', (d: Buffer) => {
        stderr = (stderr + d.toString()).slice(-4000);
      });
      proc.on('error', (err) => {
        clearTimeout(startupTimer);
        reject(err);
      });
      proc.on('exit', (code) => {
        clearTimeout(startupTimer);
        if (!isReady) reject(new Error(`Windows helper exited (${code}): ${stderr.trim()}`));
        else log.warn(`windows helper exited (${code}) ${stderr.trim()}`);
        this.proc = undefined;
        this.ready = undefined;
        this.failures++;
        for (const [id, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject(new HttpError(500, 'Windows helper restarted, try again'));
          this.pending.delete(id);
        }
      });
    });
    this.ready.catch((err) => {
      log.error('windows helper failed to start', err);
      this.ready = undefined;
    });
    return this.ready;
  }

  async call<T>(op: string, args: Record<string, unknown> = {}, timeoutMs = 20_000): Promise<T> {
    if (this.failures > 5) throw new HttpError(500, 'Windows helper keeps crashing; check agent.log');
    await this.start();
    const proc = this.proc;
    if (!proc) throw new HttpError(500, 'Windows helper is not running');
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new HttpError(504, `Windows helper timed out on ${op}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      proc.stdin.write(JSON.stringify({ id, op, args }) + '\n');
    });
  }

  /** Start compiling the helper early so the first request is fast. */
  warmUp(): void {
    if (this.supported) this.start().catch(() => undefined);
  }

  stop(): void {
    this.proc?.kill();
  }
}
