// Claude through the Anthropic API on the owner's key, with no Claude Code (lib/anthropic.js): a stand-in for the API answers
// the way the real one does, and the app's three kinds of calls go through it — an answer to a schema, a chat turn with tools,
// an agent run that writes in the vault — each priced in data/costs.jsonl.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { startServer } from './helpers.js';

function fakeApi() {
  const seen = [];
  const msg = (content, stop_reason = 'end_turn', usage = { input_tokens: 1000, output_tokens: 100 }) => ({ id: `msg_${seen.length}`, type: 'message', role: 'assistant', model: 'x', content, stop_reason, usage });
  const answer = (b) => {
    const names = (b.tools || []).map((t) => t.name), last = b.messages.at(-1);
    const results = Array.isArray(last.content) && last.content.filter((c) => c.type === 'tool_result');
    if (!names.length) return msg([{ type: 'text', text: JSON.stringify({ steps: ['Call the bank', 'Pay the bill'] }) }]); // breakdown
    if (names.includes('web_search')) { // an agent run
      if (!results) return msg([{ type: 'tool_use', id: 'tu_w', name: 'write_file', input: { path: '40_reference/api-note.md', content: 'written over the API' } }], 'tool_use', { input_tokens: 2000, output_tokens: 500 });
      return msg([{ type: 'text', text: 'Done: the note is in 40_reference.' }], 'end_turn', { input_tokens: 2000, output_tokens: 500 });
    }
    if (b.messages.length === 1) { // a new chat: look at a file, and try one outside the vault
      return msg([{ type: 'tool_use', id: 'tu_a', name: 'read_file', input: { path: 'profile.md' } }, { type: 'tool_use', id: 'tu_b', name: 'read_file', input: { path: '../../../etc/hosts' } }], 'tool_use');
    }
    return msg([{ type: 'text', text: JSON.stringify({ reply: results ? 'I read your profile.' : 'Still here.', actions: [] }) }]);
  };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; }).on('end', () => {
      const b = JSON.parse(body || '{}');
      seen.push({ path: req.url, key: req.headers['x-api-key'] || String(req.headers.authorization || '').replace(/^Bearer /, ''), body: b }); // the SDK sends it as a bearer token
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(answer(b)));
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() })));
}

test('the Claude API instead of Claude Code: answers, chat with tools, an agent run, each priced', { timeout: 60000 }, async () => {
  const api = await fakeApi();
  const s = await startServer({ GUBERNOS_API_KEY: 'sk-test', GUBERNOS_API_URL: api.url });
  try {
    await s.patch('/api/settings', { provider: 'api' });
    const ai = (await s.get('/api/ai')).body;
    assert.equal(ai.current, 'api');
    assert.ok(ai.list.find((p) => p.id === 'api').ready);

    // one answer to a schema: Haiku, thinking off, a schema the API takes
    const t = (await s.post('/api/tasks', { title: 'Pay the electricity bill' })).body;
    const br = await s.post(`/api/tasks/${t.id}/breakdown`, {});
    assert.equal(br.status, 200, JSON.stringify(br.body));
    assert.deepEqual(br.body.steps, ['Call the bank', 'Pay the bill']);
    const first = api.seen[0];
    assert.equal(first.path, '/v1/messages');
    assert.equal(first.key, 'sk-test');
    assert.equal(first.body.model, 'claude-haiku-5-5');
    assert.deepEqual(first.body.thinking, { type: 'disabled' });
    assert.equal(first.body.output_config.format.schema.additionalProperties, false);

    // a chat turn: its tools read the vault and nothing outside it; the next turn carries the history
    const c1 = await s.post('/api/chat', { message: 'Who am I?' });
    assert.equal(c1.status, 200, JSON.stringify(c1.body));
    assert.equal(c1.body.reply, 'I read your profile.');
    const back = api.seen.find((x) => x.body.messages.at(-1).content?.[0]?.type === 'tool_result').body.messages.at(-1).content;
    assert.ok(!back[0].is_error && /name/i.test(back[0].content), back[0].content);
    assert.ok(back[1].is_error && /outside/.test(back[1].content), back[1].content);
    const c2 = await s.post('/api/chat', { message: 'And now?', session: c1.body.session });
    assert.equal(c2.body.reply, 'Still here.');
    assert.equal(api.seen.at(-1).body.messages.length, 5, 'the first turn, its tool round and the new question');

    // an agent run: writes in the vault, with web search on offer, and hands the task back for review
    const r = await s.post(`/api/tasks/${t.id}/run`, {});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    let task;
    for (let i = 0; i < 100; i++) { task = (await s.get(`/api/tasks/${t.id}`)).body; if (task.agent_state !== 'running') break; await new Promise((ok) => setTimeout(ok, 200)); }
    assert.equal(task.agent_state, 'review', JSON.stringify(task));
    assert.equal(fs.readFileSync(path.join(s.vault, '40_reference/api-note.md'), 'utf8'), 'written over the API');
    const run = api.seen.find((x) => x.body.tools?.some((tl) => tl.name === 'web_search')).body;
    assert.equal(run.model, 'claude-sonnet-5-5');
    assert.ok(api.seen.every((x) => x.key === 'sk-test'));

    // prices: Haiku $0.10 / $0.50 per million in / out, Sonnet $2 / $10
    const costs = fs.readFileSync(path.join(s.dir, 'data/costs.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const of = (job) => costs.filter((x) => x.job === job);
    assert.equal(of('assist')[0].model, 'claude-haiku-5-5');
    assert.ok(Math.abs(of('assist')[0].cost - 0.00015) < 1e-9, JSON.stringify(of('assist')));
    assert.ok(Math.abs(of('agent')[0].cost - 0.018) < 1e-9, JSON.stringify(of('agent')));
  } finally { await s.stop(); api.close(); }
});

test('without a key the Claude API is not offered', { timeout: 30000 }, async () => {
  const s = await startServer();
  try { assert.deepEqual((await s.get('/api/ai')).body.list.map((p) => p.id), ['claude', 'codex']); } finally { await s.stop(); }
});
