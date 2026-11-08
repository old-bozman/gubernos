// Claude through the Anthropic API on the owner's own key, on the Mac: no Claude Code needed (Settings → Your Mac → Model →
// Claude API; scripts/setup.sh key on). The loop, tools and prices are lib/claude-loop.js (the iPhone app runs the same one
// without the Mac); here: the key, sending with the SDK, the vault's files from disk, and gubernos-tools.
//   ask()    one answer to a schema (triage, voice, plans, import)
//   turn()   a chat turn with tools, history kept in .runs/api-chats
//   agent    scripts/api-agent.mjs: a task run in its own process, printing Claude Code's stream-json lines
// The key lives in the Mac's Keychain (GUBERNOS_API_KEY instead, for tests and computers without one); it is never put in
// ANTHROPIC_API_KEY, which would switch Claude Code itself over to paying per use.
import Anthropic from '@anthropic-ai/sdk';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TOOLS as INTEGRATIONS } from '../tools/gubernos-tools.js';
import * as L from './claude-loop.js';

export const { MODELS, price, WEB } = L;
export const KEY_ITEM = process.env.GUBERNOS_KEY_ITEM || 'gubernos-anthropic-key';
let key; // undefined = not looked up yet
export function apiKey() {
  if (process.env.GUBERNOS_API_KEY) return process.env.GUBERNOS_API_KEY;
  if (key === undefined) {
    key = null;
    if (process.platform === 'darwin') {
      try { key = execFileSync('/usr/bin/security', ['find-generic-password', '-a', os.userInfo().username, '-s', KEY_ITEM, '-w'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { /* none */ }
    }
  }
  return key;
}
export const forgetKey = () => { key = undefined; client = null; };

let client;
export const send = (body, { timeoutMs } = {}) => {
  client ||= new Anthropic({ apiKey: apiKey(), baseURL: process.env.GUBERNOS_API_URL || undefined, maxRetries: 2, timeout: 300000 });
  return client.messages.create(body, timeoutMs ? { timeout: timeoutMs } : undefined);
};
// a human sentence for what went wrong (the caller shows it or logs it)
export function why(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'the Anthropic API key was not accepted (scripts/setup.sh key on to set it again)';
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
export const loop = (o) => L.loop({ send, ...o, ops: o.ops || diskOps(o.root) });

export const ask = (o) => L.ask({ send, ...o });
const CHATS = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '.runs', 'api-chats');
const chatFile = (id) => path.join(CHATS, `${String(id).replace(/[^\w-]/g, '')}.json`);
const store = {
  get: (id) => { try { return JSON.parse(fs.readFileSync(chatFile(id), 'utf8')); } catch { return null; } }, // gone: a new chat
  set: (id, chat) => { fs.mkdirSync(CHATS, { recursive: true }); fs.writeFileSync(chatFile(id), JSON.stringify(chat)); },
};
export const turn = ({ cwd, ...o }) => L.turn({ send, ops: diskOps(cwd), store, tools: OWNER, folder: path.basename(cwd), ...o });
