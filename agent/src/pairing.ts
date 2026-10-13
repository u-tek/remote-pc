import path from 'node:path';
import QRCode from 'qrcode';
import type { Config } from './config.js';

export function pairingUrl(config: Config, host: string): string {
  const params = new URLSearchParams({ host, port: String(config.port), token: config.token, name: config.name });
  return `remotepc://pair?${params.toString()}`;
}

/** Print a scannable QR code in the terminal and save a PNG copy next to the config. */
export async function showPairing(url: string, dir: string): Promise<string> {
  const pngPath = path.join(dir, 'pairing.png');
  const terminal = await QRCode.toString(url, { type: 'terminal', small: true, errorCorrectionLevel: 'M' });
  console.log('\nScan this with your iPhone camera (or in the app: Add PC → Scan QR):\n');
  console.log(terminal);
  await QRCode.toFile(pngPath, url, { width: 600, margin: 2 });
  console.log(`If the code above looks broken, open ${pngPath} and scan that instead.`);
  return pngPath;
}
