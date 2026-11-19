// lib/llm.js in the iPhone app with no Mac (scripts/build-local.mjs maps /lib/llm.js here): Claude through the Anthropic API,
// or OpenAI through lib/openai-loop.js (2026-11-18; which one by the key on the phone), the same loop as the Mac's API models
// (lib/claude-loop.js). The native shell sends each request and adds the key,
// which it keeps in the iOS Keychain (gubernos-ios Gubernos/Claude.swift, Settings → This iPhone → Claude API key): the page
// never sees the key. lib/chat.js, assist.js and triage.js run unchanged on top of this.
//   bridge {op: 'claude' | 'openai' | 'gemini', body: JSON text, timeoutMs} → the API's response as JSON text; fails with the API's
//   error (or "no key"). {op: 'native'}.keyVendor says which key the phone has: 'anthropic', 'openai', 'gemini' or ''.
import fs from 'node:fs';
import * as L from '/lib/claude-loop.js';
import * as O from '/lib/openai-loop.js';
import * as G from '/lib/gemini-loop.js';
import { httpError } from '/lib/vault.js';

const native = window.webkit?.messageHandlers?.gubernos;
const call = (m) => (native ? native.postMessage(m) : window.gubernosMockBridge.call(m));
export const NO_KEY = 'no Claude API key on this iPhone';
// each step into /data/claude.log (the last 200 lines): what happened on the phone can be read on the Mac
// (xcrun devicectl device copy from … --domain-type appDataContainer --domain-identifier app.gubernos)
export function trace(...a) {
  try {
    const line = `${new Date().toISOString()} ${a.join(' ')}`;
    let old = ''; try { old = fs.readFileSync('/data/claude.log'); } catch { /* new */ }
    fs.writeFileSync('/data/claude.log', `${old.split('\n').filter(Boolean).slice(-199).join('\n')}\n${line}\n`);
  } catch { /* never in the way */ }
}
const NATIVE = (await Promise.resolve(call({ op: 'native' })).catch(() => ({}))) || {};
const VENDOR = NATIVE.keyVendor || 'anthropic';
window.gubernosKeyAtStart = `${!!NATIVE.claudeKey}/${NATIVE.keyVendor || ''}`; // app.js reloads when Settings changed it
export const hasKey = () => !!NATIVE.claudeKey; // a key on this iPhone (read once, at start: adding one in Settings reloads the page)
// no key, no Mac: what needs AI says so plainly, before anything is sent (2026-11-19 Alex: say up front what won't work)
export const NO_AI = 'This needs AI: add an API key in Settings → This iPhone, or connect your Mac';
const needKey = () => { if (!hasKey()) throw httpError(503, NO_AI); };
const via = (op) => async (body, { timeoutMs } = {}) => {
  const t0 = Date.now();
  trace('send', op, body.model, `msgs=${(body.messages || body.input || []).length}`);
  try { const r = JSON.parse(await call({ op, body: JSON.stringify(body), timeoutMs: timeoutMs || 120000 })); trace('got', r.stop_reason || r.status, `${Date.now() - t0}ms`); return r; } catch (e) {
    const m = String(e?.message || e);
    trace('failed', `${Date.now() - t0}ms`, m.slice(0, 200));
    throw m.includes(NO_KEY) ? httpError(503, 'Offline on the phone — this needs the Mac, or an API key (Settings → This iPhone)') : new Error(m);
  }
};
// the key's company: Anthropic (the loop's own shape), OpenAI or Google (Gemini, the free one) through their adapters
const send = VENDOR === 'openai' ? O.adapt(via('openai')) : VENDOR === 'gemini' ? G.adapt(via('gemini')) : via('claude');
const MODELS = VENDOR === 'openai' ? O.MODELS : VENDOR === 'gemini' ? G.MODELS : L.MODELS;

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

export const current = () => (VENDOR === 'openai' ? 'openai' : VENDOR === 'gemini' ? 'google' : 'api'); // the Mac's provider ids (lib/llm.js)
// who asked, off the call stack (/lib/triage.js → triage), as on the Mac
const caller = () => (new Error().stack.split('\n').slice(2).map((l) => l.match(/\/lib\/([\w-]+)\.js/)?.[1]).find((x) => x && x !== 'llm') || 'app');
export async function ask({ system, prompt, schema, timeoutMs, deep = false }) {
  needKey();
  const t0 = Date.now(), job = caller();
  try {
    const r = await L.ask({ send, models: MODELS, system, prompt, schema: L.apiSchema(schema), deep, timeoutMs });
    logCost(job, r.model, r.cost, Date.now() - t0);
    return { output: r.output, cost: r.cost };
  } catch (e) { if (e.status) throw e; console.error('[llm]', e.message); throw httpError(502, `The agent couldn’t answer: ${e.message}`); }
}
export async function chatTurn({ system, prompt, schema, session = null, deep = false, write = false }) {
  needKey();
  const t0 = Date.now();
  trace('chat turn', session ? 'follow-up' : 'new');
  const r = await L.turn({ send, models: MODELS, ops, store, system, prompt, schema: L.apiSchema(schema), session, deep, write, timeoutMs: 120000 });
  logCost('chat', r.model, r.cost, Date.now() - t0);
  return { output: r.output, session: r.session, cost: r.cost };
}
