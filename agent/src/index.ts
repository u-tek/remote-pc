#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { buildAgent, VERSION } from './app.js';
import { ConfigStore, configDir, newToken } from './config.js';
import { addInstalledTools } from './install.js';
import { log, setLogFile } from './log.js';
import { planBind } from './net.js';
import { pairingUrl, showPairing } from './pairing.js';
import { FfmpegManager } from './pc/ffmpeg.js';
import { installStartup, uninstallStartup } from './startup.js';
import { ensureAgentRunning, openFile, writeWelcome } from './welcome.js';

const HELP = `Remote PC agent ${VERSION}

Usage: remote-pc-agent <command>

  start               Run the agent (default)
  pair [--new-token]  Show the pairing QR code (--new-token unpairs every phone)
  welcome [--start] [--no-open]
                      Open the page that connects your iPhone (Tailscale, app, pairing);
                      --start starts the agent in the background first if it isn't running
  install-startup     Start the agent hidden whenever you sign in to Windows
  uninstall-startup   Stop starting the agent at sign-in
  ffmpeg              Download FFmpeg for the live screen now instead of on first use
  config              Print where the config file lives
`;

addInstalledTools();

async function start() {
  const store = new ConfigStore();
  setLogFile(path.join(configDir(), 'agent.log'));
  const plan = planBind(store.data.bind);
  if (plan.warning) log.warn(plan.warning);

  const agent = buildAgent({ store, plan });
  const servers: http.Server[] = [];
  for (const host of plan.listen) {
    const server = http.createServer((req, res) => void agent.app.handler(req, res));
    server.on('upgrade', agent.app.upgrade);
    // Long agent turns and big file transfers: no request timeout.
    server.requestTimeout = 0;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(store.data.port, host, () => {
        server.off('error', reject);
        resolve();
      });
    }).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        log.error(`Port ${store.data.port} on ${host} is already in use. Is the agent already running? Change "port" in ${store.file}.`);
        process.exit(1);
      }
      throw err;
    });
    servers.push(server);
  }

  log.info(`Remote PC agent ${VERSION} listening on ${plan.listen.map((h) => `${h}:${store.data.port}`).join(', ')}`);
  log.info(`Config: ${store.file}`);
  // Lets SDK apps on this PC find the agent without configuration.
  writeFileSync(
    path.join(configDir(), 'sdk.json'),
    JSON.stringify({ url: `ws://127.0.0.1:${store.data.port}/api/sdk`, token: store.data.ui.sdkToken, protocol: 1 }, null, 2),
  );
  await agent.warmUp();
  if (process.stdout.isTTY) await showPairing(pairingUrl(store.data, plan.advertise), configDir());

  const shutdown = async () => {
    log.info('shutting down');
    for (const s of servers) s.close();
    await agent.shutdown();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

async function pair(newTok: boolean) {
  const store = new ConfigStore();
  if (newTok) {
    store.update((c) => (c.token = newToken()));
    console.log('Generated a new token. Previously paired phones must scan the new code; restart the agent if it is running.');
  }
  const plan = planBind(store.data.bind);
  if (plan.warning) console.warn(plan.warning);
  await showPairing(pairingUrl(store.data, plan.advertise), configDir());
}

process.on('unhandledRejection', (err) => log.error('unhandled rejection', err));
process.on('uncaughtException', (err) => log.error('uncaught exception', err));

const [cmd = 'start', ...rest] = process.argv.slice(2);
switch (cmd) {
  case 'start':
    await start();
    break;
  case 'pair':
    await pair(rest.includes('--new-token'));
    break;
  case 'install-startup':
    console.log(`Installed: ${installStartup()}\nThe agent will start hidden next time you sign in. Logs: ${path.join(configDir(), 'agent.log')}`);
    break;
  case 'uninstall-startup':
    console.log(uninstallStartup() ? 'Removed the startup entry.' : 'No startup entry was installed.');
    break;
  case 'welcome': {
    if (rest.includes('--start') && !(await ensureAgentRunning())) console.error(`The agent did not start. See ${path.join(configDir(), 'agent.log')}`);
    const file = await writeWelcome();
    console.log(file);
    if (!rest.includes('--no-open')) openFile(file);
    break;
  }
  case 'ffmpeg': {
    const store = new ConfigStore();
    const exe = await new FfmpegManager(configDir(), store.data.stream.ffmpeg).ensure((m) => console.log(m));
    console.log(`FFmpeg: ${exe}`);
    break;
  }
  case 'config':
    console.log(new ConfigStore().file);
    break;
  default:
    console.log(HELP);
}
