import { existsSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function startupFolder(): string {
  const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

const SCRIPT_NAME = 'Remote PC Agent.vbs';

/**
 * Start the agent hidden when you sign in to Windows. It must run in your own desktop
 * session (not as a service) so it can see your windows and clipboard.
 */
export function installStartup(): string {
  if (process.platform !== 'win32') throw new Error('Start-at-login is only supported on Windows.');
  const entry = fileURLToPath(new URL('./index.js', import.meta.url));
  const agentDir = path.resolve(path.dirname(entry), '..');
  const q = (s: string) => s.replace(/"/g, '""');
  const vbs = [
    'Set sh = CreateObject("WScript.Shell")',
    `sh.CurrentDirectory = "${q(agentDir)}"`,
    `sh.Run """${q(process.execPath)}"" ""${q(entry)}"" start", 0, False`,
    '',
  ].join('\r\n');
  const target = path.join(startupFolder(), SCRIPT_NAME);
  writeFileSync(target, vbs);
  return target;
}

export function uninstallStartup(): boolean {
  const target = path.join(startupFolder(), SCRIPT_NAME);
  if (!existsSync(target)) return false;
  rmSync(target);
  return true;
}
