// The server's API on a fresh kit vault: what every install relies on.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, startServer } from './helpers.js';

let s;
before(async () => { s = await startServer(); });
after(async () => { await s?.stop(); });

test('state answers on a fresh vault', async () => {
  const r = await s.get('/api/state');
  assert.equal(r.status, 200, s.log());
  assert.ok(Array.isArray(r.body.tasks));
});

test('a test server never reaches the owner\'s calendar', async () => {
  const r = await s.get('/api/gcal/status');
  assert.equal(r.body.connected, false, JSON.stringify(r.body));
});

test('a task: create, read, complete', async () => {
  const c = await s.post('/api/tasks', { title: 'Buy milk', priority: 'planned' });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const id = c.body.id;
  assert.ok(fs.existsSync(path.join(s.vault, '10_tasks', `${id}.md`)));
  const g = await s.get(`/api/tasks/${id}`);
  assert.equal(g.body.title, 'Buy milk');
  const done = await s.post(`/api/tasks/${id}/complete`, {});
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal((await s.get(`/api/tasks/${id}`)).body.status, 'done');
});

test('an inbox item lands in 01_inbox', async () => {
  const r = await s.post('/api/items', { text: 'call the plumber' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(fs.readdirSync(path.join(s.vault, '01_inbox')).some((f) => f.endsWith('.md')));
});

test('the day view answers (habits, protocols)', async () => {
  const r = await s.get('/api/day');
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test('pairing: the Mac itself gets in, an outside request without the code does not', async () => {
  assert.equal((await fetch(`${s.url}/api/pair`)).status, 200);
  // turn pairing on, as setup.sh phone does
  const f = path.join(s.dir, 'data', 'pair.json');
  const p = JSON.parse(fs.readFileSync(f, 'utf8'));
  fs.writeFileSync(f, JSON.stringify({ ...p, required: true }));
  const out = await fetch(`${s.proxyUrl}/api/state`);
  assert.equal(out.status, 401);
  const ok = await fetch(`${s.proxyUrl}/api/state`, { headers: { 'x-gubernos-token': p.token } });
  assert.equal(ok.status, 200);
});

test('mirror: the phone copy has active files, not the archive', async () => {
  fs.writeFileSync(path.join(s.vault, '80_archive', 'old.md'), 'old');
  const r = await s.get('/api/mirror?since=0');
  assert.equal(r.status, 200);
  assert.ok(r.body.paths.includes('profile.md'));
  assert.ok(!r.body.paths.some((p) => p.startsWith('80_archive/')));
  assert.equal(Object.keys(r.body.files).length, r.body.paths.length);
  const later = await s.get(`/api/mirror?since=${r.body.now}`);
  assert.deepEqual(Object.keys(later.body.files), []);
});

test('the page: every script in public/ parses (one bad character takes the whole app down)', () => {
  const dir = path.join(ROOT, 'public'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gubernos-js-'));
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const copy = path.join(tmp, `${f}.mjs`); fs.copyFileSync(path.join(dir, f), copy);
    const r = spawnSync(process.execPath, ['--check', copy], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});
