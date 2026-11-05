// The model behind the app: the CLI of the provider chosen at setup (Settings → Agents → Model), on the owner's own
// subscription or account — Claude Code (claude), Codex (codex, a ChatGPT plan) or Gemini CLI (gemini, a Google account).
// Three kinds of calls, each as one CLI process:
//   ask()       one-shot structured answers: inbox triage, voice commands, estimates, suggestions (no tools)
//   chatTurn()  the Ask chat: read-only in the vault, gubernos-tools on, resumable session, structured reply
//   agentRun()  a task run: edits the vault, streams its progress as {kind: text | tool | result | error} events
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { httpError } from './vault.js';
import { get as settings } from './settings.js';
import { AGENT_TOOLS } from './config.js';
import { mcpServer, TOOL_NAMES } from '../tools/gubernos-tools.js';

const CWD = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '.runs');
fs.mkdirSync(CWD, { recursive: true });

export const PROVIDERS = {
  claude: { name: 'Claude', cli: 'Claude Code', bin: 'claude', plan: 'Claude Pro or Max', install: 'curl -fsSL https://claude.ai/install.sh | bash', login: '~/.local/bin/claude' },
  codex: { name: 'ChatGPT', cli: 'Codex', bin: 'codex', plan: 'ChatGPT Plus or Pro', install: 'npm install -g @openai/codex', login: 'codex login' },
  gemini: { name: 'Gemini', cli: 'Gemini CLI', bin: 'gemini', plan: 'a Gemini API key (Google AI Studio, free tier)', install: 'npm install -g @google/gemini-cli', login: 'GEMINI_API_KEY in ~/.gemini/.env' },
};
export const PROVIDER_IDS = Object.keys(PROVIDERS); // = lib/settings.js PROVIDER_IDS

// The CLI's path: GUBERNOS_<ID>_BIN, else PATH plus the usual install places (the launchd service has a short PATH).
const DIRS = [...(process.env.PATH || '').split(':'), path.join(os.homedir(), '.local/bin'), path.join(os.homedir(), '.claude/local'), path.join(os.homedir(), '.gubernos/node/bin'), '/opt/homebrew/bin', '/usr/local/bin'];
const binCache = {};
export function bin(id) {
  const env = process.env[`GUBERNOS_${id.toUpperCase()}_BIN`];
  if (env) return fs.existsSync(env) ? env : null;
  if (!(id in binCache)) binCache[id] = DIRS.filter(Boolean).map((d) => path.join(d, PROVIDERS[id].bin)).find((f) => fs.existsSync(f)) || null;
  return binCache[id];
}
export const installed = (id) => !!bin(id);
// signed in, as far as its files tell: Codex's login, Gemini's API key (its Login with Google no longer works)
const readable = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const SIGNED_IN = {
  claude: () => true,
  codex: () => fs.existsSync(path.join(os.homedir(), '.codex/auth.json')),
  gemini: () => !!process.env.GEMINI_API_KEY || /^GEMINI_API_KEY=\S/m.test(readable(path.join(os.homedir(), '.gemini/.env'))),
};
export const ready = (id) => installed(id) && SIGNED_IN[id]();
// the chosen provider; not chosen yet (or its CLI gone) → the first one ready here
export function current() {
  const p = settings().provider;
  if (PROVIDERS[p] && ready(p)) return p;
  return PROVIDER_IDS.find(ready) || (PROVIDERS[p] ? p : 'claude');
}
export const providers = () => ({ current: current(), chosen: settings().provider || null, list: PROVIDER_IDS.map((id) => ({ id, ...PROVIDERS[id], installed: installed(id), ready: ready(id) })) });

// ---------- structured output ----------
// Codex accepts only strict schemas (every object closed, every property required): optional properties become required
// but nullable, and those nulls are dropped again from the answer.
function strict(s) {
  if (!s || typeof s !== 'object') return s;
  const o = { ...s };
  if (o.enum && !o.type) { const t = [...new Set(o.enum.map((v) => (v === null ? 'null' : Number.isInteger(v) ? 'integer' : typeof v)))]; o.type = t.length === 1 ? t[0] : t; }
  if (o.items) o.items = strict(o.items);
  if (o.anyOf) o.anyOf = o.anyOf.map(strict);
  if (o.properties || [].concat(o.type).includes('object')) {
    const req = new Set(o.required || []), props = o.properties || {};
    o.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, req.has(k) ? strict(v) : nullable(strict(v))]));
    o.required = Object.keys(props);
    o.additionalProperties = false;
  }
  return o;
}
function nullable(s) {
  if (!s.type) return { anyOf: [s, { type: 'null' }] };
  const t = [].concat(s.type);
  return { ...s, type: t.includes('null') ? s.type : [...t, 'null'], ...(s.enum && !s.enum.includes(null) ? { enum: [...s.enum, null] } : {}) };
}
function unnull(v, s) {
  if (Array.isArray(v)) return v.map((x) => unnull(x, s?.items));
  if (v && typeof v === 'object' && s?.properties) {
    const req = new Set(s.required || []);
    for (const [k, x] of Object.entries(v)) { if (x === null && !req.has(k)) delete v[k]; else v[k] = unnull(x, s.properties[k]); }
  }
  return v;
}
export const _test = { strict, unnull };
const schemaFile = (schema) => {
  const f = path.join(CWD, `schema-${process.pid}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.json`);
  fs.writeFileSync(f, JSON.stringify(strict(schema)));
  return f;
};
// Gemini CLI has no schema option: the schema goes into the prompt and the JSON is cut out of the answer.
const SCHEMA_NOTE = (schema) => `\n\nAnswer with ONLY one JSON object that matches this JSON Schema — no prose, no code fences:\n${JSON.stringify(schema)}`;
function jsonIn(text) {
  const s = String(text || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try { return JSON.parse(s); } catch { /* prose around it */ }
  const a = s.indexOf('{'), z = s.lastIndexOf('}');
  return JSON.parse(a >= 0 && z > a ? s.slice(a, z + 1) : s);
}

// Gemini CLI reads MCP servers only from settings files: a system-settings file of our own adds gubernos-tools. Headless
// runs need the folder trusted (GEMINI_CLI_TRUST_WORKSPACE). Login with Google no longer works for the CLI ("no longer
// supported for Gemini Code Assist for individuals"): it takes a Gemini API key (~/.gemini/.env).
function geminiEnv() {
  const f = path.join(CWD, 'gemini-settings.json');
  fs.writeFileSync(f, JSON.stringify({ mcpServers: { 'gubernos-tools': mcpServer() }, context: { fileName: ['AGENTS.md', 'CLAUDE.md'] } }));
  return { ...process.env, GEMINI_CLI_SYSTEM_SETTINGS_PATH: f, GEMINI_CLI_TRUST_WORKSPACE: 'true' };
}
// what Gemini CLI said when it gave no JSON: its error line, with the fix for the usual one
function geminiError(text) {
  const s = String(text || '');
  if (/IneligibleTierError|no longer supported for Gemini Code Assist/.test(s)) return 'Gemini CLI needs a Gemini API key now (Login with Google stopped working): get one at aistudio.google.com/apikey and put GEMINI_API_KEY=… in ~/.gemini/.env';
  return lastError(s);
}
// Codex takes MCP servers as config overrides (values are TOML)
function codexMcp() {
  const m = mcpServer();
  return ['-c', `mcp_servers.gubernos-tools.command=${JSON.stringify(m.command)}`, '-c', `mcp_servers.gubernos-tools.args=${JSON.stringify(m.args)}`,
    '-c', `mcp_servers.gubernos-tools.env={${Object.entries(m.env).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(',')}}`];
}
const claudeMcp = () => ['--mcp-config', JSON.stringify({ mcpServers: { 'gubernos-tools': mcpServer() } }), '--strict-mcp-config'];

function run(cmd, args, { cwd = CWD, env = process.env, timeoutMs }) {
  return new Promise((resolve, reject) => {
    if (!cmd) return reject(new Error('the model CLI is not installed on this Mac'));
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(e.message)); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ out, err, code }); });
  });
}
// AICODE-NOTE: the prompt goes in argv, and the CLIs parse argv: text starting with "-" (a pasted list) is taken for an option
// ("error: unknown option '- Mortgage'"). No shell is involved, so quoting doesn't help: every prompt goes through this.
const asPrompt = (text) => (String(text).startsWith('-') ? ` ${text}` : String(text));
const lastError = (err) => err.split('\n').filter((l) => /error/i.test(l)).pop()?.slice(0, 300) || 'no answer';

// ---------- ask: one-shot structured ----------
async function askOnce(p, { system, prompt, schema, timeoutMs, deep }) {
  if (p === 'codex') {
    const sf = schemaFile(schema), of = `${sf}.out`;
    try {
      const { err } = await run(bin('codex'), ['exec', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '-c', `model_reasoning_effort="${deep ? 'medium' : 'low'}"`,
        '--output-schema', sf, '-o', of, `${system}\n\n${prompt}`], { timeoutMs });
      if (!fs.existsSync(of)) throw new Error(lastError(err));
      return { output: unnull(jsonIn(fs.readFileSync(of, 'utf8')), schema), cost: null };
    } finally { fs.rmSync(sf, { force: true }); fs.rmSync(of, { force: true }); }
  }
  if (p === 'gemini') {
    const { out, err } = await run(bin('gemini'), ['-p', asPrompt(`${system}\n\n${prompt}${SCHEMA_NOTE(schema)}`), '-o', 'json', '--approval-mode', write ? 'auto_edit' : 'plan', ...(deep ? [] : ['-m', 'flash'])], { timeoutMs, env: geminiEnv() });
    let d; try { d = JSON.parse(out || err); } catch { throw new Error(geminiError(err || out)); }
    if (d.error) throw new Error(d.error.message);
    return { output: jsonIn(d.response), cost: null };
  }
  // thinking off keeps these calls ~3–5 s; the prompts are simple extraction tasks
  const { out } = await run(bin('claude') || 'claude', ['-p', asPrompt(prompt), '--system-prompt', system, '--model', deep ? 'sonnet' : 'haiku', '--json-schema', JSON.stringify(schema),
    '--output-format', 'json', '--tools', '', '--no-session-persistence', '--setting-sources', '', '--strict-mcp-config'],
  { timeoutMs, env: { ...process.env, MAX_THINKING_TOKENS: '0' } });
  const d = JSON.parse(out);
  if (!d.structured_output) throw new Error(d.result || 'no structured output');
  return { output: d.structured_output, cost: d.total_cost_usd ?? null };
}

// AICODE-NOTE: the model sometimes refuses or answers in prose ("I need more information…") instead of the structured output.
// Every call gets one retry with a nudge; if that fails too, callers get a short, human error and the raw answer goes to the log.
const NUDGE = '\n\nAlways answer with the structured output. If some information is missing or cut off, give your best judgement from what is there — never ask for more and never refuse.';

export async function ask({ system, prompt, schema, timeoutMs = 45000, deep = false }) {
  const p = current(), t = p === 'claude' ? timeoutMs : timeoutMs + 30000; // Codex and Gemini start slower
  try { return await askOnce(p, { system, prompt, schema, timeoutMs: t, deep }); } catch (first) {
    try { return await askOnce(p, { system: system + NUDGE, prompt, schema, timeoutMs: t, deep }); } catch (second) {
      console.error(`[llm ${p}] failed twice:`, String(first.message).slice(0, 200), '|', String(second.message).slice(0, 200));
      throw httpError(502, 'The agent couldn’t answer this time — try again');
    }
  }
}

// ---------- chat: read-only, resumable ----------
// → {output, session, cost}; throws when there is no structured answer (the caller retries once with a nudge)
// write: the turn may change files in cwd (the first interview, lib/onboarding.js); never a shell or the web
export async function chatTurn({ system, prompt, schema, session = null, deep = false, cwd, write = false }) {
  const p = current(), timeoutMs = write ? 300000 : 120000;
  if (p === 'codex') {
    const sf = schemaFile(schema);
    try {
      const common = ['--json', '--skip-git-repo-check', '-c', `model_reasoning_effort="${deep ? 'medium' : 'low'}"`, ...codexMcp(), '--output-schema', sf];
      const args = session
        ? ['exec', 'resume', session, ...common, '-c', `sandbox_mode="${write ? 'workspace-write' : 'read-only'}"`, asPrompt(prompt)]
        : ['exec', ...common, '-s', write ? 'workspace-write' : 'read-only', '-C', cwd, `${system}\n\n${prompt}`];
      const { out, err } = await run(bin('codex'), args, { cwd, timeoutMs });
      let sid = session, text = null;
      for (const line of out.split('\n')) {
        try { const m = JSON.parse(line); if (m.type === 'thread.started') sid = m.thread_id; if (m.type === 'item.completed' && m.item?.type === 'agent_message') text = m.item.text; } catch { /* not JSON */ }
      }
      if (!text) throw new Error(lastError(err));
      return { output: unnull(jsonIn(text), schema), session: sid, cost: null };
    } finally { fs.rmSync(sf, { force: true }); }
  }
  if (p === 'gemini') {
    const args = ['-p', asPrompt(`${session ? '' : `${system}\n\n`}${prompt}${SCHEMA_NOTE(schema)}`), '-o', 'json', '--approval-mode', write ? 'auto_edit' : 'plan', ...(deep ? [] : ['-m', 'flash']), ...(session ? ['-r', session] : [])];
    const { out, err } = await run(bin('gemini'), args, { cwd, timeoutMs, env: geminiEnv() });
    let d; try { d = JSON.parse(out || err); } catch { throw new Error(geminiError(err || out)); }
    if (d.error) throw new Error(d.error.message);
    return { output: jsonIn(d.response), session: d.session_id || session, cost: null };
  }
  const args = ['-p', asPrompt(prompt), '--output-format', 'json', '--json-schema', JSON.stringify(schema),
    '--model', deep ? 'sonnet' : 'haiku', '--allowedTools', [...(write ? ['Read', 'Edit', 'Write', 'Glob', 'Grep'] : ['Read', 'Glob', 'Grep']), ...TOOL_NAMES].join(','),
    ...(write ? ['--permission-mode', 'acceptEdits', '--disallowedTools', 'Bash,WebFetch,WebSearch'] : ['--disallowedTools', 'Edit,Write,Bash,WebFetch,WebSearch']), ...claudeMcp(), '--setting-sources', ''];
  if (session) args.push('--resume', session); else args.push('--append-system-prompt', system);
  const { out, err } = await run(bin('claude') || 'claude', args, { cwd, timeoutMs, env: { ...process.env, MAX_THINKING_TOKENS: deep ? '4000' : '0' } });
  if (!out.trim()) throw new Error(lastError(err));
  const d = JSON.parse(out);
  if (!d.structured_output) throw new Error(d.result || 'no structured output');
  return { output: d.structured_output, session: d.session_id, cost: d.total_cost_usd ?? null };
}

// ---------- agent: a task run ----------
// AICODE-NOTE: headless runs cannot answer permission prompts. Claude: edit files + read-only research tools + gubernos-tools;
// add tools with config.json "agentTools" (or GUBERNOS_CLAUDE_TOOLS), e.g. ["Bash"]. GUBERNOS_CLAUDE_ARGS REPLACES all of it, gubernos-tools
// included: then it must carry its own --mcp-config. Codex: writes only in the vault (workspace-write
// sandbox). Gemini: all tools on, inside its macOS sandbox (writes only in the vault).
const short = (v, n = 140) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > n ? `${s.slice(0, n)}…` : s; };

// → {child, events(msg) → [{kind, …}]}: the caller splits stdout into JSON lines and feeds each one to events()
export function agentRun({ prompt, cwd, who = current() }) {
  const rel = (s) => (typeof s === 'string' ? s.replace(`${cwd}/`, '') : s);
  if (who === 'codex') {
    let last = '';
    const child = spawn(bin('codex'), ['exec', '--json', '--skip-git-repo-check', '-s', 'workspace-write', ...codexMcp(), '-C', cwd, prompt], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    // codex exec --json: thread/turn/item events → the same shapes as Claude's (text, tool, result)
    return { child, events: (msg) => {
      const it = msg.item || {};
      if (msg.type === 'item.completed' && it.type === 'agent_message' && it.text?.trim()) { last = it.text; return [{ kind: 'text', text: it.text }]; }
      if (msg.type === 'item.started' && it.type === 'command_execution') return [{ kind: 'tool', name: 'shell', text: short(rel(String(it.command || '').replace(/^\/bin\/zsh -lc /, ''))) }];
      if (msg.type === 'item.started' && it.type === 'mcp_tool_call') return [{ kind: 'tool', name: it.tool || 'tool', text: short(it.arguments || '') }];
      if (msg.type === 'item.completed' && it.type === 'file_change') return [{ kind: 'tool', name: 'edit', text: short((it.changes || []).map((c) => rel(c.path || '')).join(', ')) }];
      if (msg.type === 'turn.completed') return [{ kind: 'result', text: last, cost: null, turns: null, error: false }];
      if (msg.type === 'turn.failed' || msg.type === 'error') return [{ kind: 'error', text: short(msg.error?.message || msg.message || 'Codex failed') }];
      return [];
    } };
  }
  if (who === 'gemini') {
    let text = '', all = '';
    const flush = () => { const t = text.trim(); text = ''; return t ? [{ kind: 'text', text: t }] : []; };
    const child = spawn(bin('gemini'), ['-p', asPrompt(prompt), '-o', 'stream-json', '--yolo', '--sandbox'], { cwd, env: geminiEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    // gemini -o stream-json: init / message (assistant text in deltas) / tool_use / tool_result / error / result
    return { child, events: (msg) => {
      if (msg.type === 'message' && msg.role === 'assistant') { text += msg.content || ''; all += msg.content || ''; return []; }
      if (msg.type === 'tool_use') {
        const a = msg.parameters || {};
        return [...flush(), { kind: 'tool', name: msg.tool_name, text: short(rel(a.file_path || a.absolute_path || a.path || a.pattern || a.query || a.url || a.command || a)) }];
      }
      if (msg.type === 'error') return [...flush(), { kind: 'error', text: short(msg.message || msg.error?.message || 'Gemini failed') }];
      if (msg.type === 'result') return [...flush(), { kind: 'result', text: all.trim(), cost: null, turns: null, error: msg.status !== 'success' }];
      return [];
    } };
  }
  const extra = process.env.GUBERNOS_CLAUDE_ARGS
    ? process.env.GUBERNOS_CLAUDE_ARGS.split(' ').filter(Boolean)
    : ['--permission-mode', 'acceptEdits', '--allowedTools', ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite', ...AGENT_TOOLS, ...TOOL_NAMES].join(','), ...claudeMcp()];
  const child = spawn(bin('claude') || 'claude', ['-p', asPrompt(prompt), '--output-format', 'stream-json', '--verbose', ...extra], { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  return { child, events: (msg) => {
    if (msg.type === 'assistant') {
      return (msg.message?.content || []).flatMap((c) => {
        if (c.type === 'text' && c.text.trim()) return [{ kind: 'text', text: c.text }];
        if (c.type === 'tool_use') {
          const i = c.input || {};
          const arg = i.file_path || i.pattern || i.query || i.url || i.command || i.description || i;
          return [{ kind: 'tool', name: c.name, text: short(rel(arg)) }];
        }
        return [];
      });
    }
    if (msg.type === 'result') return [{ kind: 'result', text: msg.result || '', cost: msg.total_cost_usd ?? msg.cost_usd ?? null, turns: msg.num_turns, error: msg.is_error }];
    return [];
  } };
}
