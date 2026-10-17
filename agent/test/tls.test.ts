import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { tailscaleTls } from '../src/tls.js';

/** A stand-in `tailscale` command on PATH whose status comes from $FAKE_TS_STATUS. */
describe('Tailscale HTTPS certificates', { skip: process.platform === 'win32' ? 'uses a shell script as the tailscale CLI' : undefined }, () => {
  let dir: string;
  const oldPath = process.env.PATH;

  before(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'rpc-ts-'));
    const cli = path.join(dir, 'tailscale');
    writeFileSync(
      cli,
      `#!/bin/sh
if [ "$1" = "status" ]; then printf '%s' "$FAKE_TS_STATUS"; exit 0; fi
if [ "$1" = "cert" ]; then printf 'CERT for %s' "$6" > "$3"; printf 'KEY' > "$5"; exit 0; fi
exit 1
`,
    );
    chmodSync(cli, 0o755);
    process.env.PATH = `${dir}${path.delimiter}${oldPath}`;
  });
  after(() => {
    process.env.PATH = oldPath;
  });

  it('is off, with the settings link, until HTTPS certificates are enabled', async () => {
    process.env.FAKE_TS_STATUS = JSON.stringify({ BackendState: 'Running', CertDomains: null });
    const tls = await tailscaleTls(path.join(dir, 'tls'));
    assert.equal(tls.state, 'off');
    assert.ok(tls.state === 'off' && tls.enableUrl?.includes('login.tailscale.com'));
  });

  it('is off while Tailscale is signed out', async () => {
    process.env.FAKE_TS_STATUS = JSON.stringify({ BackendState: 'NeedsLogin' });
    const tls = await tailscaleTls(path.join(dir, 'tls'));
    assert.ok(tls.state === 'off' && /signed in/.test(tls.reason));
  });

  it('fetches the certificate for the MagicDNS name', async () => {
    process.env.FAKE_TS_STATUS = JSON.stringify({ BackendState: 'Running', CertDomains: ['desk.tail1234.ts.net'] });
    const tls = await tailscaleTls(path.join(dir, 'tls'));
    assert.equal(tls.state, 'ready');
    assert.ok(tls.state === 'ready');
    assert.equal(tls.domain, 'desk.tail1234.ts.net');
    assert.equal(tls.cert.toString(), 'CERT for desk.tail1234.ts.net');
    assert.equal(tls.key.toString(), 'KEY');
  });
});
