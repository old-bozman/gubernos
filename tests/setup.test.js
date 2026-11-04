// scripts/setup.sh install on a fresh "Mac": a copy of the app and a fake home, so nothing touches the real config,
// LaunchAgents or node_modules. The vault goes to the default ~/Gubernos (no iCloud needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './helpers.js';

test('install into ~/Gubernos without iCloud', { timeout: 180000 }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gubernos-setup-'));
  const app = path.join(d, 'app'), home = path.join(d, 'home');
  fs.mkdirSync(home);
  execFileSync('rsync', ['-a', '--exclude', 'node_modules', '--exclude', 'data', '--exclude', '.git', '--exclude', 'server.log', '--exclude', '.venv', `${ROOT}/`, `${app}/`]);
  const out = execFileSync('bash', [path.join(app, 'scripts/setup.sh'), 'install', '--vault', '~/Gubernos', '--name', 'Sam', '--no-launchd'],
    { env: { ...process.env, HOME: home }, encoding: 'utf8' });
  assert.match(out, /4\/4 background service skipped/);
  const cfg = JSON.parse(fs.readFileSync(path.join(home, '.config/gubernos/config.json'), 'utf8'));
  assert.equal(fs.realpathSync(cfg.vault), fs.realpathSync(path.join(home, 'Gubernos')));
  for (const f of ['CLAUDE.md', 'AGENTS.md', 'profile.md', '10_tasks']) assert.ok(fs.existsSync(path.join(home, 'Gubernos', f)), f);
  assert.match(fs.readFileSync(path.join(home, 'Gubernos', 'profile.md'), 'utf8'), /Sam/);
  fs.rmSync(d, { recursive: true, force: true });
});
