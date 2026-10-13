import { appendFileSync, renameSync, statSync } from 'node:fs';

let logFile: string | undefined;
const MAX_LOG_BYTES = 5 * 1024 * 1024;

export function setLogFile(path: string): void {
  logFile = path;
}

function write(level: string, args: unknown[]): void {
  const line = `${new Date().toISOString()} ${level} ${args
    .map((a) => (a instanceof Error ? a.stack ?? a.message : typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ')}`;
  if (level === 'ERROR') console.error(line);
  else console.log(line);
  if (!logFile) return;
  try {
    try {
      if (statSync(logFile).size > MAX_LOG_BYTES) renameSync(logFile, `${logFile}.1`);
    } catch {
      // log file does not exist yet
    }
    appendFileSync(logFile, line + '\n');
  } catch {
    // never let logging take the agent down
  }
}

export const log = {
  info: (...args: unknown[]) => write('INFO', args),
  warn: (...args: unknown[]) => write('WARN', args),
  error: (...args: unknown[]) => write('ERROR', args),
};
