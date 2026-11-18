// OpenAI on the owner's own key (2026-11-18 Alex: "добавим поддержку ключа для OpenAI"): the same loop as the Claude API
// (lib/claude-loop.js) through lib/openai-loop.js. A stand-in for the Responses API answers the way the docs describe it,
// and the app's three kinds of calls go through it — an answer to a schema, a chat turn with tools (its reasoning replayed),
// an agent run that writes in the vault — each priced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { startServer } from './helpers.js';

const KEY = 'sk-proj-test-key-for-openai-0123456789abcdef';
function fakeOpenAI() {
  const seen = [];
  const usage = (i = 1000, o = 100) => ({ input_tokens: i, input_tokens_details: { cached_tokens: 0 }, output_tokens: o });
  const msg = (text) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
  const call = (id, name, args) => ({ type: 'function_call', id: `fc_${id}`, call_id: `call_${id}`, name, arguments: JSON.stringify(args) });
  const answer = (b) => {
    const fns = (b.tools || []).filter((t) => t.type === 'function').map((t) => t.name), web = (b.tools || []).some((t) => t.type === 'web_search');
    const results = b.input.filter((x) => x.type === 'function_call_output');
    if (!fns.length) return { status: 'completed', output: [msg(JSON.stringify({ steps: ['Call the bank', 'Pay the bill'] }))], usage: usage() };
    if (web) return results.length ? { status: 'completed', output: [msg('Done: the note is in 40_reference.')], usage: usage(2000, 500) }
      : { status: 'completed', output: [call('w', 'write_file', { path: '40_reference/api-note.md', content: 'written over the OpenAI API' })], usage: usage(2000, 500) };
    if (!results.length) return { status: 'completed', output: [{ type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'opaque' }, call('a', 'read_file', { path: 'profile.md' }), call('b', 'read_file', { path: '../../../etc/hosts' })], usage: usage() };
    return { status: 'completed', output: [msg(JSON.stringify({ reply: 'I read your profile.', actions: [] }))], usage: usage() };
  };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; }).on('end', () => {
      const key = String(req.headers.authorization || '').replace(/^Bearer /, '');
      if (req.url === '/v1/models') return res.writeHead(key === KEY ? 200 : 401, { 'Content-Type': 'application/json' }).end('{"data":[]}');
      const b = JSON.parse(body || '{}');
      seen.push({ path: req.url, key, body: b });
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(answer(b)));
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() })));
}

test('an OpenAI key: answers, chat with tools, an agent run, each priced', { timeout: 90000 }, async () => {
  const api = await fakeOpenAI();
  const s = await startServer({ GUBERNOS_OPENAI_URL: api.url });
  try {
    assert.equal((await s.post('/api/ai/key', { key: 'sk-proj-wrong-key-0123456789abcdef' })).status, 400);
    const k = await s.post('/api/ai/key', { key: KEY });
    assert.equal(k.status, 200, JSON.stringify(k.body));
    assert.equal(k.body.current, 'openai', 'an sk- key that isn’t Anthropic’s is OpenAI’s, and the app runs on it');
    assert.equal(fs.statSync(path.join(s.dir, 'config/openai-key')).mode & 0o777, 0o600);

    // one answer to a schema: the quick model, its JSON schema as text.format
    const t = (await s.post('/api/tasks', { title: 'Pay the electricity bill' })).body;
    const br = await s.post(`/api/tasks/${t.id}/breakdown`, {});
    assert.equal(br.status, 200, JSON.stringify(br.body));
    assert.deepEqual(br.body.steps, ['Call the bank', 'Pay the bill']);
    const first = api.seen[0];
    assert.equal(first.path, '/v1/responses'); assert.equal(first.key, KEY);
    assert.equal(first.body.model, 'gpt-6-luna');
    assert.equal(first.body.text.format.type, 'json_schema'); assert.equal(first.body.store, false);

    // a chat turn: function calls run on the vault only, the reasoning item goes back with their outputs
    const c1 = await s.post('/api/chat', { message: 'Who am I?' });
    assert.equal(c1.status, 200, JSON.stringify(c1.body));
    assert.equal(c1.body.reply, 'I read your profile.');
    const round = api.seen.find((x) => x.body.input.some((i) => i.type === 'function_call_output')).body.input;
    assert.ok(round.some((i) => i.type === 'reasoning' && i.encrypted_content === 'opaque'), 'the reasoning wasn’t replayed');
    const outs = round.filter((i) => i.type === 'function_call_output');
    assert.match(outs.find((o) => o.call_id === 'call_a').output, /name/i);
    assert.match(outs.find((o) => o.call_id === 'call_b').output, /outside/);

    // an agent run: writes in the vault with web search on offer, on the deep model
    const r = await s.post(`/api/tasks/${t.id}/run`, {});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    let task;
    for (let i = 0; i < 100; i++) { task = (await s.get(`/api/tasks/${t.id}`)).body; if (task.agent_state !== 'running') break; await new Promise((ok) => setTimeout(ok, 200)); }
    assert.equal(task.agent_state, 'review', JSON.stringify(task));
    assert.equal(fs.readFileSync(path.join(s.vault, '40_reference/api-note.md'), 'utf8'), 'written over the OpenAI API');
    assert.equal(api.seen.find((x) => x.body.tools?.some((tl) => tl.type === 'web_search')).body.model, 'gpt-6.2-sol');
    assert.ok(api.seen.every((x) => x.key === KEY));

    // prices: luna $0.10 / $0.50 per million, sol $2 / $10
    const costs = fs.readFileSync(path.join(s.dir, 'data/costs.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const assist = costs.find((x) => x.job === 'assist'), agent = costs.find((x) => x.job === 'agent');
    assert.equal(assist.model, 'gpt-6-luna'); assert.ok(Math.abs(assist.cost - 0.00015) < 1e-9, JSON.stringify(assist));
    assert.ok(Math.abs(agent.cost - 0.018) < 1e-9, JSON.stringify(agent));

    // removed: back to whatever else is ready
    const gone = await fetch(`${s.url}/api/ai/key?provider=openai`, { method: 'DELETE' }).then((x) => x.json());
    assert.equal(gone.list.find((p) => p.id === 'openai').installed, false);
  } finally { await s.stop(); api.close(); }
});
