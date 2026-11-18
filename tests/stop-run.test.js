// ■ Stop on a task whose run died with the app (a restart): no live process, agent_state still running.
// 2026-11-18 a task hung at "agent is working" for two days and Stop did nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from './helpers.js';

test('Stop resets a running state with no live run behind it', { timeout: 30000 }, async () => {
  const s = await startServer();
  try {
    const t = (await s.post('/api/tasks', { title: 'Compare the offers', assigned: 'agent' })).body;
    const file = fs.readdirSync(path.join(s.vault, '10_tasks')).map((f) => path.join(s.vault, '10_tasks', f)).find((f) => f.includes(t.id));
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^agent_state: .*\n/m, '').replace(/^assigned: agent$/m, 'assigned: agent\nagent_state: running')
      + '\n## Agent log\n\n- 2026-11-16 09:18 · app · Run started (Claude Code)\n');
    assert.equal((await s.get(`/api/tasks/${t.id}`)).body.agent_state, 'running');
    const r = await s.post(`/api/tasks/${t.id}/stop`, {});
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.state, 'stopped');
    const after = (await s.get(`/api/tasks/${t.id}`)).body;
    assert.equal(after.agent_state, 'queued');
    assert.match(after.body, /Run stopped \(no live process/);
  } finally { await s.stop(); }
});
