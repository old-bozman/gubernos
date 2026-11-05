// The models Gubernos works with: Claude and ChatGPT. Gemini was one until 2026-11; an install that used it keeps working.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from './helpers.js';

test('an install that used Gemini: no Gemini anywhere, its tasks and settings still work', { timeout: 40000 }, async () => {
  const s = await startServer();
  try {
    assert.ok(!fs.existsSync(path.join(s.vault, '.gemini')), 'a new vault still gets Gemini settings');
    fs.writeFileSync(path.join(s.dir, 'data/settings.json'), JSON.stringify({ provider: 'gemini', agents: [{ id: 'claude', name: 'Claude', run: 'gemini', on: true }, { id: 'gemini', name: 'Gemini', run: 'gemini', on: true }, { id: 'writer', name: 'Writer', run: 'gemini', on: true }] }));
    const list = (await s.get('/api/settings')).body.agentList;
    assert.ok(!list.some((a) => a.id === 'gemini' || a.run === 'gemini'), JSON.stringify(list));
    assert.equal(list.find((a) => a.id === 'claude').run, 'claude');
    assert.equal(list.find((a) => a.id === 'writer').run, 'claude');
    const ob = await s.get('/api/onboard');
    assert.equal(ob.status, 200);
    assert.deepEqual(ob.body.models.map((m) => m.id), ['claude', 'codex']);
    // a task still addressed to Gemini goes to the app's model (no CLI here: it waits in the queue), it doesn't fail
    const t = await s.post('/api/tasks', { title: 'Old task' });
    const f = path.join(s.vault, '10_tasks', `${t.body.id}.md`);
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^agent:.*\n/m, '').replace(/^status:/m, 'agent: gemini\nstatus:'));
    assert.equal((await s.get(`/api/tasks/${t.body.id}`)).body.agent, 'gemini');
    const run = await s.post(`/api/tasks/${t.body.id}/run`, {});
    assert.equal(run.status, 200, JSON.stringify(run.body));
    assert.equal(run.body.state, 'queued');
    assert.equal((await s.get(`/api/tasks/${t.body.id}`)).body.agent ?? null, null);
    // and it can't be chosen again
    await s.patch('/api/settings', { provider: 'gemini' });
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.dir, 'data/settings.json'), 'utf8')).provider, 'gemini', 'unchanged, not set anew');
    await s.patch('/api/settings', { provider: 'codex' });
    await s.patch('/api/settings', { provider: 'gemini' });
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.dir, 'data/settings.json'), 'utf8')).provider, 'codex');
  } finally { await s.stop(); }
});
