// The morning brief (lib/brief.js): the agenda from the vault, the model's advice and offers as ▶ Do it buttons, seen once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from './helpers.js';

test('the morning brief: today’s tasks as links, the model’s offers as buttons, seen once, used buttons recorded', { timeout: 60000 }, async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gubernos-brief-'));
  const fake = path.join(d, 'claude');
  // a stand-in for Claude: signed in; to the brief it offers work on the first task in its list, and records what it was asked
  fs.writeFileSync(fake, `#!/usr/bin/env node
const fs = require('fs');
const a = process.argv.slice(2);
if (a[0] === 'auth') { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
const prompt = a[a.indexOf('-p') + 1];
fs.writeFileSync(${JSON.stringify(path.join(d, 'prompt.txt'))}, prompt);
const id = (prompt.match(/^- (\\d{8}-\\d{6}-[\\w-]+) ·/m) || [])[1] || null;
console.log(JSON.stringify({ structured_output: { advice: ['Protect the morning for the tax return.'], offers: [{ text: 'Collect last year’s statements into the task.', task_id: id }, { text: 'Made-up work', task_id: 'no-such-task' }], tasks: [{ title: 'Prepare questions for the 14:00 intro', why: 'nothing prepared yet' }] }, total_cost_usd: 0 }));
`, { mode: 0o755 });
  const s = await startServer({ GUBERNOS_CLAUDE_BIN: fake, GUBERNOS_BRIEF: '1' });
  try {
    const t = (await s.post('/api/tasks', { title: '[tax] File the tax return', priority: 'urgent', due: new Date().toLocaleDateString('sv') })).body;
    assert.equal((await s.get('/api/state')).body.me.brief, true);
    assert.deepEqual((await s.get('/api/brief/status')).body, { enabled: true, ready: false, seen: false });
    const b = (await s.post('/api/brief/open', {})).body;
    assert.match(b.text, /\*\*Today\*\*/);
    assert.match(b.text, /#1:\*\* not set yet/);
    assert.ok(b.text.includes(`[(tax) File the tax return](#/task/${t.id})`), b.text);
    assert.match(b.text, /\*\*How to run today\*\*\n- Protect the morning/);
    assert.deepEqual(b.actions.map((x) => [x.type, x.taskId ?? null]), [['run', t.id], ['run', null], ['create_task', null], ['plan_day', null]], 'an id the model made up is not used');
    const nt = b.actions.find((x) => x.type === 'create_task'); // a meeting that needs a task: + Task, due today
    assert.equal(nt.text, 'Prepare questions for the 14:00 intro'); assert.equal(nt.date, new Date().toLocaleDateString('sv'));
    assert.match(b.text, /\*\*From your calendar\*\*\n- Prepare questions for the 14:00 intro · nothing prepared yet/);
    assert.match(fs.readFileSync(path.join(d, 'prompt.txt'), 'utf8'), /The agenda:/);
    assert.equal((await s.get('/api/brief/status')).body.seen, true, 'seen: another device doesn’t open it again');
    assert.equal((await s.post('/api/brief/open', {})).body.at, b.at, 'built once a day');
    await s.post('/api/brief/used', { type: 'run' });
    const day = new Date().toLocaleDateString('sv');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.dir, 'data/brief', `${day}.json`), 'utf8')).used.map((u) => u.type), ['run']);
  } finally { await s.stop(); fs.rmSync(d, { recursive: true, force: true }); }
});

test('the brief is off where it isn’t switched on', { timeout: 30000 }, async () => {
  const s = await startServer({ GUBERNOS_BRIEF: '0' });
  try {
    assert.equal((await s.get('/api/state')).body.me.brief, false);
    assert.deepEqual((await s.post('/api/brief/open', {})).body, { enabled: false });
  } finally { await s.stop(); }
});
