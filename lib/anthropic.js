// Claude through the Anthropic API on the owner's own key: no Claude Code on the computer (Settings → Your Mac → Model →
// Claude API; scripts/setup.sh key on). lib/llm.js calls it for the same three things it asks the CLIs for:
//   ask()    one answer to a schema (triage, voice, plans, import)
//   turn()   a chat turn with tools (read the vault, gubernos-tools; the interview also writes), history kept in .runs/api-chats
//   agent    scripts/api-agent.mjs: a task run in its own process, printing Claude Code's stream-json lines (lib/runner.js
//            reads it like the CLI)
// The key lives in the Mac's Keychain (GUBERNOS_API_KEY instead, for tests and computers without one); it is never put in
// ANTHROPIC_API_KEY, which would switch Claude Code itself over to paying per use.
import Anthropic from '@anthropic-ai/sdk';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TOOLS as INTEGRATIONS } from '../tools/gubernos-tools.js';

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
export const forgetKey = () => { key = undefined; };

export const MODELS = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5' };
// $ per million tokens: input, 5-minute cache write, cache read, output (platform.claude.com/docs/en/about-claude/pricing, 2026-11-08);
// Haiku 5.5 costs 5× for a prompt over 100K tokens. A web search is $0.01 on top.
const PRICE = { 'claude-sonnet-5-5': [2, 2.5, 0.1, 10], 'claude-haiku-5-5': [0.1, 0.125, 0.01, 0.5] };
export function price(model, u = {}) {
  const p = PRICE[model];
  if (!p) return null;
  const inTok = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  const x = model === 'claude-haiku-5-5' && inTok > 100000 ? 5 : 1;
  return (x * ((u.input_tokens || 0) * p[0] + (u.cache_creation_input_tokens || 0) * p[1] + (u.cache_read_input_tokens || 0) * p[2] + (u.output_tokens || 0) * p[3])) / 1e6
    + (u.server_tool_use?.web_search_requests || 0) * 0.01;
}

const client = () => new Anthropic({ apiKey: apiKey(), baseURL: process.env.GUBERNOS_API_URL || undefined, maxRetries: 2, timeout: 300000 });
// Haiku answers quick things with thinking off (as the CLI did); Sonnet thinks as little as it needs
const thinking = (model, effort) => (model === MODELS.haiku ? { thinking: { type: 'disabled' } } : { output_config: { effort } });
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

// ---------- tools ----------
// The vault's files, the way Claude Code's Read / Glob / Grep / Edit / Write work, confined to root (the model chooses paths)
const SKIP = new Set(['.git', '.obsidian', '.trash', 'node_modules', '.runs']);
function inside(root, p) {
  const real = fs.realpathSync(root);
  const abs = path.resolve(real, String(p || '.'));
  let probe = abs; // a file that doesn't exist yet: its nearest existing folder decides
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const r = fs.realpathSync(probe);
  if (r !== real && !r.startsWith(real + path.sep)) throw new Error(`${p} is outside the folder this works in`);
  if (path.relative(real, abs).split(path.sep).some((s) => SKIP.has(s))) throw new Error(`${p} is not for this`);
  return abs;
}
function walk(root, dir = root, out = []) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(d.name)) continue;
    const f = path.join(dir, d.name);
    if (d.isDirectory()) walk(root, f, out); else if (d.isFile()) out.push(path.relative(root, f));
    if (out.length > 20000) break;
  }
  return out;
}
const TEXT = /\.(md|txt|json|ya?ml|csv|tsv|html?|js|mjs|css|xml|ics)$/i;
const READ_ONLY = [
  { name: 'read_file', description: 'Read a text file (path relative to the current folder). Lines come numbered; offset/limit read part of a long file.',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'integer', description: 'first line, from 1' }, limit: { type: 'integer', description: 'how many lines (default 2000)' } }, required: ['path'] },
    run: (root, a) => {
      const f = inside(root, a.path);
      if (fs.statSync(f).isDirectory()) return fs.readdirSync(f).filter((n) => !SKIP.has(n)).join('\n');
      const lines = fs.readFileSync(f, 'utf8').split('\n'), from = Math.max(1, a.offset || 1);
      return lines.slice(from - 1, from - 1 + (a.limit || 2000)).map((l, i) => `${String(from + i).padStart(5)}\t${l.slice(0, 2000)}`).join('\n') || '(empty file)';
    } },
  { name: 'find_files', description: 'Find files by a glob pattern such as "10_tasks/*.md" or "**/*invoice*" (paths relative to the current folder, newest first).',
    input_schema: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] },
    run: (root, a) => {
      const all = fs.globSync(String(a.pattern), { cwd: fs.realpathSync(root), exclude: (n) => SKIP.has(path.basename(String(n))) });
      const files = all.filter((f) => { try { return fs.statSync(path.join(root, f)).isFile(); } catch { return false; } });
      files.sort((x, y) => fs.statSync(path.join(root, y)).mtimeMs - fs.statSync(path.join(root, x)).mtimeMs);
      return files.length ? `${files.slice(0, 200).join('\n')}${files.length > 200 ? `\n… ${files.length - 200} more` : ''}` : 'no files match';
    } },
  { name: 'search_files', description: 'Search text files for a regular expression (case-insensitive). Returns path:line: text. path narrows it to a folder, glob to a file pattern ("*.md").',
    input_schema: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' }, glob: { type: 'string' } }, required: ['pattern'] },
    run: (root, a) => {
      const re = new RegExp(String(a.pattern), 'i'), base = inside(root, a.path || '.');
      const only = a.glob ? new RegExp(`^${String(a.glob).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '.*').replace(/\?/g, '.')}$`) : null;
      const out = [];
      for (const rel of walk(base)) {
        if (!TEXT.test(rel) || (only && !only.test(rel) && !only.test(path.basename(rel)))) continue;
        const f = path.join(base, rel);
        if (fs.statSync(f).size > 1e6) continue;
        fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (out.length < 100 && re.test(l)) out.push(`${path.relative(root, f)}:${i + 1}: ${l.slice(0, 300)}`); });
        if (out.length >= 100) break;
      }
      return out.length ? out.join('\n') : 'no matches';
    } },
];
const WRITING = [
  { name: 'edit_file', description: 'Replace old_str with new_str in a file. old_str must occur exactly once: include enough of the surrounding text. Read the file first.',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, old_str: { type: 'string' }, new_str: { type: 'string' } }, required: ['path', 'old_str', 'new_str'] },
    run: (root, a) => {
      const f = inside(root, a.path), text = fs.readFileSync(f, 'utf8');
      const n = text.split(String(a.old_str)).length - 1;
      if (n !== 1) throw new Error(n ? `old_str occurs ${n} times: include more of the text around it` : 'old_str is not in the file (read it again)');
      fs.writeFileSync(f, text.replace(String(a.old_str), () => String(a.new_str)));
      return 'edited';
    } },
  { name: 'write_file', description: 'Create a file, or replace a whole file, with content (folders are created).',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    run: (root, a) => { const f = inside(root, a.path); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, String(a.content)); return 'written'; } },
];
const OWNER = INTEGRATIONS.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema, run: (_, a) => t.run(a).then((o) => JSON.stringify(o, null, 1)) }));
const WEB = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 10 }, { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 10 }];

export const toolset = ({ write = false, web = false } = {}) => [...READ_ONLY, ...(write ? WRITING : []), ...OWNER, ...(web ? WEB : [])];

// ---------- the loop ----------
// Sends, runs the tools the model asks for, sends their results back, until it answers. Every response is appended as is
// (thinking blocks included: the API checks they come back unchanged). → {text, messages, usage, cost, turns}
export async function loop({ model, system, messages, tools = [], root, schema, effort = 'low', maxTurns = 60, timeoutMs, onResponse }) {
  const api = client(), usage = {}; let cost = 0, turns = 0, r;
  const defs = tools.map(({ run, ...t }) => t);
  for (;;) {
    if (++turns > maxTurns) throw new Error(`stopped after ${maxTurns} rounds`);
    const th = thinking(model, effort);
    r = await api.messages.create({
      model, max_tokens: 16000, system, messages, cache_control: { type: 'ephemeral' }, ...th, ...(defs.length ? { tools: defs } : {}),
      ...(schema ? { output_config: { ...th.output_config, format: { type: 'json_schema', schema } } } : {}),
    }, timeoutMs ? { timeout: timeoutMs } : undefined);
    for (const [k, v] of Object.entries(r.usage || {})) if (typeof v === 'number') usage[k] = (usage[k] || 0) + v;
    usage.web_search_requests = (usage.web_search_requests || 0) + (r.usage?.server_tool_use?.web_search_requests || 0);
    cost += price(model, r.usage) || 0;
    messages.push({ role: 'assistant', content: r.content });
    onResponse?.(r);
    if (r.stop_reason === 'pause_turn') continue; // a server tool (web search) needs another round
    if (r.stop_reason === 'refusal') throw new Error('Claude declined this request');
    if (r.stop_reason !== 'tool_use') break;
    const calls = r.content.filter((b) => b.type === 'tool_use');
    const results = await Promise.all(calls.map(async (c) => {
      const t = tools.find((x) => x.name === c.name);
      try {
        if (!t?.run) throw new Error(`no tool ${c.name}`);
        return { type: 'tool_result', tool_use_id: c.id, content: String(await t.run(root, c.input || {})).slice(0, 100000) };
      } catch (e) { return { type: 'tool_result', tool_use_id: c.id, content: `Error: ${e.message}`, is_error: true }; }
    }));
    messages.push({ role: 'user', content: results });
  }
  if (r.stop_reason === 'max_tokens') throw new Error('the answer was cut off (too long)');
  const text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  return { text, messages, usage, cost, turns };
}

// ---------- ask / turn ----------
export async function ask({ system, prompt, schema, deep = false, timeoutMs }) {
  const model = deep ? MODELS.sonnet : MODELS.haiku;
  const r = await loop({ model, system, messages: [{ role: 'user', content: prompt }], schema, timeoutMs });
  return { output: JSON.parse(r.text), cost: r.cost, model };
}

// A chat's history stays here between turns, under a random id (the session the app passes back)
const CHATS = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '.runs', 'api-chats');
const chatFile = (id) => path.join(CHATS, `${String(id).replace(/[^\w-]/g, '')}.json`);
export async function turn({ system, prompt, schema, session = null, deep = false, cwd, write = false, timeoutMs }) {
  const model = deep ? MODELS.sonnet : MODELS.haiku;
  let saved = null;
  if (session) try { saved = JSON.parse(fs.readFileSync(chatFile(session), 'utf8')); } catch { /* gone: a new chat */ }
  const messages = saved?.messages || [];
  messages.push({ role: 'user', content: prompt });
  // Claude Code told the model the folder and the date; here the app does (once: a chat keeps its first system prompt)
  const sys = saved?.system || `${system}\n\nThe current folder is ${path.basename(cwd)}, the owner's vault: file tools take paths inside it. Now: ${new Date().toString()}.`;
  const r = await loop({ model, system: sys, messages, tools: toolset({ write }), root: cwd, schema, timeoutMs });
  const id = saved ? session : crypto.randomUUID();
  fs.mkdirSync(CHATS, { recursive: true });
  fs.writeFileSync(chatFile(id), JSON.stringify({ system: sys, messages: r.messages }));
  return { output: JSON.parse(r.text), session: id, cost: r.cost, model };
}
