import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { configDir } from './config.js';
import { run } from './pc/proc.js';

/**
 * HTTPS for the agent with a real certificate: Tailscale issues one for this PC's MagicDNS name
 * (`pc.tailnet.ts.net`) once "HTTPS Certificates" is on for the tailnet. iOS then accepts the
 * connection under any App Transport Security policy, including LiveContainer's, which refuses
 * plain HTTP to Tailscale addresses.
 */
export type TlsState = { state: 'ready'; domain: string; cert: Buffer; key: Buffer } | { state: 'off'; reason: string; enableUrl?: string };

export const TAILSCALE_DNS_SETTINGS = 'https://login.tailscale.com/admin/dns';

function tailscaleCli(): string {
  if (process.platform === 'win32') {
    const installed = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Tailscale', 'tailscale.exe');
    if (existsSync(installed)) return installed;
  }
  return 'tailscale';
}

interface TailscaleStatus {
  BackendState?: string;
  CertDomains?: string[] | null;
}

export async function tailscaleTls(dir = path.join(configDir(), 'tls')): Promise<TlsState> {
  const cli = tailscaleCli();
  const status = await run(cli, ['status', '--json'], 15_000).catch(() => undefined);
  if (!status?.stdout.trim()) return { state: 'off', reason: 'Tailscale is not installed' };
  let parsed: TailscaleStatus;
  try {
    parsed = JSON.parse(status.stdout) as TailscaleStatus;
  } catch {
    return { state: 'off', reason: 'Tailscale did not report its status' };
  }
  if (parsed.BackendState !== 'Running') return { state: 'off', reason: 'Tailscale is not signed in' };
  const domain = parsed.CertDomains?.[0];
  if (!domain) return { state: 'off', reason: 'HTTPS certificates are off for your tailnet', enableUrl: TAILSCALE_DNS_SETTINGS };

  mkdirSync(dir, { recursive: true });
  const certFile = path.join(dir, `${domain}.crt`);
  const keyFile = path.join(dir, `${domain}.key`);
  // Tailscale keeps the certificate and only goes back to Let's Encrypt when it is due for renewal.
  const res = await run(cli, ['cert', '--cert-file', certFile, '--key-file', keyFile, domain], 120_000).catch((err: Error) => ({
    code: -1,
    stdout: '',
    stderr: err.message,
  }));
  if (res.code !== 0 || !existsSync(certFile) || !existsSync(keyFile)) {
    return { state: 'off', reason: `Tailscale could not issue a certificate: ${(res.stderr || res.stdout).trim().split('\n')[0]}` };
  }
  return { state: 'ready', domain, cert: readFileSync(certFile), key: readFileSync(keyFile) };
}
