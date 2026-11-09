// Updates for installs made by install.sh (lib/update.js, scripts/update.sh): Settings shows a newer version and installs it
// on a tap; and a new version that doesn't start goes back to the one before, so a bad release can't leave anyone without
// the app. Never GitHub, never the real service: stand-ins for both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { ROOT, startServer } from './helpers.js';
import { openPage } from './chrome.js';

const OLD = 'a'.repeat(40), NEW = 'b'.repeat(40);

test('a newer version: Settings says so, and Update now runs the update', { timeout: 60000 }, async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gubernos-update-'));
  const gh = http.createServer((_, res) => res.end(NEW));
  await new Promise((ok) => gh.listen(0, '127.0.0.1', ok));
  fs.writeFileSync(path.join(d, 'version'), `old-bozman/gubernos ${OLD}\n`);
  fs.writeFileSync(path.join(d, 'update.sh'), `#!/bin/bash\necho "ran $GUBERNOS_UPDATE_LOG" > "${path.join(d, 'ran')}"\n`, { mode: 0o755 });
  const s = await startServer({ GUBERNOS_VERSION_FILE: path.join(d, 'version'), GUBERNOS_UPDATE_URL: `http://127.0.0.1:${gh.address().port}/`, GUBERNOS_UPDATE_CMD: path.join(d, 'update.sh') });
  const page = await openPage();
  try {
    const u = (await s.get('/api/update')).body;
    assert.deepEqual([u.managed, u.current, u.latest, u.available, u.auto], [true, 'aaaaaaa', 'bbbbbbb', true, true]);
    await page.goto(`${s.url}/#/settings`);
    const row = '[...document.querySelectorAll(".settings .set-row")].find((r) => r.querySelector(".set-l").firstChild.textContent.trim() === "Updates")';
    assert.ok(await page.waitFor(`!!${row}?.querySelector("[data-act=set-update-now]")`, 15000), 'no Updates row with Update now');
    assert.ok(await page.eval(`${row}.innerText.includes("a new version is out: bbbbbbb")`));
    await page.eval(`${row}.querySelector("[data-act=set-update-now]").click()`);
    for (let i = 0; i < 50 && !fs.existsSync(path.join(d, 'ran')); i++) await new Promise((ok) => setTimeout(ok, 100));
    assert.match(fs.readFileSync(path.join(d, 'ran'), 'utf8'), /ran .*update\.log/, 'update.sh didn’t run, or not with its log');
    // off: only when asked
    await page.eval(`${row}.querySelector("[data-act=set-autoupdate][data-val=off]").click()`);
    for (let i = 0; i < 30 && (await s.get('/api/update')).body.auto; i++) await new Promise((ok) => setTimeout(ok, 100));
    assert.equal((await s.get('/api/update')).body.auto, false);
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); await s.stop(); gh.close(); fs.rmSync(d, { recursive: true, force: true }); }
});

test('a new version that doesn’t start: update.sh goes back to the one before', { timeout: 60000 }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gubernos-rollback-'));
  try {
    const app = path.join(d, 'app'), home = path.join(d, 'home');
    fs.mkdirSync(path.join(app, 'scripts'), { recursive: true }); fs.mkdirSync(path.join(home, '.config/gubernos'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'scripts/update.sh'), path.join(app, 'scripts/update.sh'));
    fs.writeFileSync(path.join(app, '.gubernos-version'), `old-bozman/gubernos ${OLD}\n`);
    fs.writeFileSync(path.join(app, 'server.js'), '// the good one\n');
    fs.mkdirSync(path.join(app, 'data')); fs.writeFileSync(path.join(app, 'data/keep.json'), '{"mine":true}');
    // the "new version": install.sh --update stood in for, putting a broken server in place
    fs.writeFileSync(path.join(app, 'install.sh'), `printf 'old-bozman/gubernos ${NEW}\\n' > "$GUBERNOS_DIR/.gubernos-version"; echo '// broken' > "$GUBERNOS_DIR/server.js"\n`);
    fs.writeFileSync(path.join(home, '.config/gubernos/config.json'), '{"port": 9}'); // nothing answers there
    let out = '';
    try {
      execFileSync('bash', [path.join(app, 'scripts/update.sh')], { encoding: 'utf8', stdio: 'pipe',
        env: { ...process.env, HOME: home, GUBERNOS_CONFIG_DIR: path.join(home, '.config/gubernos'), GUBERNOS_RESTART_CMD: `echo restarted >> "${path.join(d, 'restarts')}"`, GUBERNOS_UPDATE_WAIT: '1' } });
    } catch (e) { out = `${e.stdout}${e.stderr}`; }
    assert.match(out, /didn't start: going back to aaaaaaa/);
    assert.equal(fs.readFileSync(path.join(app, '.gubernos-version'), 'utf8').trim(), `old-bozman/gubernos ${OLD}`);
    assert.equal(fs.readFileSync(path.join(app, 'server.js'), 'utf8'), '// the good one\n');
    assert.equal(fs.readFileSync(path.join(app, 'data/keep.json'), 'utf8'), '{"mine":true}', 'the person’s data was touched');
    assert.equal(fs.readFileSync(path.join(d, 'restarts'), 'utf8').trim().split('\n').length, 2, 'not restarted on the new version and again on the old one');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
