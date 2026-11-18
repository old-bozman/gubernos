// Claude through the Anthropic API on the owner's own key, on the Mac: no Claude Code needed (Settings → Your Mac → Model →
// Claude API; scripts/setup.sh key on). The loop, tools and prices are lib/claude-loop.js (the iPhone app runs the same one
// without the Mac); here: the key, sending with the SDK, the vault's files from disk, and gubernos-tools.
//   ask()    one answer to a schema (triage, voice, plans, import)
//   turn()   a chat turn with tools, history kept in .runs/api-chats
//   agent    scripts/api-agent.mjs: a task run in its own process, printing Claude Code's stream-json lines
// The key lives in the Mac's Keychain (GUBERNOS_API_KEY instead, for tests and computers without one); it is never put in
// ANTHROPIC_API_KEY, which would switch Claude Code itself over to paying per use.
import Anthropic from '@anthropic-ai/sdk';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TOOLS as INTEGRATIONS } from '../tools/gubernos-tools.js';
import * as L from './claude-loop.js';
import * as O from './openai-loop.js';
import { CONFIG_DIR } from './config.js';

export const { MODELS, price, WEB } = L;
export const KEY_ITEM = process.env.GUBERNOS_KEY_ITEM || 'gubernos-anthropic-key';
// Two vendors on the owner's own key, both through the same loop (lib/claude-loop.js): 'api' = Claude (Anthropic), 'openai' =
// OpenAI through lib/openai-loop.js. The provider ids are lib/llm.js's.
const VENDORS = {
  api: { name: 'Anthropic', item: KEY_ITEM, file: 'anthropic-key', env: 'GUBERNOS_API_KEY', models: L.MODELS, console: 'console.anthropic.com',
    url: () => process.env.GUBERNOS_API_URL || 'https://api.anthropic.com', check: (k) => ({ path: '/v1/models', headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01' } }) },
  openai: { name: 'OpenAI', item: process.env.GUBERNOS_OPENAI_KEY_ITEM || 'gubernos-openai-key', file: 'openai-key', env: 'GUBERNOS_OPENAI_KEY', models: O.MODELS, console: 'platform.openai.com',
    url: () => process.env.GUBERNOS_OPENAI_URL || 'https://api.openai.com', check: (k) => ({ path: '/v1/models', headers: { authorization: `Bearer ${k}` } }) },
};
export const VENDOR_IDS = Object.keys(VENDORS);
// an Anthropic key starts with sk-ant-, an OpenAI one with sk- (sk-proj-, sk-svcacct-…)
export const vendorOf = (k) => (/^sk-ant-/.test(String(k || '').trim()) ? 'api' : 'openai');
// where a key is kept: the Mac's Keychain; elsewhere (Linux, and the tests) a file only this user can read
const STORE = process.env.GUBERNOS_KEY_STORE || (process.platform === 'darwin' ? 'keychain' : 'file');
const keyFile = (v) => path.join(CONFIG_DIR, VENDORS[v].file);
const keys = {}; // vendor → key, null = none, missing = not looked up yet
export function apiKey(v = 'api') {
  const V = VENDORS[v];
  if (!V) return null;
  if (process.env[V.env]) return process.env[V.env];
  if (!(v in keys)) {
    keys[v] = null;
    if (STORE === 'keychain') {
      try { keys[v] = execFileSync('/usr/bin/security', ['find-generic-password', '-a', os.userInfo().username, '-s', V.item, '-w'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { /* none */ }
    } else {
      try { keys[v] = fs.readFileSync(keyFile(v), 'utf8').trim() || null; } catch { /* none */ }
    }
  }
  return keys[v];
}
const fail = (message, status) => Object.assign(new Error(message), { status });
// Settings → Model → API key, typed on the computer itself (server.js): checked with the vendor first (listing the models
// costs nothing), then kept. To security it goes on stdin (security -i), never on a command line. → the vendor id
export async function saveKey(k, v = vendorOf(k)) {
  k = String(k || '').trim();
  const V = VENDORS[v];
  if (!V) throw fail('unknown provider', 400);
  if (!/^[A-Za-z0-9_-]{20,400}$/.test(k)) throw fail('That doesn’t look like an API key (Anthropic’s start with sk-ant-, OpenAI’s with sk-)', 400);
  const c = V.check(k);
  let r;
  try { r = await fetch(`${V.url()}${c.path}`, { headers: c.headers, signal: AbortSignal.timeout(15000) }); } catch (e) { throw fail(`Couldn’t reach ${V.name} to check the key: ${e.message}`, 502); }
  if (r.status === 401 || r.status === 403) throw fail(`${V.name} didn’t accept this key: nothing saved`, 400);
  if (!r.ok) throw fail(`${V.name} answered ${r.status} while checking the key: nothing saved`, 502);
  if (STORE === 'keychain') {
    const cmd = `add-generic-password -U -a "${os.userInfo().username}" -s "${V.item}" -l "Gubernos: ${V.name} API key" -T /usr/bin/security -w "${k}"\n`;
    const out = spawnSync('/usr/bin/security', ['-i'], { input: cmd, encoding: 'utf8', timeout: 10000 });
    if (out.status !== 0 || /error/i.test(out.stderr || '')) throw new Error(`The Keychain didn’t take the key: ${(out.stderr || '').trim() || out.status}`);
  } else {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(keyFile(v), `${k}\n`, { mode: 0o600 });
  }
  forgetKey();
  return v;
}
export function removeKey(v = 'api') {
  if (!VENDORS[v]) throw fail('unknown provider', 400);
  if (STORE === 'keychain') spawnSync('/usr/bin/security', ['delete-generic-password', '-a', os.userInfo().username, '-s', VENDORS[v].item], { stdio: 'ignore', timeout: 5000 });
  else fs.rmSync(keyFile(v), { force: true });
  forgetKey();
}
export const forgetKey = () => { for (const k of Object.keys(keys)) delete keys[k]; client = null; };
export const modelsOf = (v = 'api') => VENDORS[v].models;

let client;
const sendClaude = (body, { timeoutMs } = {}) => {
  client ||= new Anthropic({ apiKey: apiKey('api'), baseURL: process.env.GUBERNOS_API_URL || undefined, maxRetries: 2, timeout: 300000 });
  return client.messages.create(body, timeoutMs ? { timeout: timeoutMs } : undefined);
};
// OpenAI's Responses API over fetch (no SDK); busy (429 rate limits, 5xx) is tried twice more, after 2 s and 6 s
async function postOpenAI(body, { timeoutMs } = {}) {
  for (let attempt = 0; ; attempt++) {
    let r;
    try {
      r = await fetch(`${VENDORS.openai.url()}/v1/responses`, { method: 'POST', headers: { authorization: `Bearer ${apiKey('openai')}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs || 300000) });
    } catch (e) { throw Object.assign(new Error(e.message), { status: 0, vendor: 'openai' }); }
    const j = await r.json().catch(() => ({}));
    if (r.ok) return j;
    const quota = j.error?.code === 'insufficient_quota';
    if ((r.status === 429 && !quota || r.status >= 500) && attempt < 2) { await new Promise((ok) => setTimeout(ok, attempt ? 6000 : 2000)); continue; }
    throw Object.assign(new Error(j.error?.message || `HTTP ${r.status}`), { status: r.status, code: j.error?.code, vendor: 'openai' });
  }
}
const SENDERS = { api: sendClaude, openai: O.adapt(postOpenAI) };
export const sendOf = (v = 'api') => SENDERS[v];
export const send = sendClaude;
// a human sentence for what went wrong (the caller shows it or logs it)
export function why(e) {
  if (e?.vendor === 'openai') {
    if (e.status === 401) return 'the OpenAI API key was not accepted (Settings → Your Mac → Model to set it again)';
    if (e.code === 'insufficient_quota') return 'the OpenAI account is out of credit (platform.openai.com → Billing)';
    if (e.status === 429) return 'the OpenAI API is rate-limiting this key: try again in a minute';
    if (e.status === 403 || e.status === 404) return `the OpenAI API key may not use this model: ${e.message}`;
    if (e.status === 0) return 'no connection to the OpenAI API';
    return `the OpenAI API failed: ${e.message}`;
  }
  if (e instanceof Anthropic.AuthenticationError) return 'the Anthropic API key was not accepted (Settings → Your Mac → Model to set it again)';
  if (e instanceof Anthropic.PermissionDeniedError) return 'the Anthropic API key may not use this model';
  if (e instanceof Anthropic.RateLimitError) return 'the Anthropic API is rate-limiting this key: try again in a minute';
  if (e instanceof Anthropic.BadRequestError) return /credit|billing|balance/i.test(e.message) ? 'the Anthropic account is out of credit (console.anthropic.com → Billing)' : `the API refused the request: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return 'no connection to the Anthropic API';
  if (e instanceof Anthropic.APIError) return `the Anthropic API failed (${e.status ?? 'no status'})`;
  return e.message;
}

// the vault on disk, confined to root (the model chooses the paths): no way out through .. or a symlink
const SKIP = new Set(['.git', '.obsidian', '.trash', 'node_modules', '.runs']);
export function diskOps(root) {
  const real = fs.realpathSync(root);
  const at = (p) => {
    const abs = path.resolve(real, String(p || '.'));
    let probe = abs; // a file that doesn't exist yet: its nearest existing folder decides
    while (!fs.existsSync(probe)) probe = path.dirname(probe);
    const r = fs.realpathSync(probe);
    if (r !== real && !r.startsWith(real + path.sep)) throw new Error(`${p} is outside the folder this works in`);
    if (path.relative(real, abs).split(path.sep).some((s) => SKIP.has(s))) throw new Error(`${p} is not for this`);
    return abs;
  };
  const walk = (dir, out) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(d.name) || out.length > 20000) continue;
      const f = path.join(dir, d.name);
      if (d.isDirectory()) walk(f, out); else if (d.isFile()) out.push(path.relative(real, f));
    }
    return out;
  };
  return {
    list: () => walk(real, []),
    read: (p) => fs.readFileSync(at(p), 'utf8'),
    write: (p, text) => { const f = at(p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); },
    isDir: (p) => { try { return fs.statSync(at(p)).isDirectory(); } catch (e) { if (/outside|not for this/.test(e.message)) throw e; return false; } },
    mtime: (p) => { try { return fs.statSync(at(p)).mtimeMs; } catch { return 0; } },
  };
}
// gubernos-tools (Gmail, Calendar, Contacts, Drive), called directly
const OWNER = INTEGRATIONS.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema, run: (a) => t.run(a).then((o) => JSON.stringify(o, null, 1)) }));
export const toolset = ({ write = false, web = false } = {}) => [...L.fileTools({ write }), ...OWNER, ...(web ? WEB : [])];
export const loop = ({ vendor = 'api', ...o }) => L.loop({ send: sendOf(vendor), ...o, ops: o.ops || diskOps(o.root) });

export const ask = ({ vendor = 'api', ...o }) => L.ask({ send: sendOf(vendor), models: modelsOf(vendor), ...o });
const CHATS = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '.runs', 'api-chats');
const chatFile = (id) => path.join(CHATS, `${String(id).replace(/[^\w-]/g, '')}.json`);
const store = {
  get: (id) => { try { return JSON.parse(fs.readFileSync(chatFile(id), 'utf8')); } catch { return null; } }, // gone: a new chat
  set: (id, chat) => { fs.mkdirSync(CHATS, { recursive: true }); fs.writeFileSync(chatFile(id), JSON.stringify(chat)); },
};
export const turn = ({ cwd, vendor = 'api', ...o }) => L.turn({ send: sendOf(vendor), models: modelsOf(vendor), ops: diskOps(cwd), store, tools: OWNER, folder: path.basename(cwd), ...o });
