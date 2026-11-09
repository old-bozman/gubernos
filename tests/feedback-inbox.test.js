// A report from another install is closed with the dev session's last answer, which the reporter reads in their app: the
// whole answer, steps included (2026-11-09: only its first line went, and an answer with steps lost them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('the reporter gets the whole last answer, not the owner’s accept line', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gubernos-inbox-'));
  process.env.GUBERNOS_VAULT = d; process.env.GUBERNOS_DATA_DIR = path.join(d, 'data'); process.env.GUBERNOS_CONFIG_DIR = path.join(d, 'config');
  try {
    const { _test } = await import('../lib/feedback-inbox.js');
    const body = 'Report\n\n## Agent log\n\n- 2026-11-09 11:14 · dev · An older answer\n- 2026-11-09 12:00 · dev · Thanks! To turn voice on:\n  1. Update.\n  2. Settings → Voice → Turn on voice.\n\n  Still no mic? Tap Still wrong.\n- 2026-11-09 12:05 · alex · Accepted & closed\n\n## Subtasks\n\n- [ ] x\n';
    assert.equal(_test.lastWord({ body }), 'Thanks! To turn voice on:\n1. Update.\n2. Settings → Voice → Turn on voice.\n\nStill no mic? Tap Still wrong.');
    assert.equal(_test.lastWord({ body: 'No log\n' }), '');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
