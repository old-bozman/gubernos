// Updates for installs made by install.sh (the Mac app, the Linux and Windows lines): Gubernos looks for a newer version on
// GitHub every few hours and installs it at night, when no agent is running (Settings → Your Mac → Updates: now, or off).
// scripts/update.sh keeps the version before and goes back to it if the new one doesn't start, so a bad release can't leave
// someone without the app. A git checkout (a developer's; the owner's live copy, moved by scripts/release.sh) is left alone.
// 2026-11-09: fixes reached nobody until they ran update.sh or reinstalled.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { get as settings } from './settings.js';
import { runs } from './runner.js';

const APP = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = process.env.GUBERNOS_DATA_DIR || path.join(APP, 'data');
const VERSION_FILE = process.env.GUBERNOS_VERSION_FILE || path.join(APP, '.gubernos-version'); // tests: a stand-in
const LATEST_URL = process.env.GUBERNOS_UPDATE_URL || 'https://api.github.com/repos/old-bozman/gubernos/commits/main'; // tests: a stand-in
const UPDATE_CMD = process.env.GUBERNOS_UPDATE_CMD || path.join(APP, 'scripts/update.sh');
const LOG = path.join(DATA, 'update.log');
const NIGHT = [3, 5]; // local hours: updates on their own only then

// "owner/repo sha" from install.sh; none in a git checkout
const current = () => { try { return fs.readFileSync(VERSION_FILE, 'utf8').trim().split(/\s+/)[1] || null; } catch { return null; } };
let latest = null, checkedAt = 0, updating = false, error = null;

export async function check() {
  if (!current()) return status();
  try {
    const r = await fetch(LATEST_URL, { headers: { Accept: 'application/vnd.github.sha', 'User-Agent': 'gubernos' }, signal: AbortSignal.timeout(15000) });
    const sha = (await r.text()).trim();
    if (r.ok && /^[0-9a-f]{40}$/.test(sha)) { latest = sha; error = null; } else error = `GitHub answered ${r.status}`;
  } catch (e) { error = `couldn't reach GitHub: ${e.message}`; }
  checkedAt = Date.now();
  return status();
}

// the last lines update.sh wrote (what it did, or why it went back)
const lastLog = () => { try { return fs.readFileSync(LOG, 'utf8').trim().split('\n').slice(-3).join('\n'); } catch { return ''; } };
export const status = () => {
  const cur = current();
  return { managed: !!cur, current: cur?.slice(0, 7) || null, latest: latest?.slice(0, 7) || null, available: !!(cur && latest && latest !== cur),
    auto: settings().autoUpdate !== false, updating, error, checkedAt, log: lastLog() };
};

// update.sh restarts this server at the end: it runs detached, its output in data/update.log
export function apply() {
  if (!current()) throw Object.assign(new Error('this copy is a git checkout: update it with git'), { status: 409 });
  if (updating) return status();
  updating = true;
  fs.mkdirSync(DATA, { recursive: true });
  fs.appendFileSync(LOG, `\n${new Date().toISOString()} update ${current().slice(0, 7)} → ${latest?.slice(0, 7) || 'latest'}\n`);
  const env = { ...process.env, GUBERNOS_UPDATE_LOG: LOG };
  // AICODE-NOTE: systemd stops everything in the service's cgroup on restart, update.sh included (it restarts the service,
  // then checks the new version answers): on Linux it runs as its own transient unit. launchd leaves a detached process alone.
  const systemd = process.platform === 'linux' && fs.existsSync('/run/systemd/system') && !process.env.GUBERNOS_UPDATE_CMD;
  const [cmd, args] = systemd
    ? ['systemd-run', ['--user', '--collect', '--quiet', `--unit=gubernos-update-${Date.now()}`, `--working-directory=${APP}`, `--setenv=GUBERNOS_UPDATE_LOG=${LOG}`, `--setenv=PATH=${process.env.PATH}`, 'bash', UPDATE_CMD]]
    : ['bash', [UPDATE_CMD]];
  const c = spawn(cmd, args, { cwd: APP, env, detached: true, stdio: 'ignore' });
  c.on('exit', () => { if (!systemd) updating = false; }); // only seen when it didn't restart us (nothing new, or it went back)
  c.on('error', (e) => { updating = false; error = e.message; });
  c.unref();
  if (systemd) setTimeout(() => { updating = false; }, 10 * 60e3).unref();
  return status();
}

// every 4 hours (and 10 minutes after start): look; at night, with no agent running, install what's new
export function start() {
  if (!current() || process.env.GUBERNOS_NO_UPDATE) return;
  const tick = async () => {
    await check();
    const h = new Date().getHours(), busy = [...runs.values()].some((r) => r.state === 'running');
    if (status().available && status().auto && h >= NIGHT[0] && h < NIGHT[1] && !busy) apply();
  };
  setTimeout(tick, 10 * 60e3).unref();
  setInterval(tick, 4 * 3600e3).unref();
  // the night window is short: look once more inside it
  setInterval(() => { const h = new Date().getHours(); if (h === NIGHT[0] && Date.now() - checkedAt > 3600e3) tick(); }, 30 * 60e3).unref();
}
