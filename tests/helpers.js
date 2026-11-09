// A throwaway server for tests: a fresh vault from the kit (never the owner's), its own data, config and pairing files,
// no notifier, no feedback relay. startServer() → {url, proxyUrl, dir, vault, get, post, patch, stop}.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

export function kitVault(dir, name = 'Tester') {
  execFileSync('node', [path.join(ROOT, 'scripts/kit.mjs'), 'vault', '--vault', dir, '--name', name], { stdio: 'ignore' });
  return dir;
}

export async function startServer(extraEnv = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gubernos-t-'));
  const vault = kitVault(path.join(dir, 'vault'));
  for (const d of ['data', 'config']) fs.mkdirSync(path.join(dir, d));
  const port = await freePort(), proxy = await freePort();
  const env = { ...process.env, GUBERNOS_VAULT: vault, GUBERNOS_DATA_DIR: path.join(dir, 'data'), GUBERNOS_CONFIG_DIR: path.join(dir, 'config'),
    GUBERNOS_PAIR_FILE: path.join(dir, 'data', 'pair.json'), GUBERNOS_BACKUP_DIR: path.join(dir, 'backups'), GUBERNOS_NO_NOTIFY: '1', GUBERNOS_MAC_FOCUS: '0',
    GUBERNOS_FEEDBACK_RELAY: '', GUBERNOS_FEEDBACK_INBOX: '', GUBERNOS_PUSH_RELAY: '', PORT: String(port), GUBERNOS_PROXY_PORT: String(proxy), HOST: '127.0.0.1', GUBERNOS_GOOGLE_SHARED_CLIENT: '', GUBERNOS_STT_PYTHON: '/nonexistent', // no Whisper models in a test
    // and never the owner's calendar (the Mac's helper would read it, and could write to it), real AI model or plan: no triage, and every model CLI points at nothing unless a test sets a stand-in
    GUBERNOS_MACCAL_BIN: '/nonexistent', GUBERNOS_BIN_DIR: path.join(dir, 'bin'), GUBERNOS_TRIAGE: '0', GUBERNOS_CLAUDE_BIN: '/nonexistent', GUBERNOS_CODEX_BIN: '/nonexistent',
    GUBERNOS_KEY_ITEM: 'gubernos-test-no-key', GUBERNOS_SETUP: '/nonexistent', GUBERNOS_API_URL: 'http://127.0.0.1:9', ...extraEnv }; // never the owner's Anthropic API key (lib/anthropic.js)
  if (!('GUBERNOS_API_KEY' in extraEnv)) delete env.GUBERNOS_API_KEY;
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
  process.once('exit', () => child.kill('SIGKILL')); // whatever goes wrong in a test, no server stays behind
  const url = `http://127.0.0.1:${port}`, proxyUrl = `http://127.0.0.1:${proxy}`;
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { up = (await fetch(`${url}/api/settings`, { signal: AbortSignal.timeout(2000) })).ok; } catch { /* starting */ }
    if (child.exitCode != null) throw new Error(`server exited:\n${log}`);
    if (!up) await new Promise((r) => setTimeout(r, 100));
  }
  if (!up) { child.kill('SIGKILL'); throw new Error(`the server didn't answer in time:\n${log}`); }
  const call = (method) => async (p, body) => {
    const r = await fetch(url + p, { method, signal: AbortSignal.timeout(10000), headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, body: json };
  };
  return { url, proxyUrl, dir, vault, log: () => log, get: call('GET'), post: call('POST'), patch: call('PATCH'),
    stop: async () => {
      if (child.exitCode == null) { child.kill(); await new Promise((r) => { child.once('exit', r); setTimeout(() => { child.kill('SIGKILL'); r(); }, 3000); }); }
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } };
}
