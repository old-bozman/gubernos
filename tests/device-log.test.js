// The iPhone app's own log (lib/device-log.js, gubernos-ios AppLog.swift): the phone sends it when its owner shares it,
// and a bug report from the phone carries its last lines. 2026-11-10: the app hung 30 s away from the Mac and there was
// no way to see why without Xcode.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from './helpers.js';

let s;
before(async () => { s = await startServer(); }, { timeout: 30000 });
after(async () => { await s?.stop(); });

test('the developer’s own Mac says so to the phone (it shares its log without asking)', async () => {
  assert.equal((await s.get('/api/pair')).body.dev, true);
});

test('a phone’s log is kept, and a report from the phone carries its tail', async () => {
  const lines = Array.from({ length: 60 }, (_, i) => `2026-11-10 10:00:${String(i).padStart(2, '0')} shell line ${i}`);
  lines.push('2026-11-10 10:01:00 shell looked for the Mac 8846 ms → offline (no answer: -1004)');
  const r = await s.post('/api/device-log', { device: 'ab12cd34', lines });
  assert.equal(r.status, 200);
  assert.match(fs.readFileSync(path.join(s.dir, 'data', 'device-logs', 'ab12cd34.log'), 'utf8'), /looked for the Mac 8846 ms/);
  assert.equal((await s.post('/api/device-log', { lines })).status, 400, 'no device id');

  const fromPhone = await s.post('/api/feedback', { kind: 'bug', text: 'hung on open', context: { device: 'iPhone · 402x874', screen: 'Today' } });
  assert.equal(fromPhone.status, 200);
  const body = fs.readFileSync(path.join(s.vault, '10_tasks', `${fromPhone.body.task.id}.md`), 'utf8');
  assert.match(body, /## Phone log[\s\S]*looked for the Mac 8846 ms/);
  assert.doesNotMatch(body, /shell line 10\b/, 'only the tail');

  const fromMac = await s.post('/api/feedback', { kind: 'bug', text: 'on the Mac', context: { device: 'Mac · 1440x900', screen: 'Today' } });
  assert.doesNotMatch(fs.readFileSync(path.join(s.vault, '10_tasks', `${fromMac.body.task.id}.md`), 'utf8'), /Phone log/);
});
