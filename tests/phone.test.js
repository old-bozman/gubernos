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
import { ROOT, kitVault, startServer } from './helpers.js';

test('phone: a tunnel address from the relay, kept; pairing required', { timeout: 60000 }, async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gubernos-phone-'));
  const home = path.join(d, 'home'), cfg = path.join(home, '.config/gubernos'), agents = path.join(d, 'agents');
  fs.mkdirSync(path.join(home, '.gubernos/bin'), { recursive: true }); fs.mkdirSync(cfg, { recursive: true });
  fs.writeFileSync(path.join(home, '.gubernos/bin/cloudflared'), '#!/bin/sh\necho "cloudflared version 2026.1.0"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(cfg, 'config.json'), JSON.stringify({ vault: kitVault(path.join(d, 'vault')), port: 4799 }));
  let asked = 0, body, deleted;
  const relay = http.createServer((req, res) => { let b = ''; req.on('data', (x) => { b += x; }).on('end', () => {
    if (req.method === 'DELETE') { deleted = req.url; return res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}'); }
    asked++; body = JSON.parse(b);
    // the relay waits for the person's check in the browser (relay/worker.js /check): 428 the first time
    if (asked === 1) return res.writeHead(428, { 'content-type': 'application/json' }).end('{"error":"waiting for the check"}');
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'tid', hostname: 'm-abc.gubernos.dev', token: 'TOKEN', key: 'K' }));
  }); }).listen(0, '127.0.0.1');
  await new Promise((r) => relay.once('listening', r));
  const run = () => promisify(execFile)('bash', [path.join(ROOT, 'scripts/setup.sh'), 'phone'], { env: { ...process.env, HOME: home,
    GUBERNOS_NO_LAUNCHD: '1', GUBERNOS_LAUNCH_AGENTS: agents, GUBERNOS_SYSTEMD_DIR: agents, GUBERNOS_TUNNEL_RELAY: `http://127.0.0.1:${relay.address().port}` } });
  try {
    // from the Terminal: the check's link is printed, the relay asked again until the check is passed
    const { stdout, stderr } = await run();
    assert.match(stdout, /phone URL: https:\/\/m-abc\.gubernos\.dev/);
    const link = stderr.match(/\/check\?c=([0-9a-f]{32})/);
    assert.ok(link, `no check link: ${stderr}`);
    assert.equal(body.code, link[1]);
    assert.equal(body.port, 4800); // the proxy port (port + 1), where only paired devices get in
    assert.equal(fs.readFileSync(path.join(cfg, 'tunnel.token'), 'utf8'), 'TOKEN');
    assert.equal(fs.statSync(path.join(cfg, 'tunnel.token')).mode & 0o777, 0o600);
    assert.equal(JSON.parse(fs.readFileSync(path.join(cfg, 'config.json'), 'utf8')).publicUrl, 'https://m-abc.gubernos.dev');
    assert.equal(JSON.parse(fs.readFileSync(path.join(cfg, 'pair.json'), 'utf8')).required, true);
    // the background service for cloudflared: a launchd plist on a Mac, a systemd user unit on Linux
    const svc = fs.readdirSync(agents).find((f) => /gubernos-tunnel\.(plist|service)$/.test(f));
    const esc = cfg.replace(/[.]/g, '\\.');
    assert.match(fs.readFileSync(path.join(agents, svc), 'utf8'), process.platform === 'darwin' ? new RegExp(`--token-file</string><string>${esc}/tunnel\\.token`) : new RegExp(`--token-file ${esc}/tunnel\\.token`));
    await run(); // again: the same tunnel, the relay isn't asked again
    assert.equal(asked, 2);
    // leaving Cloudflare: the service file and the saved tunnel are gone, the relay is told to delete it
    await promisify(execFile)('bash', [path.join(ROOT, 'scripts/setup.sh'), 'stop-tunnel'], { env: { ...process.env, HOME: home, GUBERNOS_NO_LAUNCHD: '1', GUBERNOS_LAUNCH_AGENTS: agents, GUBERNOS_SYSTEMD_DIR: agents, GUBERNOS_TUNNEL_RELAY: `http://127.0.0.1:${relay.address().port}` } });
    assert.equal(deleted, '/tunnel/tid?key=K');
    assert.ok(!fs.existsSync(path.join(cfg, 'tunnel.json')) && !fs.existsSync(path.join(cfg, 'tunnel.token')));
    assert.ok(!fs.readdirSync(agents).some((f) => /gubernos-tunnel\.(plist|service)$/.test(f)));
  } finally { relay.close(); fs.rmSync(d, { recursive: true, force: true }); }
});

test('Connect your iPhone → Set up: runs on the Mac itself, refused from outside', { timeout: 60000 }, async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gubernos-phonebtn-'));
  const home = path.join(d, 'home'), cfg = path.join(home, '.config/gubernos');
  fs.mkdirSync(path.join(home, '.gubernos/bin'), { recursive: true }); fs.mkdirSync(cfg, { recursive: true });
  fs.writeFileSync(path.join(home, '.gubernos/bin/cloudflared'), '#!/bin/sh\necho "cloudflared version 2026.1.0"\n', { mode: 0o755 });
  let code;
  const relay = http.createServer((req, res) => { let b = ''; req.on('data', (x) => { b += x; }).on('end', () => { code = JSON.parse(b).code;
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'tid', hostname: 'm-btn.gubernos.dev', token: 'T', key: 'K' })); }); }).listen(0, '127.0.0.1');
  await new Promise((r) => relay.once('listening', r));
  const s = await startServer({ HOME: home, GUBERNOS_CONFIG_DIR: cfg, GUBERNOS_NO_LAUNCHD: '1', GUBERNOS_LAUNCH_AGENTS: path.join(d, 'agents'), GUBERNOS_TUNNEL_RELAY: `http://127.0.0.1:${relay.address().port}` });
  try {
    fs.writeFileSync(path.join(cfg, 'config.json'), JSON.stringify({ vault: s.vault, port: 4799 }));
    assert.equal((await fetch(`${s.proxyUrl}/api/phone/setup`, { method: 'POST' })).status, 403);
    const r = await s.post('/api/phone/setup', {});
    assert.equal(r.status, 200);
    const check = r.body.check.match(/\/check\?c=([0-9a-f]{32})$/); // the page opens it; the script waits for it with the same code
    assert.ok(check, r.body.check);
    for (let i = 0; i < 150 && !fs.existsSync(path.join(cfg, 'tunnel.json')); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(fs.existsSync(path.join(cfg, 'tunnel.json')), 'the script never ran');
    assert.equal(code, check[1]);
  } finally { relay.close(); await s.stop(); fs.rmSync(d, { recursive: true, force: true }); }
});
