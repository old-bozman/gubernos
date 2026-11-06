// The app on ChatGPT (Codex), with a stand-in for the CLI that parses its arguments like the real one: text starting with "-"
// is taken for an option. 2026-11-06, the first real run on a clean Mac: the interview's first turn sends the onboarding
// skill, which starts with "---" (its front matter), and Codex refused it, so ChatGPT people got "The model couldn't answer".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from './helpers.js';

let s, dir;
const calls = () => fs.readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gubernos-codex-'));
  const home = path.join(dir, 'home');
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(home, '.codex/auth.json'), '{}'); // signed in, as Codex keeps it
  const fake = path.join(dir, 'codex');
  fs.writeFileSync(fake, `#!/usr/bin/env node
const fs = require('fs'), a = process.argv.slice(2);
if (a[0] === 'login') process.exit(0);
const prompt = a.at(-1);
if (prompt.startsWith('-')) { console.error("error: unexpected argument '" + prompt.slice(0, 200) + "' found"); process.exit(2); }
fs.appendFileSync(${JSON.stringify(path.join(dir, 'calls'))}, JSON.stringify(a) + '\\n');
const out = a.includes('-o') ? a[a.indexOf('-o') + 1] : null;
if (out) { fs.writeFileSync(out, JSON.stringify({ reply: 'ok', finished: false })); process.exit(0); }
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }));
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify({ reply: 'Hi Sam. What do you look after?', finished: false }) } }));
`, { mode: 0o755 });
  s = await startServer({ HOME: home, GUBERNOS_CODEX_BIN: fake });
  await s.patch('/api/settings', { provider: 'codex' });
}, { timeout: 30000 });
after(async () => { await s?.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

test('the interview on ChatGPT: the first turn reaches Codex and its answer comes back, the next one resumes the thread', { timeout: 30000 }, async () => {
  const first = await s.post('/api/onboard', { message: 'I am Sam, I run a small bakery.' });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.turns.at(-1).text, 'Hi Sam. What do you look after?');
  const [a] = calls();
  assert.ok(a.at(-1).includes('name: onboarding') && a.at(-1).includes('I am Sam'), 'the skill and the message go together');
  const next = await s.post('/api/onboard', { message: '- The bakery\n- The kids' });
  assert.equal(next.status, 200, JSON.stringify(next.body));
  const b = calls()[1];
  assert.deepEqual(b.slice(0, 3), ['exec', 'resume', 'thread-1']);
  assert.ok(b.at(-1).includes('The bakery'), 'a list the person pastes still arrives');
});
