#!/usr/bin/env node
// First run without a Terminal: a small page in the browser (Gubernos.app, or install.sh --wizard, opens it) that does what
// SETUP.md's agent does for the Mac part: name, language, folder, model, then scripts/setup.sh install, then on to the app
// (#/onboard: the interview in the app itself). The agent path (SETUP.md) stays for people who prefer it.
//   node scripts/first-run.mjs [--port 4746] [--no-open]
// It can run installers, so a web page must not be able to drive it: only 127.0.0.1 as the Host (DNS rebinding), and a
// random code in the URL the page got (another site can't read it). It exits once the app has taken over.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginCommand, loginPrompt, MODEL_SETUP, setupPath, signInFailed, getFailed } from '../lib/model-setup.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = os.homedir();
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const PORT = Number(arg('--port')) || 4746;
const CODE = crypto.randomBytes(18).toString('base64url');
process.env.PATH = setupPath(process.env.PATH);

const has = (cmd) => spawnSync('/bin/sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0;
const quiet = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 15000 }); return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}` }; };
// the user's full name to start the form with: the Mac's (id -F), else the account's on Linux (getent passwd, the part
// before the first comma); never an error message (Linux's id has no -F and says so on stderr)
const fullName = () => {
  const out = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 5000 }); return r.status === 0 ? (r.stdout || '').trim() : ''; };
  return out('id', ['-F']) || (out('getent', ['passwd', os.userInfo().username]).split(':')[4] || '').split(',')[0].trim();
};
const SIGNED_IN = {
  claude: () => { try { return JSON.parse(quiet('claude', ['auth', 'status', '--json']).out).loggedIn === true; } catch { return false; } },
  codex: () => quiet('codex', ['login', 'status']).ok,
};
const MODELS = Object.entries(MODEL_SETUP).map(([id, m]) => ({ id, ...m }));
const modelState = () => MODELS.map((m) => { const installed = has(m.id); return { id: m.id, name: m.name, plan: m.plan, installed, signedIn: installed && SIGNED_IN[m.id]() }; });

function folders() {
  const here = process.platform === 'darwin' ? 'this Mac' : 'this computer';
  const list = [{ id: 'local', path: '~/Gubernos', label: `On ${here}`, note: `A plain folder. Your phone gets a copy from ${here}.` }];
  if (fs.existsSync(path.join(HOME, 'Library/Mobile Documents/com~apple~CloudDocs'))) list.push({ id: 'icloud', path: '~/Library/Mobile Documents/com~apple~CloudDocs/Gubernos', label: 'In iCloud Drive', note: 'Also opens on your other Apple devices.' });
  if (fs.existsSync(path.join(HOME, 'Library/Mobile Documents/iCloud~md~obsidian/Documents'))) list.push({ id: 'obsidian', path: '~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Gubernos', label: 'In Obsidian', note: 'A new vault in Obsidian’s iCloud folder.', args: ['--obsidian-vault', 'Gubernos'] });
  return list;
}

// one long job at a time; the page polls it
const job = { name: null, lines: [], done: false, error: null, next: null, quiet: false };
let current = null; // the running process: a sign-in can be given up on (its browser page can get lost)
function start(name, cmd, args, then, { fail, quiet = false, login = false } = {}) { // fail: what to say instead of the tool's last line; quiet: its output isn't for people; login: a sign-in, its link shown (lib/model-setup.js loginPrompt)
  Object.assign(job, { name, lines: [], done: false, error: null, quiet, login: null });
  const child = spawn(cmd, args, { cwd: APP, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.on('error', () => {});
  if (!login) child.stdin.end(); // only a sign-in waits for input (a pasted code); anything else gets nothing, as before
  current = child;
  let out = '';
  const take = (d) => {
    job.lines.push(...String(d).split('\n').filter((l) => l.trim())); job.lines = job.lines.slice(-30);
    if (login) { out = (out + d).slice(-4000); job.login = loginPrompt(out) || job.login; }
  };
  child.stdout.on('data', take); child.stderr.on('data', take);
  child.on('error', (e) => { job.done = true; job.error = fail || e.message; });
  child.on('close', (code) => {
    if (code !== 0) { job.done = true; job.error = fail || job.lines.at(-1) || `stopped (${code})`; return; }
    if (then) then(); else job.done = true;
  });
}

function setUpModel(id) {
  const m = MODELS.find((x) => x.id === id);
  if (!m) throw new Error('unknown model');
  const login = () => start(`${m.name}: sign in, in the browser`, ...loginCommand(m.id), null, { fail: `${signInFailed(m)} Or skip it: you can sign in after this.`, quiet: true, login: true });
  if (has(m.id)) login(); else start(`Getting ${m.name}…`, ...m.install, login, { fail: getFailed(m) });
}

function install({ name, language, folder, model, awake }) {
  const f = folders().find((x) => x.id === folder);
  if (!f || !String(name || '').trim()) throw new Error('name and folder are needed');
  const args = [path.join(APP, 'scripts/setup.sh'), 'install', '--vault', f.path.replace(/^~/, HOME), '--name', String(name).trim().slice(0, 80),
    '--language', String(language || 'English').trim().slice(0, 40), ...(f.args || []), ...(model ? ['--model', model] : []), ...(awake ? ['--awake'] : []),
    ...(process.env.GUBERNOS_FIRST_RUN_ARGS || '').split(' ').filter(Boolean)];
  start('Setting up…', 'bash', args, () => {
    let port = 4747;
    try { port = JSON.parse(fs.readFileSync(path.join(process.env.GUBERNOS_CONFIG_DIR || path.join(HOME, '.config/gubernos'), 'config.json'), 'utf8')).port || 4747; } catch { /* the default */ }
    job.next = `http://127.0.0.1:${port}/#/onboard`;
    job.done = true;
    setTimeout(() => process.exit(0), 5000); // the page has moved on
  });
}

const PAGE = fs.readFileSync(path.join(APP, 'public/first-run.html'), 'utf8');
const json = (res, status, o) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(o));
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.headers.host !== `127.0.0.1:${PORT}`) return json(res, 403, { error: 'wrong address' });
  const code = url.searchParams.get('code') || req.headers['x-first-run'];
  if (code !== CODE) return json(res, 403, { error: 'open this page from Gubernos' });
  if (req.method === 'GET' && url.pathname === '/') return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(PAGE.replace('__CODE__', CODE));
  if (req.method === 'GET' && url.pathname === '/state') return json(res, 200, { name: fullName(), folders: folders(), models: modelState(), job, mac: process.platform === 'darwin' });
  if (req.method === 'GET' && url.pathname === '/job') return json(res, 200, job);
  if (req.method !== 'POST') return json(res, 404, { error: 'not found' });
  if (url.pathname === '/code') { // Claude's sign-in page shows a code to paste back: it goes to the CLI waiting for it
    let body = '';
    return req.on('data', (d) => { body += d; }).on('end', () => {
      const c = String(JSON.parse(body || '{}').code || '').trim();
      if (!job.login?.paste || job.done || !current) return json(res, 409, { error: 'no sign-in is waiting for a code' });
      if (!c || c.length > 2000 || /\s/.test(c)) return json(res, 400, { error: 'paste the code from the sign-in page' });
      current.stdin.write(`${c}\n`); job.login = { ...job.login, paste: false, sent: true };
      json(res, 200, { ok: true });
    });
  }
  if (url.pathname === '/cancel') { if (job.quiet && !job.done) current?.kill(); return json(res, 200, { ok: true }); } // sign-ins only, never the setup itself
  let body = '';
  req.on('data', (d) => { body += d; if (body.length > 10000) req.destroy(); }).on('end', () => {
    if (job.name && !job.done) return json(res, 409, { error: 'one thing at a time' });
    try {
      const b = JSON.parse(body || '{}');
      if (url.pathname === '/model') setUpModel(b.id);
      else if (url.pathname === '/install') install(b);
      else return json(res, 404, { error: 'not found' });
      json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
  });
});
server.listen(PORT, '127.0.0.1', () => {
  const link = `http://127.0.0.1:${PORT}/?code=${CODE}`;
  console.log(`first run: ${link}`);
  // for this user only, while it runs: how scripts/check-clean-mac.mjs finds the page
  const kept = path.join(HOME, '.gubernos/first-run-link');
  fs.mkdirSync(path.dirname(kept), { recursive: true });
  fs.writeFileSync(kept, link, { mode: 0o600 });
  process.once('exit', () => fs.rmSync(kept, { force: true }));
  // the browser: macOS `open`; Linux the desktop's (xdg-open); WSL the Windows one; a server with no screen prints the link
  const wsl = process.platform === 'linux' && /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8'));
  const opener = process.platform === 'darwin' ? ['open', [link]] : wsl ? ['cmd.exe', ['/c', 'start', '', link.replace(/&/g, '^&')]]
    : process.env.DISPLAY || process.env.WAYLAND_DISPLAY ? ['xdg-open', [link]] : null;
  if (!process.argv.includes('--no-open') && opener) spawn(...opener, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
});
