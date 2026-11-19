// Google Gemini on the owner's own key, the free option (2026-11-19 Alex: "давай gemini, давай предлагать её в качестве
// бесплатной модели"): the same loop as the Claude API (lib/claude-loop.js) through lib/gemini-loop.js and Google's
// Interactions API. A stand-in answers in the shapes of aistudio.google.com/api-reference/interactions-api (v1): an answer to
// a schema, a chat turn with tools (its thought step replayed with the signature), an agent run that writes in the vault.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { startServer } from './helpers.js';

const KEY = 'AIza-test-gemini-key-not-real'; // not key-shaped on purpose: a real-looking AIza… string trips GitHub's secret scanning
function fakeGemini() {
  const seen = [];
  const usage = (i = 1000, o = 100) => ({ total_input_tokens: i, total_cached_tokens: 0, total_output_tokens: o, total_thought_tokens: 0 });
  const out = (text) => ({ type: 'model_output', content: [{ type: 'text', text }] });
  const call = (id, name, args) => ({ type: 'function_call', id: `call_${id}`, name, arguments: args });
  const answer = (b) => {
    const fns = (b.tools || []).filter((t) => t.type === 'function').map((t) => t.name), web = (b.tools || []).some((t) => t.type === 'google_search');
    const results = b.input.filter((x) => x.type === 'function_result');
    if (!fns.length) return { status: 'completed', steps: [out(JSON.stringify({ steps: ['Call the bank', 'Pay the bill'] }))], usage: usage() };
    if (web) return results.length ? { status: 'completed', steps: [out('Done: the note is in 40_reference.')], usage: usage(2000, 500) }
      : { status: 'requires_action', steps: [call('w', 'write_file', { path: '40_reference/api-note.md', content: 'written over the Gemini API' })], usage: usage(2000, 500) };
    if (!results.length) return { status: 'requires_action', steps: [{ type: 'thought', signature: 'sig-opaque' }, call('a', 'read_file', { path: 'profile.md' }), call('b', 'read_file', { path: '../../../etc/hosts' })], usage: usage() };
    return { status: 'completed', steps: [out(JSON.stringify({ reply: 'I read your profile.', actions: [] }))], usage: usage() };
  };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; }).on('end', () => {
      const key = String(req.headers['x-goog-api-key'] || '');
      if (req.url === '/v1/models') return res.writeHead(key === KEY ? 200 : 400, { 'Content-Type': 'application/json' }).end(key === KEY ? '{"models":[]}' : '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}');
      const b = JSON.parse(body || '{}');
      seen.push({ path: req.url, key, body: b });
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(answer(b)));
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() })));
}

test('a Gemini key: answers, chat with tools, an agent run', { timeout: 90000 }, async () => {
  const api = await fakeGemini();
  const s = await startServer({ GUBERNOS_GEMINI_URL: api.url });
  try {
    assert.equal((await s.post('/api/ai/key', { key: 'AIza-wrong-test-key-not-real' })).status, 400, 'Google says 400 for a bad key');
    const k = await s.post('/api/ai/key', { key: KEY });
    assert.equal(k.status, 200, JSON.stringify(k.body));
    assert.equal(k.body.current, 'google', 'an AIza key is Google’s, and the app runs on it');
    assert.equal(fs.statSync(path.join(s.dir, 'config/gemini-key')).mode & 0o777, 0o600);

    // one answer to a schema: the quick model, the schema as response_format, nothing stored at Google
    const t = (await s.post('/api/tasks', { title: 'Pay the electricity bill' })).body;
    const br = await s.post(`/api/tasks/${t.id}/breakdown`, {});
    assert.equal(br.status, 200, JSON.stringify(br.body));
    assert.deepEqual(br.body.steps, ['Call the bank', 'Pay the bill']);
    const first = api.seen[0];
    assert.equal(first.path, '/v1/interactions'); assert.equal(first.key, KEY);
    assert.equal(first.body.model, 'gemini-3.5-flash-lite');
    assert.equal(first.body.response_format.mime_type, 'application/json'); assert.equal(first.body.store, false);
    assert.equal(typeof first.body.system_instruction, 'string');
    assert.ok(first.body.input.every((st) => ['user_input', 'model_output'].includes(st.type)));

    // a chat turn: function calls run on the vault only, the thought (with its signature) goes back with the results
    const c1 = await s.post('/api/chat', { message: 'Who am I?' });
    assert.equal(c1.status, 200, JSON.stringify(c1.body));
    assert.equal(c1.body.reply, 'I read your profile.');
    const round = api.seen.find((x) => x.body.input.some((i) => i.type === 'function_result')).body.input;
    assert.ok(round.some((i) => i.type === 'thought' && i.signature === 'sig-opaque'), 'the thought wasn’t replayed');
    const res = round.filter((i) => i.type === 'function_result');
    assert.equal(res.find((o) => o.call_id === 'call_a').name, 'read_file');
    assert.match(res.find((o) => o.call_id === 'call_a').result, /name/i);
    assert.match(res.find((o) => o.call_id === 'call_b').result, /outside/);

    // an agent run: writes in the vault with Google Search on offer, on the deep model
    const r = await s.post(`/api/tasks/${t.id}/run`, {});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    let task;
    for (let i = 0; i < 100; i++) { task = (await s.get(`/api/tasks/${t.id}`)).body; if (task.agent_state !== 'running') break; await new Promise((ok) => setTimeout(ok, 200)); }
    assert.equal(task.agent_state, 'review', JSON.stringify(task));
    assert.equal(fs.readFileSync(path.join(s.vault, '40_reference/api-note.md'), 'utf8'), 'written over the Gemini API');
    assert.equal(api.seen.find((x) => x.body.tools?.some((tl) => tl.type === 'google_search')).body.model, 'gemini-4-hydrogen');
    assert.ok(api.seen.every((x) => x.key === KEY));

    // removed: back to whatever else is ready
    const gone = await fetch(`${s.url}/api/ai/key?provider=google`, { method: 'DELETE' }).then((x) => x.json());
    assert.equal(gone.list.find((p) => p.id === 'google').installed, false);
  } finally { await s.stop(); api.close(); }
});
