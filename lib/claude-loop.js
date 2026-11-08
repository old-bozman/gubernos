// Claude through the Anthropic API, the part that runs anywhere: on the Mac (lib/anthropic.js sends with the SDK) and in the
// iPhone app with no Mac (local/llm.js sends through the native shell, which holds the key). No Node imports: the phone bundle
// takes this file as is (scripts/build-local.mjs).
//   send(body) → a Messages API response (or throws {status, message})
//   ops        the folder the file tools work in: list() → every file's relative path, read(rel), write(rel, text),
//              isDir(rel), mtime(rel); it refuses paths outside its folder
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

// Haiku answers a one-shot question with thinking off (as the CLI did); otherwise the model thinks as little as it needs.
// AICODE-NOTE: Haiku with thinking off AND a schema never calls a tool (it answers "let me check" at once; tried 2026-11-08),
// so with tools it thinks, at low effort
const thinking = (model, effort, tools) => (model === MODELS.haiku && !tools ? { thinking: { type: 'disabled' } } : { output_config: { effort } });

// ---------- schemas ----------
// The API takes closed objects; optional properties stay optional (a nullable optional one is left out instead: the API allows
// 16 union-typed parameters); no numeric, length or count limits; an enum without a type beside it (it refuses enum ['mon', …, null]
// with type ['string', 'null']). Checked against the API: scripts/check-api-schemas.mjs.
const LIMITS = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems'];
export function apiSchema(s) {
  if (Array.isArray(s)) return s.map(apiSchema);
  if (!s || typeof s !== 'object') return s;
  const o = Object.fromEntries(Object.entries(s).filter(([k]) => !LIMITS.includes(k) && !(k === 'type' && s.enum)).map(([k, v]) => [k, k === 'properties' ? Object.fromEntries(Object.entries(v).map(([n, x]) => [n, apiSchema(x)])) : apiSchema(v)]));
  if (o.properties || [].concat(o.type).includes('object')) {
    o.additionalProperties = false;
    const req = new Set(o.required || []);
    for (const [k, v] of Object.entries(o.properties || {})) {
      if (req.has(k) || !v || typeof v !== 'object') continue;
      if (Array.isArray(v.type) && v.type.includes('null')) { const t = v.type.filter((x) => x !== 'null'); v.type = t.length === 1 ? t[0] : t; }
      if (Array.isArray(v.enum) && v.enum.includes(null)) v.enum = v.enum.filter((x) => x !== null);
    }
  }
  return o;
}
// the answer of a chat turn: JSON in the text (possibly fenced, possibly with a sentence around it)
export function jsonIn(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try { return JSON.parse(t); } catch { /* prose around it */ }
  const a = t.indexOf('{'), z = t.lastIndexOf('}');
  if (a < 0 || z <= a) throw new Error('no JSON answer');
  return JSON.parse(t.slice(a, z + 1));
}

// ---------- file tools ----------
// Claude Code's Read / Glob / Grep / Edit / Write, over ops
const TEXT = /\.(md|txt|json|ya?ml|csv|tsv|html?|js|mjs|css|xml|ics)$/i;
const rel = (p) => String(p || '.').replace(/^\.\/+/, '').replace(/\/+$/, '').replace(/^\.$/, '');
const globRe = (g) => new RegExp(`^${String(g).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '\u0001').replace(/\*\*/g, '\u0002').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')
  .replace(/\u0001/g, '(?:.*/)?').replace(/\u0002/g, '.*')}$`);
const READ_ONLY = [
  { name: 'read_file', description: 'Read a text file (path relative to the current folder). Lines come numbered; offset/limit read part of a long file. A folder lists what is in it.',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'integer', description: 'first line, from 1' }, limit: { type: 'integer', description: 'how many lines (default 2000)' } }, required: ['path'] },
    run: (a, ops) => {
      const p = rel(a.path);
      if (ops.isDir(p)) { const pre = p ? `${p}/` : ''; return [...new Set(ops.list().filter((f) => f.startsWith(pre)).map((f) => f.slice(pre.length).split('/')[0]))].sort().join('\n') || '(empty folder)'; }
      const lines = ops.read(p).split('\n'), from = Math.max(1, a.offset || 1);
      return lines.slice(from - 1, from - 1 + (a.limit || 2000)).map((l, i) => `${String(from + i).padStart(5)}\t${l.slice(0, 2000)}`).join('\n') || '(empty file)';
    } },
  { name: 'find_files', description: 'Find files by a glob pattern such as "10_tasks/*.md" or "**/*invoice*" (paths relative to the current folder, newest first).',
    input_schema: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] },
    run: (a, ops) => {
      const re = globRe(rel(a.pattern));
      const files = ops.list().filter((f) => re.test(f)).sort((x, y) => ops.mtime(y) - ops.mtime(x));
      return files.length ? `${files.slice(0, 200).join('\n')}${files.length > 200 ? `\n… ${files.length - 200} more` : ''}` : 'no files match';
    } },
  { name: 'search_files', description: 'Search text files for a regular expression (case-insensitive). Returns path:line: text. path narrows it to a folder, glob to a file pattern ("*.md").',
    input_schema: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' }, glob: { type: 'string' } }, required: ['pattern'] },
    run: (a, ops) => {
      const re = new RegExp(String(a.pattern), 'i'), base = rel(a.path), only = a.glob ? globRe(a.glob) : null, out = [];
      for (const f of ops.list()) {
        if ((base && !f.startsWith(`${base}/`)) || !TEXT.test(f) || (only && !only.test(f) && !only.test(f.split('/').pop()))) continue;
        const text = ops.read(f);
        if (text.length > 1e6) continue;
        text.split('\n').forEach((l, i) => { if (out.length < 100 && re.test(l)) out.push(`${f}:${i + 1}: ${l.slice(0, 300)}`); });
        if (out.length >= 100) break;
      }
      return out.length ? out.join('\n') : 'no matches';
    } },
];
const WRITING = [
  { name: 'edit_file', description: 'Replace old_str with new_str in a file. old_str must occur exactly once: include enough of the surrounding text. Read the file first.',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, old_str: { type: 'string' }, new_str: { type: 'string' } }, required: ['path', 'old_str', 'new_str'] },
    run: (a, ops) => {
      const p = rel(a.path), text = ops.read(p), n = text.split(String(a.old_str)).length - 1;
      if (n !== 1) throw new Error(n ? `old_str occurs ${n} times: include more of the text around it` : 'old_str is not in the file (read it again)');
      ops.write(p, text.replace(String(a.old_str), () => String(a.new_str)));
      return 'edited';
    } },
  { name: 'write_file', description: 'Create a file, or replace a whole file, with content (folders are created).',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    run: (a, ops) => { ops.write(rel(a.path), String(a.content)); return 'written'; } },
];
export const WEB = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 10 }, { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 10 }];
export const fileTools = ({ write = false } = {}) => [...READ_ONLY, ...(write ? WRITING : [])];

// ---------- the loop ----------
// Sends, runs the tools the model asks for, sends their results back, until it answers. Every response is appended as is
// (thinking blocks included: the API checks they come back unchanged). → {text, messages, usage, cost, turns}
export async function loop({ send, model, system, messages, tools = [], ops, schema, effort = 'low', maxTurns = 60, timeoutMs, onResponse }) {
  let cost = 0, turns = 0, r;
  const defs = tools.map(({ run, ...t }) => t);
  for (;;) {
    if (++turns > maxTurns) throw new Error(`stopped after ${maxTurns} rounds`);
    const th = thinking(model, effort, defs.length > 0);
    r = await send({
      model, max_tokens: 16000, system, messages, cache_control: { type: 'ephemeral' }, ...th, ...(defs.length ? { tools: defs } : {}),
      ...(schema ? { output_config: { ...th.output_config, format: { type: 'json_schema', schema } } } : {}),
    }, { timeoutMs });
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
        return { type: 'tool_result', tool_use_id: c.id, content: String(await t.run(c.input || {}, ops)).slice(0, 100000) };
      } catch (e) { return { type: 'tool_result', tool_use_id: c.id, content: `Error: ${e.message}`, is_error: true }; }
    }));
    messages.push({ role: 'user', content: results });
  }
  if (r.stop_reason === 'max_tokens') throw new Error('the answer was cut off (too long)');
  const text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  return { text, messages, cost, turns };
}

// ---------- the app's calls ----------
export async function ask({ send, system, prompt, schema, deep = false, timeoutMs }) {
  const model = deep ? MODELS.sonnet : MODELS.haiku;
  const r = await loop({ send, model, system, messages: [{ role: 'user', content: prompt }], schema, timeoutMs });
  return { output: JSON.parse(r.text), cost: r.cost, model };
}

// A chat turn. Its history is kept by store ({get(id), set(id, chat)}) under a random id: the session the app passes back.
// AICODE-NOTE: no output_config.format here: the API refuses the chat's schema as "too complex" (its ~20 optional action fields,
// 2026-11-08), so the schema goes into the system prompt and the reply is parsed (lib/chat.js retries once when it isn't JSON).
export async function turn({ send, ops, store, tools = [], system, prompt, schema, session = null, deep = false, folder = 'the vault', write = false, timeoutMs }) {
  const model = deep ? MODELS.sonnet : MODELS.haiku;
  const saved = session ? store.get(session) : null;
  const messages = saved?.messages || [];
  messages.push({ role: 'user', content: prompt });
  // Claude Code told the model the folder and the date; here the app does (once: a chat keeps its first system prompt)
  const sys = saved?.system || `${system}\n\nThe current folder is ${folder}, the owner's vault: file tools take paths inside it. Now: ${new Date().toString()}.
Your answer is final: it ends your turn, and nothing runs after it. So when the answer depends on files or the owner's mail, calendar or Drive, call the tools first and answer only once you have looked; never answer that you are about to look.
When you answer, write only a JSON object matching this JSON Schema, no other text:\n${JSON.stringify(schema)}`;
  const r = await loop({ send, model, system: sys, messages, tools: [...fileTools({ write }), ...tools], ops, timeoutMs });
  const id = saved ? session : (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);
  store.set(id, { system: sys, messages: r.messages });
  return { output: jsonIn(r.text), session: id, cost: r.cost, model };
}
