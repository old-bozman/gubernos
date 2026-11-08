// The iPhone app with no Mac, on a Claude API key: the offline bundle (scripts/build-local.mjs) answers the chat and ✦ steps
// itself through the shell's Claude call (local/llm.js → lib/claude-loop.js), here a stand-in for the API behind the mock bridge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './helpers.js';
import { openPage } from './chrome.js';

test('without the Mac, with a key on the phone: chat reads the vault, ✦ steps answer', { timeout: 90000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gubernos-phone-claude-'));
  const vault = path.join(dir, 'vault'), out = path.join(dir, 'web');
  fs.cpSync(path.join(ROOT, 'kit/vault'), vault, { recursive: true });
  fs.mkdirSync(path.join(vault, '10_tasks'), { recursive: true });
  fs.writeFileSync(path.join(vault, '10_tasks/20261108-120000-call-the-dentist.md'), '---\ntype: task\nstatus: new\npriority: planned\nassigned: me\ndue: 2026-11-10\n---\n# Call the dentist\n\nCheck-up overdue.\n');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-local.mjs'), out, '--mock', vault]);
  const seen = [];
  const answer = (b) => {
    const last = b.messages.at(-1), names = (b.tools || []).map((t) => t.name);
    const msg = (content, stop_reason = 'end_turn') => ({ id: 'm', type: 'message', role: 'assistant', model: b.model, content, stop_reason, usage: { input_tokens: 500, output_tokens: 50 } });
    if (!names.length) return msg([{ type: 'text', text: JSON.stringify({ steps: ['Find the number', 'Call'] }) }]);
    if (typeof last.content === 'string') return msg([{ type: 'tool_use', id: 't1', name: 'find_files', input: { pattern: '10_tasks/*.md' } }, { type: 'tool_use', id: 't2', name: 'read_file', input: { path: '../secret' } }], 'tool_use');
    return msg([{ type: 'text', text: JSON.stringify({ reply: `Found: ${last.content[0].content}`, actions: [] }) }]);
  };
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/claude') {
      let body = '';
      return req.on('data', (d) => { body += d; }).on('end', () => { const b = JSON.parse(body); seen.push(b); res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(answer(b))); });
    }
    const f = path.join(out, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!f.startsWith(out) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return res.writeHead(404).end('no');
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }).end(fs.readFileSync(f));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const page = await openPage();
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/local.html#/today`);
    let ready = false;
    for (let i = 0; i < 50 && !ready; i++) { ready = await page.eval('!!window.gubernosLocal'); if (!ready) await new Promise((ok) => setTimeout(ok, 200)); }
    assert.ok(ready, 'the offline page started');
    const chat = await page.eval(`fetch('/api/chat', { method: 'POST', body: JSON.stringify({ message: 'What is due?' }) }).then(async (r) => ({ status: r.status, body: await r.json() }))`);
    assert.equal(chat.status, 200, JSON.stringify(chat.body));
    assert.match(chat.body.reply, /20261108-120000-call-the-dentist\.md/);
    const results = seen.find((b) => Array.isArray(b.messages.at(-1).content)).messages.at(-1).content;
    assert.ok(results[1].is_error && /outside/.test(results[1].content), 'nothing outside the vault');
    assert.equal(seen[0].model, 'claude-haiku-5-5');
    const steps = await page.eval(`fetch('/api/tasks/20261108-120000-call-the-dentist/breakdown', { method: 'POST', body: '{}' }).then((r) => r.json())`);
    assert.deepEqual(steps.steps, ['Find the number', 'Call']);
    const costs = await page.eval(`JSON.parse(localStorage.getItem('gubernos-data') || '{}')['costs.jsonl'] || ''`);
    assert.match(costs, /"job":"chat".*"on":"iphone"/);
    assert.match(costs, /"job":"assist"/);
  } finally { await page.close(); server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
