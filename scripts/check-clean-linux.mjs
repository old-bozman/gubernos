#!/usr/bin/env node
// The install on a clean Linux machine, with nobody at the keyboard: a new Ubuntu VM (tart, cirruslabs' image), the one-line
// install from GitHub, the setup page driven through an SSH tunnel (no screen there: the page's link is printed), the
// systemd user service, Today, a restart, an update, a reboot. Then the whole test suite on that machine. Windows people
// run the same thing in WSL. Screenshots and the report go to the printed folder. Exit 1 if a check failed.
//   node scripts/check-clean-linux.mjs [--branch dev] [--keep] [--no-tests]     (--branch: what install.sh downloads)
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openPage } from '../tests/chrome.js';

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const BRANCH = arg('--branch') || 'main', KEEP = process.argv.includes('--keep'), TESTS = !process.argv.includes('--no-tests');
const TART = [path.join(os.homedir(), '.local/bin/tart'), '/opt/homebrew/bin/tart'].find((f) => fs.existsSync(f)) || 'tart';
const VM = 'gubernos-linux', BASE = 'ghcr.io/cirruslabs/ubuntu:latest';
const SETUP_PORT = 4746, APP_PORT = 4747, HOST_APP = 4847;
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'gubernos-cleanlinux-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = [];
let failed = 0, n = 0, ip, tunnel, page;
const say = (l) => { console.log(l); report.push(l); };
const check = (ok, text, detail = '') => { if (!ok) failed++; say(`${ok ? '✓' : '✗'} ${text}${!ok && detail ? `\n  ${String(detail).slice(0, 900)}` : ''}`); return ok; };
const tart = (...a) => spawnSync(TART, a, { encoding: 'utf8' });
const until = async (fn, ms, every = 1000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await sleep(every); } };
const seconds = (t) => `${Math.round((Date.now() - t) / 1000)} s`;
const key = path.join(OUT, 'key');
const SSH = () => ['-i', key, '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'LogLevel=ERROR', '-o', 'ConnectTimeout=5', `admin@${ip}`];
const ssh = (cmd, ms = 120000) => { const r = spawnSync('ssh', [...SSH(), cmd], { encoding: 'utf8', timeout: ms }); return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim() }; };
const shot = async (name) => { n++; await page.screenshot(path.join(OUT, `${String(n).padStart(2, '0')}-${name}.png`)); };
const PATHS = 'export PATH="$HOME/.gubernos/node/bin:$HOME/.local/bin:$PATH"';

async function bootVm() {
  if (tart('list').stdout.includes(VM)) { tart('stop', VM); tart('delete', VM); }
  const c = tart('clone', BASE, VM);
  if (c.status !== 0) throw new Error(`clone: ${c.stderr}`);
  const log = path.join(OUT, 'vm.log');
  spawn(TART, ['run', '--no-graphics', VM], { stdio: ['ignore', fs.openSync(log, 'a'), fs.openSync(log, 'a')], detached: true }).unref();
  ip = tart('ip', VM, '--wait', '180').stdout.trim();
  if (!ip) throw new Error('the VM got no address');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key]);
  const pub = fs.readFileSync(`${key}.pub`, 'utf8').trim();
  const exp = `set timeout 20\nspawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR admin@${ip} "mkdir -p ~/.ssh && echo '${pub}' >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"\nexpect "assword:" { send "admin\\r" }\nexpect eof\n`;
  if (!await until(() => { spawnSync('expect', ['-c', exp], { timeout: 30000 }); return ssh('true').ok; }, 180000, 3000)) throw new Error('no SSH into the VM');
}

async function run() {
  const t0 = Date.now();
  await bootVm();
  say(`  the VM is up in ${seconds(t0)}: ${ssh('. /etc/os-release; echo "$PRETTY_NAME $(uname -m)"').out}`);
  const look = ssh('ls -a ~ | grep -i gubernos; ls -d ~/.config/gubernos 2>/dev/null; command -v node claude codex; true');
  check(!look.out, 'the machine is clean (no Gubernos, no Node, no model CLI)', look.out);
  check(ssh('systemctl --user show-environment >/dev/null').ok, 'it has systemd for the user (Ubuntu; WSL with systemd=true)');

  // the one line people type, with the setup page instead of an agent (no screen here: it prints the link)
  const t1 = Date.now();
  ssh(`nohup bash -c 'curl -fsSL https://raw.githubusercontent.com/old-bozman/gubernos/${BRANCH}/install.sh | GUBERNOS_BRANCH=${BRANCH} bash -s -- --wizard' > ~/install.log 2>&1 &`, 20000);
  const link = await until(() => { const r = ssh('cat ~/.gubernos/first-run-link 2>/dev/null'); return r.ok && r.out.startsWith('http') ? r.out : null; }, 600000, 3000);
  if (!check(!!link, `the installer gets Node and the app and prints the setup link, in ${seconds(t1)}`, ssh('tail -20 ~/install.log').out)) throw new Error('no setup page');
  check(/first run: http/.test(ssh('cat ~/install.log').out), 'with no screen, the link is printed for the person', ssh('tail -5 ~/install.log').out);

  tunnel = spawn('ssh', [...SSH().slice(0, -1), '-N', '-L', `${SETUP_PORT}:127.0.0.1:${SETUP_PORT}`, '-L', `${HOST_APP}:127.0.0.1:${APP_PORT}`, `admin@${ip}`], { stdio: 'ignore' });
  await sleep(2000);
  page = await openPage();
  await page.resize(900, 1100);
  await page.goto(link); // the same port on this side: the page answers only to 127.0.0.1:4746 as its Host
  check(await page.waitFor('document.querySelector("input[name=folder]")', 20000), 'the setup page shows', page.errors.join(' | '));
  check(await page.waitFor('/this computer/.test(document.querySelector(".lead").innerText) && /Keep this computer awake/.test(document.querySelector("#awake").closest("label").innerText)'), 'it speaks of “this computer”, and offers to keep it awake', await page.eval('document.querySelector(".lead").innerText + " | " + document.querySelector("#awake").closest("label").innerText'));
  await shot('setup');
  check(/On this computer/.test(await page.eval('document.querySelector("#folders, form")?.innerText || ""')), 'it offers a folder here');
  await page.eval(`(() => {
    const f = window.fetch;
    window.fetch = async (...a) => { const r = await f(...a); if (String(a[0]) !== '/job') return r; const j = await r.clone().json(); if (!j.next) return r;
      j.next = j.next.replace(':${APP_PORT}', ':${HOST_APP}'); return new Response(JSON.stringify(j), { status: r.status, headers: { 'content-type': 'application/json' } }); };
    document.querySelector("#name").value = "Sam"; document.querySelector("#awake").checked = true; document.querySelector("#go").click();
  })()`);
  const t2 = Date.now();
  const went = await until(async () => (await page.eval('location.href').catch(() => '')).includes('#/onboard'), 480000, 1000);
  if (!check(!!went, `it sets up and hands over to the interview, in ${seconds(t2)}`, await page.eval('(document.querySelector("#status")?.innerText || "") + " " + (document.querySelector("#log")?.innerText || "")').catch(() => ''))) throw new Error('setup failed');
  await sleep(1500); await shot('interview');

  check(ssh('systemctl --user is-active gubernos.service').out === 'active', 'it runs as a systemd user service', ssh('systemctl --user status gubernos.service --no-pager | tail -5').out);
  check(ssh('loginctl show-user "$USER" -p Linger').out === 'Linger=yes', 'and keeps running after logging out (linger)', ssh('loginctl show-user "$USER" -p Linger').out);
  // keeping it awake: Ubuntu's polkit lets only someone at the screen hold off sleep, so a background service needs one
  // admin step (a polkit rule), which the setup prints; this check doesn't change the system, it checks what's said and
  // that the service waits quietly instead of spinning
  const aw = ssh(`${PATHS}; ~/.gubernos/app/scripts/setup.sh awake on`);
  const locked = /Gubernos/.test(ssh('systemd-inhibit --list --no-pager').out);
  check(locked || (/an admin runs once/.test(aw.out) && /50-gubernos-awake\.rules/.test(aw.out)), locked ? 'kept awake while plugged in: Gubernos holds the sleep lock' : 'keeping it awake needs one admin step here, and the setup says which', aw.out);
  await sleep(5000);
  const spins = Number(ssh('journalctl --user -u gubernos-awake --since "-5s" --no-pager | grep -c inhibit').out) || 0;
  check(spins <= 1, `without the rule the keep-awake service waits instead of spinning (${spins} tries in 5 s)`);
  const home = ssh('ls -a ~ | grep -i gubernos').out.split('\n');
  check(home.includes('.gubernos') && home.includes('Gubernos'), 'the app is in ~/.gubernos, the files in ~/Gubernos', home.join(' '));
  check(/Sam/.test(ssh('cat ~/Gubernos/profile.md').out), 'the files are the person’s');
  await page.goto(`http://127.0.0.1:${HOST_APP}/#/today`);
  check(await page.waitFor('document.querySelector("#main")?.innerText.trim().length > 0', 15000), 'Today opens');
  await sleep(1500); await shot('today');
  await page.goto(`http://127.0.0.1:${HOST_APP}/#/settings`);
  await page.waitFor('document.querySelector(".settings .set-row")', 15000); await sleep(2000);
  const cal = await page.eval('[...document.querySelectorAll(".settings .set-row")].find((r) => r.querySelector(".set-l").firstChild.textContent.trim() === "Calendar")?.innerText || ""');
  check(/Google/.test(cal), 'Settings: the calendar is Google here (no Mac calendar on Linux)', cal);
  await shot('settings');
  const errors = page.errors.filter((e) => !/favicon|:4746/.test(e));
  check(!errors.length, 'no errors in the pages', errors.join(' | '));

  // voice: Whisper on Linux (faster-whisper, CPU), a sentence said on this Mac, heard there
  const t4 = Date.now();
  const v = ssh(`${PATHS}; ~/.gubernos/app/scripts/setup.sh voice 2>&1 | tail -3`, 1200000);
  check(/Whisper ready/.test(v.out), `setup.sh voice installs Whisper here, in ${seconds(t4)}`, v.out);
  const wav = path.join(OUT, 'say.wav');
  execFileSync('say', ['-v', 'Samantha', '-o', wav, '--file-format=WAVE', '--data-format=LEI16@16000', 'Remind me to call the plumber tomorrow at ten.']);
  execFileSync('scp', ['-i', key, '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'LogLevel=ERROR', wav, `admin@${ip}:/tmp/say.wav`]);
  const heard = ssh(`cd ~/.gubernos/app && echo '{"id":1,"path":"/tmp/say.wav","language":"en"}' | .venv/bin/python lib/stt.py full`, 600000);
  check(/plumber/i.test(heard.out) && /tomorrow/i.test(heard.out), `Whisper hears it: ${heard.out.match(/"text": *"([^"]*)"/)?.[1] || heard.out.slice(0, 200)}`, heard.out);
  check(/"engine":"whisper"/.test(ssh(`curl -s http://127.0.0.1:${APP_PORT}/api/voice/status`).out), 'the app uses Whisper for voice now', ssh(`curl -s http://127.0.0.1:${APP_PORT}/api/voice/status`).out);
  const answers = () => ssh(`curl -sf -o /dev/null http://127.0.0.1:${APP_PORT}/api/settings`).ok;
  const r1 = ssh(`${PATHS}; ~/.gubernos/app/scripts/setup.sh restart`);
  check(r1.ok && /restarted/.test(r1.out), 'setup.sh restart restarts the service', r1.out);
  const count = 'find ~/Gubernos -type f | wc -l', before = ssh(count).out;
  const up = ssh(`${PATHS}; GUBERNOS_BRANCH=${BRANCH} ~/.gubernos/app/scripts/update.sh`, 300000); // the branch under test, not main
  check(up.ok, 'an update runs', up.out.slice(-400));
  check(ssh(count).out === before, `an update leaves the files alone (${before.trim()})`, ssh(count).out);
  check(!!await until(answers, 60000, 2000), 'the app answers after the update');
  tunnel.kill(); await page.close(); page = null;
  spawnSync('ssh', [...SSH(), 'sudo -n reboot || echo admin | sudo -S reboot'], { timeout: 20000 });
  await sleep(20000);
  check(!!await until(answers, 300000, 5000), 'after a reboot the app is back by itself (nobody logged in)');
  check(ssh('systemctl --user is-active gubernos-awake.service').out === 'active', 'and the keep-awake service is back too', ssh('systemctl --user status gubernos-awake.service --no-pager | tail -3').out);

  if (TESTS) { // the whole suite on this machine: Chromium (Playwright's build, it has one for Linux on ARM) for the page tests
    const t3 = Date.now();
    const ch = ssh(`${PATHS}; cd ~/.gubernos/app && (echo admin | sudo -S true) 2>/dev/null; npx -y playwright@1.49.1 install --with-deps chromium >/tmp/pw.log 2>&1; find ~/.cache/ms-playwright -path '*chrome-linux/chrome' -type f | head -1`, 900000);
    const chrome = ch.out.split('\n').pop();
    if (check(/chrome$/.test(chrome), `Chromium for the page tests, in ${seconds(t3)}`, ssh('tail -15 /tmp/pw.log').out)) {
      const tt = ssh(`${PATHS}; cd ~/.gubernos/app && GUBERNOS_CHROME=${chrome} npm test 2>&1 | tail -40`, 1200000);
      fs.writeFileSync(path.join(OUT, 'npm-test.txt'), tt.out);
      const pass = tt.out.match(/(?:ℹ|#) pass (\d+)/)?.[1], fail = tt.out.match(/(?:ℹ|#) fail (\d+)/)?.[1]; // no terminal there: the TAP report
      check(fail === '0' && Number(pass) > 0, `npm test on Linux: ${pass ?? '?'} passed, ${fail ?? '?'} failed`, tt.out.split('\n').filter((l) => /✖|Error|not ok/.test(l)).slice(0, 12).join('\n'));
    }
  }
}

try { await run(); } catch (e) { check(false, 'the run finished', e.message); }
try { await page?.close(); } catch { /* gone */ }
tunnel?.kill();
fs.writeFileSync(path.join(OUT, 'report.txt'), `${report.join('\n')}\n`);
if (KEEP || failed) say(`the VM is left running: ${VM} (${ip})`);
else { tart('stop', VM); tart('delete', VM); }
console.log(`${failed ? `✗ ${failed} failed` : '✓ all good'} · ${OUT}`);
process.exit(failed ? 1 : 0);
