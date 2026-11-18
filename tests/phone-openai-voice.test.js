// The iPhone app with no Mac (2026-11-18): voice turns into tasks on the phone (lib/voice-parse.js in the offline bundle),
// and an OpenAI key works there like Claude's (local/llm.js → lib/openai-loop.js → the shell's openai call). Stand-ins for
// both APIs sit behind the mock bridge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './helpers.js';
import { openPage } from './chrome.js';

const VOICE = { intent: 'tasks', tasks: [{ title: 'Buy milk', priority: 'planned', assigned: 'me', due: null, deadline: null, project: null, notes: '' }], command: null };

test('without the Mac: voice → tasks on Claude’s key, then chat and voice on an OpenAI key', { timeout: 120000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gubernos-phone-openai-'));
  const vault = path.join(dir, 'vault'), out = path.join(dir, 'web');
  fs.cpSync(path.join(ROOT, 'kit/vault'), vault, { recursive: true });
  fs.mkdirSync(path.join(vault, '10_tasks'), { recursive: true });
  fs.writeFileSync(path.join(vault, '10_tasks/20261108-120000-call-the-dentist.md'), '---\ntype: task\nstatus: new\npriority: planned\nassigned: me\ndue: 2026-11-10\n---\n# Call the dentist\n');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-local.mjs'), out, '--mock', vault]);
  const seen = { claude: [], openai: [] };
  const ESTIMATE = { tasks: [{ n: 1, task: 'Call the dentist', minutes: 15, must_today: true, why: 'overdue' }] };
  const claude = (b) => ({ id: 'm', type: 'message', role: 'assistant', model: b.model, content: [{ type: 'text', text: JSON.stringify(b.output_config?.format?.schema?.properties?.intent ? VOICE : /onboarding|interview/i.test(JSON.stringify(b.system)) ? { reply: 'Nice to meet you. Who is in your life?', finished: false } : ESTIMATE) }], stop_reason: 'end_turn', usage: { input_tokens: 500, output_tokens: 50 } });
  const openai = (b) => {
    const usage = { input_tokens: 500, input_tokens_details: { cached_tokens: 0 }, output_tokens: 50 };
    const msg = (text) => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }], usage });
    if (b.text?.format?.schema?.properties?.intent) return msg(JSON.stringify(VOICE));
    const results = b.input.filter((i) => i.type === 'function_call_output');
    if (!results.length) return { status: 'completed', output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'find_files', arguments: '{"pattern":"10_tasks/*.md"}' }], usage };
    return msg(JSON.stringify({ reply: `Found: ${results[0].output}`, actions: [] }));
  };
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && (req.url === '/claude' || req.url === '/openai')) {
      let body = '';
      return req.on('data', (d) => { body += d; }).on('end', () => {
        const b = JSON.parse(body), who = req.url.slice(1);
        seen[who].push(b);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(who === 'claude' ? claude(b) : openai(b)));
      });
    }
    const f = path.join(out, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!f.startsWith(out) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return res.writeHead(404).end('no');
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }).end(fs.readFileSync(f));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const page = await openPage();
  const started = async () => { for (let i = 0; i < 50; i++) { if (await page.eval('!!window.gubernosLocal')) return true; await new Promise((ok) => setTimeout(ok, 200)); } return false; };
  const post = (p, body) => page.eval(`fetch('${p}', { method: 'POST', body: ${JSON.stringify(JSON.stringify(body))} }).then(async (r) => ({ status: r.status, body: await r.json() }))`);
  const today = new Date().toLocaleDateString('sv');
  try {
    const url = `http://127.0.0.1:${server.address().port}/local.html#/today`;
    await page.goto(url);
    assert.ok(await started(), 'the offline page started');
    const v1 = await post('/api/voice/parse', { text: 'buy milk' });
    assert.equal(v1.status, 200, JSON.stringify(v1.body));
    assert.equal(v1.body.tasks[0].title, 'Buy milk'); assert.equal(v1.body.tasks[0].due, today, 'said without a date → today');
    assert.equal(seen.claude.at(-1).model, 'claude-haiku-5-5');

    // Plan the day on the phone: the workday and the tasks, no calendar, and it says so
    const free = await page.eval(`fetch('/api/plan/free').then(async (r) => ({ status: r.status, body: await r.json() }))`);
    assert.equal(free.status, 200, JSON.stringify(free.body));
    assert.match(free.body.calendarError, /calendar is read on your Mac/);
    assert.equal(typeof free.body.freeMinutes, 'number');
    const plan = await post('/api/plan/draft', {});
    assert.equal(plan.status, 200, JSON.stringify(plan.body));
    assert.match(JSON.stringify(plan.body), /20261108-120000-call-the-dentist/);
    assert.match(JSON.stringify(plan.body), /"minutes":15/);
    await page.eval(`location.hash = '#/plan'`);
    assert.ok(await page.waitFor('/Call the dentist/.test(document.querySelector("#main")?.innerText || "")', 15000), 'the Plan screen didn’t show the task');
    assert.deepEqual(page.errors, []);

    // the first interview on the phone, on its key: the same skill as on the Mac
    const ob0 = await page.eval(`fetch('/api/onboard').then((r) => r.json())`);
    assert.equal(ob0.model, 'api'); assert.equal(ob0.phone, true);
    const ob1 = await post('/api/onboard', { message: 'I am Alex, I live in Utrecht' });
    assert.equal(ob1.status, 200, JSON.stringify(ob1.body));
    assert.equal(ob1.body.turns.at(-1).text, 'Nice to meet you. Who is in your life?');
    assert.match(JSON.stringify(seen.claude.at(-1).system), /onboarding/i, 'the skill went to the model');
    assert.equal(seen.claude.at(-1).model, 'claude-sonnet-5-5');

    // no key on the phone: the interview asks for one in Settings → This iPhone
    await page.eval(`localStorage.setItem('gubernos-mock-vendor', 'none')`);
    await page.goto('about:blank'); await page.goto(url.replace('#/today', '#/onboard'));
    assert.ok(await started(), 'the offline page started without a key');
    assert.ok(await page.waitFor('!!document.querySelector("[data-act=ob-phone-key]")', 15000), 'no way to add a key from the interview');

    // the phone's key is OpenAI's now
    await page.eval(`localStorage.setItem('gubernos-mock-vendor', 'openai')`);
    await page.goto('about:blank'); await page.goto(url);
    assert.ok(await started(), 'the offline page started again');
    const v2 = await post('/api/voice/parse', { text: 'buy milk' });
    assert.equal(v2.status, 200, JSON.stringify(v2.body));
    assert.equal(v2.body.tasks[0].title, 'Buy milk');
    assert.equal(seen.openai[0].model, 'gpt-6-luna'); assert.equal(seen.openai[0].store, false);
    const chat = await post('/api/chat', { message: 'What is due?' });
    assert.equal(chat.status, 200, JSON.stringify(chat.body));
    assert.match(chat.body.reply, /20261108-120000-call-the-dentist\.md/);
    assert.equal(seen.claude.length, 3, 'nothing went to Anthropic on the OpenAI key (voice, the plan and the interview before)');
  } finally { await page.close(); server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
