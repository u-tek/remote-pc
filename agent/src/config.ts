import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type PermissionModeSetting = 'default' | 'acceptEdits' | 'plan';

export interface WebBookmark {
  id: string;
  name: string;
  port: number;
  path?: string;
}

export interface Config {
  /** Name shown on the phone. */
  name: string;
  port: number;
  /** 'auto' = Tailscale address if present, otherwise all interfaces. */
  bind: 'auto' | 'tailscale' | 'all' | 'localhost' | string;
  token: string;
  claude: {
    enabled: boolean;
    /** Optional path to a claude.exe to use instead of the SDK's bundled build. */
    executable?: string;
    defaultPermissionMode: PermissionModeSetting;
    /** Live Claude processes are closed after this many idle minutes (they can be resumed). */
    idleCloseMinutes: number;
    model?: string;
  };
  opencode: {
    enabled: boolean;
    /** Port for the local `opencode serve` process the agent starts. */
    port: number;
    /** Ask before edits and shell commands so approvals reach the phone. */
    askPermissions: boolean;
    /** Use an already running OpenCode server instead of starting one. */
    url?: string;
  };
  /** Pinned project folders offered when starting a new agent session. */
  projects: string[];
  web: WebBookmark[];
}

export function configDir(): string {
  if (process.env.REMOTE_PC_HOME) return process.env.REMOTE_PC_HOME;
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'RemotePC');
  }
  return path.join(os.homedir(), '.config', 'remote-pc');
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function defaultConfig(): Config {
  return {
    name: os.hostname(),
    port: 8787,
    bind: 'auto',
    token: newToken(),
    claude: { enabled: true, defaultPermissionMode: 'default', idleCloseMinutes: 120 },
    opencode: { enabled: true, port: 4096, askPermissions: true },
    projects: [],
    web: [],
  };
}

export class ConfigStore {
  readonly file: string;
  data: Config;

  constructor(dir = configDir()) {
    mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'config.json');
    this.data = this.load();
  }

  private load(): Config {
    const defaults = defaultConfig();
    let raw: Partial<Config> = {};
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Config>;
    } catch {
      // first run: fall through to defaults
    }
    const merged: Config = {
      ...defaults,
      ...raw,
      claude: { ...defaults.claude, ...(raw.claude ?? {}) },
      opencode: { ...defaults.opencode, ...(raw.opencode ?? {}) },
      projects: raw.projects ?? defaults.projects,
      web: raw.web ?? defaults.web,
    };
    if (!merged.token || merged.token.length < 20) merged.token = newToken();
    this.data = merged;
    this.save();
    return merged;
  }

  save(): void {
    writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  update(mutator: (c: Config) => void): void {
    mutator(this.data);
    this.save();
  }
}
