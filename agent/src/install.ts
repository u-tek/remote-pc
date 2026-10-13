import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The agent folder (the one with package.json). */
export const agentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Tools the Windows installer drops next to the agent (opencode.exe) live in `<app>\bin`.
 * Put them first on PATH so they are found even before Windows refreshes the environment.
 */
export function addInstalledTools(): void {
  const bin = path.resolve(agentDir, '..', 'bin');
  if (!existsSync(bin)) return;
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const parts = (process.env[key] ?? '').split(path.delimiter);
  if (!parts.some((p) => path.resolve(p || '.').toLowerCase() === bin.toLowerCase())) process.env[key] = [bin, ...parts].join(path.delimiter);
}

function sdkHasOwnBinary(): boolean {
  try {
    createRequire(import.meta.url).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`);
    return true;
  } catch {
    return false;
  }
}

function onPath(name: string): string | undefined {
  const res = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8', windowsHide: true });
  if (res.status !== 0) return undefined;
  const hits = res.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return process.platform === 'win32' ? hits.find((h) => h.toLowerCase().endsWith('.exe')) : hits[0];
}

let resolved: { value: string | undefined } | undefined;

/**
 * Which Claude Code binary the Agent SDK should run. The installer leaves out the SDK's own copy
 * (it is huge) and installs Claude Code natively instead, so look for that one.
 */
export function claudeExecutable(configured?: string): string | undefined {
  if (configured) return configured;
  if (resolved) return resolved.value;
  if (sdkHasOwnBinary()) {
    resolved = { value: undefined };
    return undefined;
  }
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
  const candidates = [path.join(home, '.local', 'bin', exe), path.join(local, 'Microsoft', 'WinGet', 'Links', exe)];
  const wingetPackages = path.join(local, 'Microsoft', 'WinGet', 'Packages');
  if (existsSync(wingetPackages)) {
    for (const dir of readdirSync(wingetPackages)) if (dir.startsWith('Anthropic.ClaudeCode')) candidates.push(path.join(wingetPackages, dir, exe));
  }
  const value = onPath('claude') ?? candidates.find((c) => existsSync(c));
  // Only remember a hit, so installing Claude Code while the agent runs is picked up.
  if (value) resolved = { value };
  return value;
}

/** True when Claude Code can run: either the SDK's own binary or an installed claude. */
export function claudeInstalled(configured?: string): boolean {
  return sdkHasOwnBinary() || !!claudeExecutable(configured);
}
