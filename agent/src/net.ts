import os from 'node:os';

/** Tailscale hands out addresses from the CGNAT range 100.64.0.0/10. */
export function isTailscaleIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

export function findTailscaleIPv4(): string | undefined {
  const ifaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal && isTailscaleIPv4(a.address)) return a.address;
    }
    // Some setups name the adapter but use a custom range; trust the name.
    if (/tailscale/i.test(name)) {
      const v4 = addrs?.find((a) => a.family === 'IPv4' && !a.internal);
      if (v4) return v4.address;
    }
  }
  return undefined;
}

export function findLanIPv4(): string | undefined {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal && !isTailscaleIPv4(a.address)) return a.address;
    }
  }
  return undefined;
}

export interface BindPlan {
  /** Addresses the HTTP server listens on. */
  listen: string[];
  /** Address the phone should use (put in the pairing QR code). */
  advertise: string;
  /** Address web-UI forwarders listen on. */
  forwardHost: string;
  warning?: string;
}

export function planBind(bind: string): BindPlan {
  const ts = findTailscaleIPv4();
  if (bind === 'localhost') {
    return { listen: ['127.0.0.1'], advertise: '127.0.0.1', forwardHost: '127.0.0.1' };
  }
  if (bind === 'all') {
    return { listen: ['0.0.0.0'], advertise: ts ?? findLanIPv4() ?? '127.0.0.1', forwardHost: '0.0.0.0' };
  }
  if (bind === 'tailscale' || bind === 'auto') {
    if (ts) return { listen: [ts, '127.0.0.1'], advertise: ts, forwardHost: ts };
    if (bind === 'tailscale') {
      return {
        listen: ['127.0.0.1'],
        advertise: '127.0.0.1',
        forwardHost: '127.0.0.1',
        warning: 'Tailscale address not found. Is Tailscale running? Listening on localhost only.',
      };
    }
    const lan = findLanIPv4() ?? '127.0.0.1';
    return {
      listen: ['0.0.0.0'],
      advertise: lan,
      forwardHost: '0.0.0.0',
      warning:
        'Tailscale address not found, so the agent is listening on your local network (token still required). Install Tailscale to reach your PC away from home.',
    };
  }
  // A literal IP address.
  return { listen: [bind, '127.0.0.1'], advertise: bind, forwardHost: bind };
}
