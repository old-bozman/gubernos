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

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = os.homedir();
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const PORT = Number(arg('--port')) || 4746;
const CODE = crypto.randomBytes(18).toString('base64url');
// a Mac that has never had these on PATH: the installers put them here
process.env.PATH = [path.dirname(process.execPath), path.join(HOME, '.local/bin'), path.join(HOME, '.gubernos/node/bin'), process.env.PATH].join(':');

const has = (cmd) => spawnSync('/bin/sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0;
const quiet = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 15000 }); return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}` }; };
const SIGNED_IN = {
  claude: () => { try { return JSON.parse(quiet('claude', ['auth', 'status', '--json']).out).loggedIn === true; } catch { return false; } },
  codex: () => quiet('codex', ['login', 'status']).ok,
};
const MODELS = [
  { id: 'claude', name: 'Claude', plan: 'a Claude Pro or Max plan', install: ['/bin/sh', ['-c', 'curl -fsSL https://claude.ai/install.sh | bash']], login: ['claude', ['auth', 'login']] },
  { id: 'codex', name: 'ChatGPT', plan: 'a ChatGPT Plus or Pro plan', install: ['npm', ['install', '-g', '@openai/codex']], login: ['codex', ['login']] },
];
const modelState = () => MODELS.map((m) => { const installed = has(m.id); return { id: m.id, name: m.name, plan: m.plan, installed, signedIn: installed && SIGNED_IN[m.id]() }; });

function folders() {
  const list = [{ id: 'local', path: '~/Gubernos', label: 'On this Mac', note: 'A plain folder. Your iPhone gets a copy from this Mac.' }];
  if (fs.existsSync(path.join(HOME, 'Library/Mobile Documents/com~apple~CloudDocs'))) list.push({ id: 'icloud', path: '~/Library/Mobile Documents/com~apple~CloudDocs/Gubernos', label: 'In iCloud Drive', note: 'Also opens on your other Apple devices.' });
  if (fs.existsSync(path.join(HOME, 'Library/Mobile Documents/iCloud~md~obsidian/Documents'))) list.push({ id: 'obsidian', path: '~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Gubernos', label: 'In Obsidian', note: 'A new vault in Obsidian’s iCloud folder.', args: ['--obsidian-vault', 'Gubernos'] });
  return list;
}

// one long job at a time; the page polls it
const job = { name: null, lines: [], done: false, error: null, next: null };
function start(name, cmd, args, then) {
  Object.assign(job, { name, lines: [], done: false, error: null });
  const child = spawn(cmd, args, { cwd: APP, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const take = (d) => { job.lines.push(...String(d).split('\n').filter((l) => l.trim())); job.lines = job.lines.slice(-30); };
  child.stdout.on('data', take); child.stderr.on('data', take);
  child.on('error', (e) => { job.done = true; job.error = e.message; });
  child.on('close', (code) => {
    if (code !== 0) { job.done = true; job.error = job.lines.at(-1) || `stopped (${code})`; return; }
    if (then) then(); else job.done = true;
  });
}

function setUpModel(id) {
  const m = MODELS.find((x) => x.id === id);
  if (!m) throw new Error('unknown model');
  const login = () => start(`${m.name}: sign in, in the browser`, ...m.login);
  if (has(m.id)) login(); else start(`Getting ${m.name}…`, ...m.install, login);
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
  if (req.method === 'GET' && url.pathname === '/state') return json(res, 200, { name: quiet('id', ['-F']).out.trim(), folders: folders(), models: modelState(), job });
  if (req.method === 'GET' && url.pathname === '/job') return json(res, 200, job);
  if (req.method !== 'POST') return json(res, 404, { error: 'not found' });
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
  if (process.env.GUBERNOS_FIRST_RUN_LINK_FILE) fs.writeFileSync(process.env.GUBERNOS_FIRST_RUN_LINK_FILE, link, { mode: 0o600 }); // scripts/check-clean-mac.mjs: how a test finds the page
  if (!process.argv.includes('--no-open')) spawn('open', [link], { stdio: 'ignore', detached: true }).unref();
});
