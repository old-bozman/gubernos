import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.GUBERNOS_VAULT ||= os.tmpdir(); // lib/config.js wants one; the tests pass their own root
const { backupToday, prune } = await import('../lib/backup.js');

test('a daily copy of the .md files, once a day', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-'));
  fs.mkdirSync(path.join(d, 'v/10_tasks'), { recursive: true }); fs.mkdirSync(path.join(d, 'v/.obsidian'));
  fs.writeFileSync(path.join(d, 'v/10_tasks/a.md'), 'a'); fs.writeFileSync(path.join(d, 'v/.obsidian/x.md'), 'x'); fs.writeFileSync(path.join(d, 'v/pic.png'), 'p');
  const r = backupToday({ root: path.join(d, 'v'), dir: path.join(d, 'b'), today: '2026-11-04' });
  assert.deepEqual(r, { made: true, files: 1, skipped: 0 });
  assert.equal(fs.readFileSync(path.join(d, 'b/2026-11-04/10_tasks/a.md'), 'utf8'), 'a');
  assert.ok(!fs.existsSync(path.join(d, 'b/2026-11-04/pic.png')));
  assert.deepEqual(backupToday({ root: path.join(d, 'v'), dir: path.join(d, 'b'), today: '2026-11-04' }), { made: false });
  fs.rmSync(d, { recursive: true, force: true });
});

test('keeps 14 days and the newest copy of 8 older weeks', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-'));
  const day = (n) => new Date(Date.UTC(2026, 10, 4) - n * 864e5).toISOString().slice(0, 10);
  for (let n = 0; n < 120; n++) fs.mkdirSync(path.join(d, day(n)));
  prune(d);
  const left = fs.readdirSync(d).sort().reverse();
  assert.equal(left.length, 22);
  assert.deepEqual(left.slice(0, 14), Array.from({ length: 14 }, (_, n) => day(n)));
  // each older copy is a Sunday (the newest day of its Monday-started week)
  for (const x of left.slice(14)) assert.equal(new Date(`${x}T12:00:00Z`).getUTCDay(), 0, x);
  fs.rmSync(d, { recursive: true, force: true });
});
