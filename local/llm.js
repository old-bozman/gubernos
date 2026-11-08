// lib/llm.js in the iPhone app with no Mac (scripts/build-local.mjs maps /lib/llm.js here): Claude through the Anthropic API,
// the same loop as the Mac's Claude API model (lib/claude-loop.js). The native shell sends each request and adds the key,
// which it keeps in the iOS Keychain (gubernos-ios Gubernos/Claude.swift, Settings → This iPhone → Claude API key): the page
// never sees the key. lib/chat.js, assist.js and triage.js run unchanged on top of this.
//   bridge {op: 'claude', body: JSON text, timeoutMs} → the API's response as JSON text; fails with the API's error (or "no key")
import fs from 'node:fs';
import * as L from '/lib/claude-loop.js';
import { httpError } from '/lib/vault.js';

const native = window.webkit?.messageHandlers?.gubernos;
const call = (m) => (native ? native.postMessage(m) : window.gubernosMockBridge.call(m));
export const NO_KEY = 'no Claude API key on this iPhone';
const send = async (body, { timeoutMs } = {}) => {
  try { return JSON.parse(await call({ op: 'claude', body: JSON.stringify(body), timeoutMs: timeoutMs || 120000 })); } catch (e) {
    const m = String(e?.message || e);
    throw m.includes(NO_KEY) ? httpError(503, 'Offline on the phone — this needs the Mac, or a Claude API key (Settings → This iPhone)') : new Error(m);
  }
};

// the vault in the page's copy (local/shims/fs.js): writes go to the phone's iCloud copy like any other change
const clean = (p) => {
  const parts = String(p || '').split('/').filter((x) => x && x !== '.');
  if (parts.includes('..') || parts.some((x) => x.startsWith('.'))) throw new Error(`${p} is outside the folder this works in`);
  return parts.join('/');
};
const abs = (p) => `/vault/${clean(p)}`.replace(/\/$/, '');
const ops = {
  list: () => walk('/vault', ''),
  read: (p) => fs.readFileSync(abs(p)),
  write: (p, text) => fs.writeFileSync(abs(p), text),
  isDir: (p) => { const a = abs(p); try { return fs.statSync(a).isDirectory(); } catch { return false; } },
  mtime: (p) => { try { return fs.statSync(abs(p)).mtimeMs; } catch { return 0; } },
};
function walk(dir, rel, out = []) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.name.startsWith('.')) continue;
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) walk(`${dir}/${d.name}`, r, out); else out.push(r);
  }
  return out;
}

// what it cost, in the same file the Mac keeps (data/costs.jsonl; scripts/costs.mjs sums it)
function logCost(job, model, cost, ms) {
  try { fs.appendFileSync('/data/costs.jsonl', `${JSON.stringify({ at: new Date().toISOString(), job, model, cost, ms, on: 'iphone' })}\n`); } catch { /* never in the way */ }
}
const chats = new Map(); // a chat's history, for this session of the app
const store = { get: (id) => chats.get(id) || null, set: (id, c) => chats.set(id, c) };

export const current = () => 'api';
// who asked, off the call stack (/lib/triage.js → triage), as on the Mac
const caller = () => (new Error().stack.split('\n').slice(2).map((l) => l.match(/\/lib\/([\w-]+)\.js/)?.[1]).find((x) => x && x !== 'llm') || 'app');
export async function ask({ system, prompt, schema, timeoutMs, deep = false }) {
  const t0 = Date.now(), job = caller();
  try {
    const r = await L.ask({ send, system, prompt, schema: L.apiSchema(schema), deep, timeoutMs });
    logCost(job, r.model, r.cost, Date.now() - t0);
    return { output: r.output, cost: r.cost };
  } catch (e) { if (e.status) throw e; console.error('[llm]', e.message); throw httpError(502, `The agent couldn’t answer: ${e.message}`); }
}
export async function chatTurn({ system, prompt, schema, session = null, deep = false, write = false }) {
  const t0 = Date.now();
  const r = await L.turn({ send, ops, store, system, prompt, schema: L.apiSchema(schema), session, deep, write, timeoutMs: 120000 });
  logCost('chat', r.model, r.cost, Date.now() - t0);
  return { output: r.output, session: r.session, cost: r.cost };
}
