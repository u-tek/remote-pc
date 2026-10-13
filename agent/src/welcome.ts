import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { ConfigStore, configDir } from './config.js';
import { claudeInstalled } from './install.js';
import { findTailscaleIPv4, planBind } from './net.js';
import { pairingUrl } from './pairing.js';
import { FfmpegManager } from './pc/ffmpeg.js';
import { run } from './pc/proc.js';

/** The newest iPhone build, committed to main by CI. */
const IPA_URL = process.env.REMOTE_PC_IPA_URL ?? 'https://raw.githubusercontent.com/u-tek/remote-pc/main/builds/RemotePC.ipa';
const TAILSCALE_APP = 'https://apps.apple.com/app/tailscale/id1470499037';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const qr = (text: string) => QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });

async function agentRunning(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Start the agent in the background (no window) unless it is already running. */
export async function ensureAgentRunning(): Promise<boolean> {
  const { port } = new ConfigStore().data;
  if (await agentRunning(port)) return true;
  spawn(process.execPath, [process.argv[1], 'start'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await agentRunning(port)) return true;
  }
  return false;
}

async function hasOpencode(): Promise<boolean> {
  const res = await run(process.platform === 'win32' ? 'where' : 'which', ['opencode'], 10_000).catch(() => undefined);
  return res?.code === 0;
}

/**
 * A page that walks through the phone side: Tailscale, installing the iPhone app, and pairing.
 * The installer opens it at the end; the Start menu's "Connect iPhone" opens it again.
 */
export async function writeWelcome(): Promise<string> {
  const store = new ConfigStore();
  const plan = planBind(store.data.bind);
  const tailscale = findTailscaleIPv4();
  const ffmpeg = new FfmpegManager(configDir(), store.data.stream.ffmpeg);
  const [running, opencode, ffmpegPath] = await Promise.all([agentRunning(store.data.port), hasOpencode(), ffmpeg.find()]);
  const claude = claudeInstalled(store.data.claude.executable);
  const [tsQr, sideQr, altQr, ipaQr, pairQr] = await Promise.all([
    qr(TAILSCALE_APP),
    qr(`sidestore://install?url=${encodeURIComponent(IPA_URL)}`),
    qr(`altstore://install?url=${encodeURIComponent(IPA_URL)}`),
    qr(IPA_URL),
    qr(pairingUrl(store.data, plan.advertise)),
  ]);

  const chip = (ok: boolean, yes: string, no: string) => `<span class="chip ${ok ? 'ok' : 'warn'}">${ok ? '✓' : '!'} ${esc(ok ? yes : no)}</span>`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect your iPhone</title>
<style>
  :root { --bg:#f5f5f7; --card:#fff; --text:#1d1d1f; --muted:#6e6e73; --line:#e3e3e8; --accent:#0a66ff; --ok:#1a7f37; --okbg:#e6f4ea; --warn:#9a5b00; --warnbg:#fff4e0; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#111113; --card:#1c1c1e; --text:#f5f5f7; --muted:#a1a1a6; --line:#2c2c2e; --accent:#4c8dff; --ok:#6fd38a; --okbg:#173322; --warn:#ffc266; --warnbg:#3a2a10; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:16px/1.5 "Segoe UI Variable", "Segoe UI", system-ui, sans-serif; }
  main { max-width: 980px; margin: 0 auto; padding: 40px 16px 64px; }
  h1 { font-size: 32px; margin: 0 0 6px; letter-spacing: -0.02em; }
  .lead { color: var(--muted); margin: 0 0 14px; }
  .chips { display:flex; flex-wrap:wrap; gap:8px; margin-bottom: 28px; }
  .chip { font-size:13px; padding:4px 10px; border-radius:999px; }
  .chip.ok { background:var(--okbg); color:var(--ok); }
  .chip.warn { background:var(--warnbg); color:var(--warn); }
  .step { display:grid; grid-template-columns: 1fr 220px; gap: 24px; align-items:center; background:var(--card); border:1px solid var(--line); border-radius:18px; padding:24px; margin-bottom:16px; }
  .num { display:inline-flex; width:28px; height:28px; border-radius:50%; background:var(--accent); color:#fff; font-weight:600; align-items:center; justify-content:center; margin-right:10px; font-size:15px; }
  h2 { font-size: 20px; margin: 0 0 8px; display:flex; align-items:center; }
  p { margin: 6px 0; }
  .muted { color: var(--muted); font-size: 14px; }
  .qr { background:#fff; border-radius:14px; padding:10px; width:220px; height:220px; }
  .qr svg { width:100%; height:100%; display:block; }
  .tabs { display:inline-flex; background:var(--bg); border:1px solid var(--line); border-radius:10px; padding:3px; margin:8px 0; }
  .tabs button { border:0; background:transparent; color:var(--text); font:inherit; font-size:14px; padding:5px 12px; border-radius:7px; cursor:pointer; }
  .tabs button[aria-pressed="true"] { background:var(--card); box-shadow:0 1px 2px rgba(0,0,0,.15); }
  details { margin-top:10px; font-size:14px; }
  summary { cursor:pointer; color:var(--accent); }
  ol.small { margin:8px 0 0; padding-left:20px; color:var(--muted); }
  a { color: var(--accent); }
  .warnline { color: var(--warn); font-size: 14px; }
  footer { color: var(--muted); font-size: 13px; margin-top: 24px; }
  code { font-family: Consolas, ui-monospace, monospace; font-size: 13px; }
  @media (max-width: 640px) { .step { grid-template-columns: 1fr; } .qr { margin: 0 auto; } h1 { font-size: 26px; } }
</style>
</head>
<body>
<main>
  <h1>Connect your iPhone</h1>
  <p class="lead">${esc(store.data.name)} is set up. Three steps on the phone and your PC's apps open on it as iPhone apps.</p>
  <div class="chips">
    ${chip(running, 'Agent running', 'Agent not running: start "Remote PC" from the Start menu')}
    ${chip(!!tailscale, `Tailscale connected (${tailscale ?? ''})`, 'Tailscale not signed in: only works on the same Wi-Fi')}
    ${chip(claude, 'Claude Code', 'Claude Code not installed')}
    ${chip(opencode, 'OpenCode', 'OpenCode not installed')}
    ${chip(!!ffmpegPath, 'Live screen ready', 'Live screen downloads FFmpeg on first use')}
  </div>

  <section class="step">
    <div>
      <h2><span class="num">1</span>Get Tailscale on your iPhone</h2>
      <p>Scan with the iPhone camera, install Tailscale and sign in with the same account you used on this PC. It's what lets your phone reach the PC from anywhere.</p>
      <p class="muted">Turn the Tailscale VPN on whenever you want to use Remote PC away from home.</p>
    </div>
    <div class="qr">${tsQr}</div>
  </section>

  <section class="step">
    <div>
      <h2><span class="num">2</span>Install the Remote PC app</h2>
      <div class="tabs" role="group">
        <button data-show="side" aria-pressed="true">SideStore</button><button data-show="alt" aria-pressed="false">AltStore</button><button data-show="ipa" aria-pressed="false">Just the file</button>
      </div>
      <p data-for="side">Scan with the iPhone camera and tap <b>Open in SideStore</b>; it installs Remote PC straight from the latest build.</p>
      <p data-for="alt" hidden>Scan with the iPhone camera and tap <b>Open in AltStore</b>.</p>
      <p data-for="ipa" hidden>Scan to download <code>RemotePC.ipa</code> in Safari, then open it in SideStore or AltStore (<b>+</b> → pick the file). <a href="${esc(IPA_URL)}">Download on this PC</a></p>
      <details>
        <summary>No SideStore on the iPhone yet?</summary>
        <ol class="small">
          <li>Plug the iPhone into this PC with a cable and tap <b>Trust</b> on the phone.</li>
          <li>Open <b>iloader</b> from the Start menu, sign in with your Apple ID and choose <b>Install SideStore</b>.</li>
          <li>On the iPhone: Settings → General → VPN &amp; Device Management → trust your Apple ID. Turn on Settings → Privacy &amp; Security → Developer Mode if asked.</li>
          <li>Open SideStore once, then scan the code above.</li>
        </ol>
        <p class="muted">Free Apple IDs sign apps for 7 days; SideStore refreshes them on the phone.</p>
      </details>
    </div>
    <div class="qr" data-for="side">${sideQr}</div>
    <div class="qr" data-for="alt" hidden>${altQr}</div>
    <div class="qr" data-for="ipa" hidden>${ipaQr}</div>
  </section>

  <section class="step">
    <div>
      <h2><span class="num">3</span>Pair with this PC</h2>
      <p>Open Remote PC and tap <b>Pair with my PC</b>, or just scan with the iPhone camera.</p>
      <p class="warnline">This code is the key to your PC. Don't share it or post a screenshot of it.</p>
      ${tailscale ? '' : '<p class="muted">Tailscale isn\'t signed in on this PC, so the code points at your home network. Sign in to Tailscale and reopen this page to use the phone from anywhere.</p>'}
    </div>
    <div class="qr">${pairQr}</div>
  </section>

  <footer>
    Open this page again from the Start menu: <b>Remote PC – Connect iPhone</b>.
    Settings: <code>${esc(store.file)}</code> · Log: <code>${esc(path.join(configDir(), 'agent.log'))}</code>
  </footer>
</main>
<script>
  for (const b of document.querySelectorAll('.tabs button')) {
    b.addEventListener('click', () => {
      for (const o of document.querySelectorAll('.tabs button')) o.setAttribute('aria-pressed', String(o === b));
      for (const el of document.querySelectorAll('[data-for]')) el.hidden = el.dataset.for !== b.dataset.show;
    });
  }
</script>
</body>
</html>
`;
  const file = path.join(configDir(), 'welcome.html');
  writeFileSync(file, html);
  return file;
}

export function openFile(file: string): void {
  if (!existsSync(file)) return;
  const [cmd, args] = process.platform === 'win32' ? ['explorer.exe', [file]] : process.platform === 'darwin' ? ['open', [file]] : ['xdg-open', [file]];
  spawn(cmd as string, args as string[], { detached: true, stdio: 'ignore' })
    .on('error', () => undefined)
    .unref();
}
