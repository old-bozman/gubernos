// npm test itself must not be able to hang: a release waits on it. A test process that dies halfway through a message leaves
// node's runner spinning for ever; the deadline in tests/run.mjs has to end that as a failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './helpers.js';

// this file itself runs under node --test: without this, the run under test would act as one of its child processes
const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;

test('a run that hangs is stopped at the limit and fails, saying why', { timeout: 60000 }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gubernos-runner-'));
  try {
    const hang = path.join(d, 'hang.test.mjs');
    // the runner's message header, a length, and no body
    fs.writeFileSync(hang, "import fs from 'node:fs';\nfs.writeSync(1, Buffer.from([0xff, 0x0f, 0, 0, 1, 0, 1, 2, 3]));\n");
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tests/run.mjs'), hang], { encoding: 'utf8', env: { ...env, GUBERNOS_TEST_LIMIT_MS: '4000' }, timeout: 40000 });
    assert.equal(r.status, 1, `exit ${r.status} ${r.signal || ''}`);
    assert.match(r.stderr, /still going after 4 s/);
    assert.ok(Date.now() - t0 < 30000);
    const left = spawnSync('pgrep', ['-f', hang], { encoding: 'utf8' }).stdout.trim();
    assert.equal(left, '', 'nothing of it keeps running');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('a passing run passes, a failing run fails', { timeout: 60000 }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gubernos-runner-'));
  try {
    const good = path.join(d, 'good.test.mjs'), bad = path.join(d, 'bad.test.mjs');
    fs.writeFileSync(good, "import { test } from 'node:test';\ntest('ok', () => {});\n");
    fs.writeFileSync(bad, "import { test } from 'node:test';\ntest('no', () => { throw new Error('no'); });\n");
    assert.equal(spawnSync(process.execPath, [path.join(ROOT, 'tests/run.mjs'), good], { encoding: 'utf8', env, timeout: 40000 }).status, 0);
    assert.equal(spawnSync(process.execPath, [path.join(ROOT, 'tests/run.mjs'), bad], { encoding: 'utf8', env, timeout: 40000 }).status, 1);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
