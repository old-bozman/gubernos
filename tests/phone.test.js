// scripts/setup.sh phone (the default, Cloudflare Tunnel) on a fresh "Mac": a fake home, a stub relay and a stand-in
// cloudflared, nothing started (GUBERNOS_NO_LAUNCHD). Checks the address, the saved tunnel, the service file and pairing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { ROOT, kitVault } from './helpers.js';

test('phone: a tunnel address from the relay, kept; pairing required', { timeout: 60000 }, async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gubernos-phone-'));
  const home = path.join(d, 'home'), cfg = path.join(home, '.config/gubernos'), agents = path.join(d, 'agents');
  fs.mkdirSync(path.join(home, '.gubernos/bin'), { recursive: true }); fs.mkdirSync(cfg, { recursive: true });
  fs.writeFileSync(path.join(home, '.gubernos/bin/cloudflared'), '#!/bin/sh\necho "cloudflared version 2026.1.0"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(cfg, 'config.json'), JSON.stringify({ vault: kitVault(path.join(d, 'vault')), port: 4799 }));
  let asked = 0, body;
  const relay = http.createServer((req, res) => { let b = ''; req.on('data', (x) => { b += x; }).on('end', () => {
    asked++; body = JSON.parse(b);
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'tid', hostname: 'm-abc.gubernos.dev', token: 'TOKEN', key: 'K' }));
  }); }).listen(0, '127.0.0.1');
  await new Promise((r) => relay.once('listening', r));
  const run = () => promisify(execFile)('bash', [path.join(ROOT, 'scripts/setup.sh'), 'phone'], { env: { ...process.env, HOME: home,
    GUBERNOS_NO_LAUNCHD: '1', GUBERNOS_LAUNCH_AGENTS: agents, GUBERNOS_TUNNEL_RELAY: `http://127.0.0.1:${relay.address().port}` } });
  try {
    const { stdout } = await run();
    assert.match(stdout, /phone URL: https:\/\/m-abc\.gubernos\.dev/);
    assert.equal(body.port, 4800); // the proxy port (port + 1), where only paired devices get in
    assert.equal(fs.readFileSync(path.join(cfg, 'tunnel.token'), 'utf8'), 'TOKEN');
    assert.equal(fs.statSync(path.join(cfg, 'tunnel.token')).mode & 0o777, 0o600);
    assert.equal(JSON.parse(fs.readFileSync(path.join(cfg, 'config.json'), 'utf8')).publicUrl, 'https://m-abc.gubernos.dev');
    assert.equal(JSON.parse(fs.readFileSync(path.join(cfg, 'pair.json'), 'utf8')).required, true);
    const plist = fs.readdirSync(agents).find((f) => f.endsWith('gubernos-tunnel.plist'));
    assert.match(fs.readFileSync(path.join(agents, plist), 'utf8'), new RegExp(`--token-file</string><string>${cfg.replace(/[.]/g, '\\.')}/tunnel\\.token`));
    await run(); // again: the same tunnel, the relay isn't asked twice
    assert.equal(asked, 1);
  } finally { relay.close(); fs.rmSync(d, { recursive: true, force: true }); }
});
