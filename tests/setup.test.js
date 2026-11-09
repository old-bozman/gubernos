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
  // a new install gets the line on each screen; running setup again doesn't turn it back on for someone who switched it off
  const settings = path.join(app, 'data/settings.json');
  assert.equal(JSON.parse(fs.readFileSync(settings, 'utf8')).screenIntros, true);
  fs.writeFileSync(settings, JSON.stringify({ screenIntros: false }));
  execFileSync('bash', [path.join(app, 'scripts/setup.sh'), 'install', '--vault', '~/Gubernos', '--name', 'Sam', '--no-launchd'], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
  assert.equal(JSON.parse(fs.readFileSync(settings, 'utf8')).screenIntros, false);
  fs.rmSync(d, { recursive: true, force: true });
});

// Voice with nothing to choose (2026-11-09: an install from another person had no mic, and nothing said why): install runs
// voice-auto, which leaves a Mac whose own model hears the language as it is and gets Whisper where nothing does.
test('voice: the Mac’s own model when it hears the language; where nothing does, Whisper is the next step', { skip: process.platform !== 'darwin' }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gubernos-voice-'));
  try {
    fs.mkdirSync(path.join(d, 'app/scripts'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'scripts/setup.sh'), path.join(d, 'app/scripts/setup.sh'));
    const helper = (json) => { const f = path.join(d, `helper-${Math.random().toString(36).slice(2)}`); fs.writeFileSync(f, `#!/bin/sh\necho '${json}'\n`, { mode: 0o755 }); return f; };
    const run = (args, env = {}) => execFileSync('bash', [path.join(d, 'app/scripts/setup.sh'), ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
    // macOS 26+: Russian through the dictation model, nothing to install
    assert.match(run(['voice-auto', 'ru-RU'], { GUBERNOS_VOICE_HELPER: helper('{"speech":["en_US"],"dictation":["en_US","ru_RU"]}') }), /ru-RU, heard by this Mac's own model/);
    // an older macOS (the helper says so): on Apple Silicon it goes for Whisper; uv stood in for, failing, so nothing is installed
    const bin = path.join(d, 'bin'); fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'uv'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const out = run(['voice-auto', 'ru-RU'], { GUBERNOS_VOICE_HELPER: helper('{"error":"needs macOS 26"}'), PATH: `${bin}:${process.env.PATH}` });
    if (os.arch() === 'arm64') { assert.match(out, /nothing here hears ru-RU yet, so Gubernos gets Whisper/); assert.match(out, /Turn on voice tries again/); }
    else assert.match(out, /Whisper needs Apple Silicon/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
