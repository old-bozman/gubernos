// A task said without a date is for today (2026-11-16 Alex: "я забываю её сказать, а у меня никто не спрашивает");
// a deadline, a repeat or "someday" keep their own dates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from './helpers.js';

test('dictated tasks with no date are due today', { timeout: 30000 }, async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gubernos-voice-'));
  const fake = path.join(d, 'claude');
  const t = (title, extra = {}) => ({ title, priority: 'planned', assigned: 'me', due: null, deadline: null, project: null, notes: '', ...extra });
  fs.writeFileSync(fake, `#!/usr/bin/env node
const a = process.argv.slice(2);
if (a[0] === 'auth') { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
console.log(JSON.stringify({ structured_output: { intent: 'tasks', tasks: ${JSON.stringify([
    t('Call the plumber'), t('Learn Dutch', { priority: 'someday' }), t('Water the plants', { repeat: 'every monday' }),
  ])} }, total_cost_usd: 0 }));
`, { mode: 0o755 });
  const s = await startServer({ GUBERNOS_CLAUDE_BIN: fake });
  try {
    const today = new Date().toLocaleDateString('sv');
    const r = (await s.post('/api/voice/parse', { text: 'call the plumber, learn dutch someday, water the plants every monday' })).body;
    const [call, dutch, plants] = r.tasks;
    assert.equal(call.due, today, 'no date said → today');
    assert.equal(dutch.due, null, 'someday stays undated');
    assert.ok(plants.recurrence && plants.due, 'a repeat gets its first occurrence');
  } finally { await s.stop(); fs.rmSync(d, { recursive: true, force: true }); }
});
