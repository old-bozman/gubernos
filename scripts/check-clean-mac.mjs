#!/usr/bin/env node
// The whole no-Terminal setup on a truly clean Mac, with nobody at the keyboard: a new VM from Apple's vanilla image (tart), the
// real Gubernos.dmg, the launcher, the setup page, the app, a second launch, an update and a restart. Screenshots of the VM's real
// screen (dialogs included) and of the pages go to the printed folder. Exit 1 if a check failed.
//   node scripts/check-clean-mac.mjs [--dmg dist/Gubernos.dmg] [--keep] [--sign-in] [--model claude|codex] [--video]
//   --keep leaves the VM running · --model: the AI the person picks (default claude; codex = ChatGPT) · --video: the VM's
//   screen and the setup page side by side, a frame a second, as video.mp4 in the printed folder
// It fetches the app from `main`, as people do: release first. Signing in to a model stops at the sign-in page (the owner's
// account); with --sign-in it opens the VM's screen on this Mac, waits for the owner to sign in there, then goes on with a real
// model: the interview must take an answer and reply. The VM goes when the run passes, and the sign-in with it. Gatekeeper's assessments are off in this image, so its verdict on the signature and notarization is checked on
// this Mac; macOS's "downloaded from the Internet" question still appears in the VM, on its real screen, and gets answered there.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from '../tests/helpers.js';
import { openPage } from '../tests/chrome.js';
import { connect } from '../tests/vnc.js';

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const KEEP = process.argv.includes('--keep'), SIGN_IN = process.argv.includes('--sign-in'), VIDEO = process.argv.includes('--video');
const MODEL = arg('--model') || 'claude';
if (!['claude', 'codex'].includes(MODEL)) { console.error('--model claude or codex'); process.exit(2); }
const NAME = { claude: 'Claude', codex: 'ChatGPT' }[MODEL], LOGIN = { claude: 'claude auth login', codex: 'codex login' }[MODEL];
const DMG = path.resolve(arg('--dmg') || path.join(ROOT, 'dist/Gubernos.dmg'));
const TART = [path.join(os.homedir(), '.local/bin/tart'), '/opt/homebrew/bin/tart'].find((f) => fs.existsSync(f)) || 'tart';
const VM = 'gubernos-check', BASE = 'ghcr.io/cirruslabs/macos-tahoe-vanilla:latest';
const SETUP_PORT = 4746, APP_PORT = 4747, HOST_APP_PORT = 4947; // this Mac's own Gubernos may be on 4747
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'gubernos-cleanmac-'));
const LINK = '~/.gubernos/first-run-link';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = [];
let failed = 0, n = 0, vm, vnc, vncUrl, tunnel, page;
const say = (l) => { console.log(l); report.push(l); };
const check = (ok, text, detail = '') => { if (!ok) failed++; say(`${ok ? '✓' : '✗'} ${text}${!ok && detail ? `\n  ${String(detail).slice(0, 800)}` : ''}`); return ok; };
const tart = (...a) => spawnSync(TART, a, { encoding: 'utf8' });
const until = async (fn, ms, every = 1000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await sleep(every); } };
const seconds = (t) => `${Math.round((Date.now() - t) / 1000)} s`;

const key = path.join(OUT, 'key');
let ip;
const SSH = () => ['-i', key, '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'LogLevel=ERROR', '-o', 'ConnectTimeout=5', `admin@${ip}`];
const ssh = (cmd, ms = 60000) => { const r = spawnSync('ssh', [...SSH(), cmd], { encoding: 'utf8', timeout: ms }); return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim() }; };
const screen = async (name) => { n++; try { await vnc?.screenshot(path.join(OUT, `${String(n).padStart(2, '0')}-vm-${name}.png`)); } catch (e) { say(`  (no VM screenshot: ${e.message})`); } };
const shot = async (name) => { n++; await page.screenshot(path.join(OUT, `${String(n).padStart(2, '0')}-page-${name}.png`)); };

// --video: a frame a second of the VM's screen (its own VNC connection) and of the page this script drives, then side by side
let rec = null;
async function startRecording() {
  if (!VIDEO || rec) return;
  const dir = path.join(OUT, 'video');
  for (const d of ['vm', 'page']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  let eye = null;
  try { eye = await connect(vncUrl); } catch (e) { say(`  (no video: ${e.message})`); return; }
  rec = { on: true, frames: 0, t0: Date.now(), dir };
  rec.done = (async () => {
    while (rec.on) {
      const t = Date.now(), f = `${String(rec.frames).padStart(5, '0')}.png`;
      try { await eye.screenshot(path.join(dir, 'vm', f)); } catch { /* a dropped frame is filled from the one before */ }
      try { if (page) await page.screenshot(path.join(dir, 'page', f)); } catch { /* the page is between screens */ }
      rec.frames++;
      await sleep(Math.max(0, 1000 - (Date.now() - t)));
    }
    eye.close();
  })();
}
async function stopRecording() {
  if (!rec) return;
  rec.on = false; await rec.done;
  const { dir, frames } = rec, secs = (Date.now() - rec.t0) / 1000;
  rec = null;
  if (!frames) return;
  const blank = path.join(dir, 'blank.png');
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=900x1100', '-frames:v', '1', blank]);
  for (const d of ['vm', 'page']) { // every frame number on both sides: a missing one is the one before
    let last = blank;
    for (let i = 0; i < frames; i++) { const f = path.join(dir, d, `${String(i).padStart(5, '0')}.png`); if (fs.existsSync(f)) last = f; else fs.copyFileSync(last, f); }
  }
  const fps = String(Math.max(0.2, frames / secs).toFixed(3)), out = path.join(OUT, 'video.mp4');
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', fps, '-i', path.join(dir, 'vm/%05d.png'), '-framerate', fps, '-i', path.join(dir, 'page/%05d.png'),
    '-filter_complex', '[0]scale=-2:900[a];[1]scale=-2:900[b];[a][b]hstack', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', out], { encoding: 'utf8' });
  say(r.status === 0 ? `  video: ${out} (${Math.round(secs / 60)} min)` : `  (the video didn't encode: ${r.stderr.slice(0, 300)})`);
}

async function bootVm() {
  if (tart('list').stdout.includes(VM)) { tart('stop', VM); tart('delete', VM); }
  const c = tart('clone', BASE, VM);
  if (c.status !== 0) throw new Error(`clone: ${c.stderr}`);
  const log = path.join(OUT, 'vm.log');
  vm = spawn(TART, ['run', '--no-graphics', '--vnc-experimental', VM], { stdio: ['ignore', fs.openSync(log, 'a'), fs.openSync(log, 'a')], detached: true });
  vm.unref();
  const url = await until(() => fs.readFileSync(log, 'utf8').match(/vnc:\/\/\S+/)?.[0], 60000);
  if (!url) throw new Error('the VM gave no screen address');
  ip = tart('ip', VM, '--wait', '120').stdout.trim();
  if (!ip) throw new Error('the VM got no address');
  vncUrl = url;
  vnc = await connect(url);
  await startRecording();
  // a key of this run only; the image's public default password is used once, to put it there
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key]);
  const pub = fs.readFileSync(`${key}.pub`, 'utf8').trim();
  const exp = `set timeout 20\nspawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR admin@${ip} "mkdir -p ~/.ssh && echo '${pub}' >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"\nexpect "assword:" { send "admin\\r" }\nexpect eof\n`;
  const keyed = await until(() => { spawnSync('expect', ['-c', exp], { timeout: 30000 }); return ssh('true').ok; }, 180000, 3000);
  if (!keyed) throw new Error('no SSH into the VM');
  // the desktop is really there (auto-login)
  if (!await until(() => ssh('pgrep -x Dock').ok, 180000, 2000)) throw new Error('no desktop in the VM');
  await sleep(8000);
}

async function run() {
  // the DMG itself, on this Mac: what Gatekeeper will say to people
  check(fs.existsSync(DMG), `the DMG is there (${path.relative(ROOT, DMG)})`);
  const q = (cmd, ...a) => { const r = spawnSync(cmd, a, { encoding: 'utf8' }); return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` }; };
  const stapled = q('xcrun', 'stapler', 'validate', DMG);
  check(stapled.ok, 'the DMG has its notarization ticket', stapled.out);
  const gk = q('spctl', '-a', '-t', 'open', '--context', 'context:primary-signature', '-v', DMG);
  check(gk.ok && /accepted/.test(gk.out) && /Notarized Developer ID/.test(gk.out), 'Gatekeeper accepts the DMG', gk.out);
  const mnt = fs.mkdtempSync(path.join(OUT, 'mnt-'));
  execFileSync('hdiutil', ['attach', '-quiet', '-nobrowse', '-readonly', '-mountpoint', mnt, DMG]);
  try {
    const app = path.join(mnt, 'Gubernos.app');
    const gka = q('spctl', '-a', '-t', 'exec', '-v', app);
    check(gka.ok && /Notarized Developer ID/.test(gka.out), 'Gatekeeper accepts the app', gka.out);
    const bundled = fs.readFileSync(path.join(app, 'Contents/Resources/install.sh'), 'utf8');
    check(bundled === fs.readFileSync(path.join(ROOT, 'install.sh'), 'utf8'), 'the DMG has the current install.sh (else: scripts/build-mac-app.sh)');
  } finally { spawnSync('hdiutil', ['detach', '-quiet', mnt]); }

  // a clean machine, and it really is clean
  const t0 = Date.now();
  await bootVm();
  say(`  the VM is up in ${seconds(t0)}`);
  await screen('desktop');
  // a VM just up can drop a connection: that says nothing about what's on it
  const look = await until(() => { const r = ssh('ls -a ~ | grep -i gubernos; ls -d ~/.config/gubernos /Applications/Gubernos.app 2>/dev/null; command -v node claude codex; ls ~/.local/bin 2>/dev/null; launchctl list | grep -i gubernos; true'); return r.ok ? r : null; }, 120000, 3000);
  if (!look) throw new Error('no SSH into the VM');
  if (!check(!look.out, 'the machine is clean', look.out)) throw new Error('not a clean machine');

  // the DMG, as downloaded
  execFileSync('scp', ['-i', key, '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'LogLevel=ERROR', DMG, `admin@${ip}:Downloads/Gubernos.dmg`]);
  ssh('xattr -w com.apple.quarantine "0081;$(printf %x $(date +%s));Safari;" ~/Downloads/Gubernos.dmg');
  // a busy VM can drop an SSH call: opening is tried again until the volume is there
  const mounted = () => ssh('test -d /Volumes/Gubernos/Gubernos.app').ok;
  let opened = false;
  for (let i = 0; i < 4 && !opened; i++) { ssh('open ~/Downloads/Gubernos.dmg'); opened = !!await until(mounted, 30000, 2000); }
  check(opened, 'the DMG opens, Gubernos.app on it');
  await sleep(4000);
  await screen('dmg-open');

  // the launcher: what a double-click does
  const t1 = Date.now();
  await vnc.doubleClick(Math.round(vnc.width * 0.143), Math.round(vnc.height * 0.208)); // the icon, in the window the DMG opens
  check(!!await until(() => ssh('pgrep -x Gubernos').ok, 30000, 1000), 'a double-click on the icon starts it');
  await sleep(6000);
  await screen('asks-downloaded-from-internet');
  // macOS's own question, before any of our code runs: Open, in the middle of the screen
  const running = () => ssh('pgrep -f "install.sh --wizard"').ok;
  let answered = false;
  for (let i = 0; i < 3 && !answered; i++) {
    await vnc.click(Math.round(vnc.width * 0.5), Math.round(vnc.height * 0.5275));
    answered = !!await until(running, 15000, 1000);
  }
  check(answered, 'after Open in macOS’s question the install starts');
  await sleep(3000);
  await screen('launcher');
  const link = await until(() => { const r = ssh(`cat ${LINK} 2>/dev/null`); return r.ok && r.out.startsWith('http') ? r.out : null; }, 420000, 3000);
  if (!link) {
    await screen('launcher-stuck');
    say(`  running: ${ssh('ps -axo pid,etime,command | grep -iE "gubernos|install.sh|node" | grep -v grep').out}`);
    check(false, 'the setup page comes up within 7 minutes');
    throw new Error('no setup page');
  }
  check(true, `the setup page comes up in ${seconds(t1)}`);
  await sleep(15000);
  await screen('setup-in-safari');

  // the page itself, through a tunnel, in a browser this script can drive (the VM's Safari shows the same page, see the screenshots)
  tunnel = spawn('ssh', ['-i', key, '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'LogLevel=ERROR', '-N', '-L', `${SETUP_PORT}:127.0.0.1:${SETUP_PORT}`, '-L', `${HOST_APP_PORT}:127.0.0.1:${APP_PORT}`, `admin@${ip}`], { stdio: 'ignore' });
  await sleep(2000);
  page = await openPage();
  await page.resize(900, 1100);
  await page.goto(link);
  check(await page.waitFor('document.querySelector("input[name=folder]")', 20000), 'the form shows', page.errors.join(' | '));
  await shot('setup');
  check(/Get it and sign in/.test(await page.eval('document.querySelector("#models").innerText')), 'it offers to get a model');
  check(/You need an AI subscription/.test(await page.eval('document.querySelector("#need").innerText')), 'it says a subscription is needed, above the form');

  // getting a model: it installs, then stops at the sign-in page, which is the person's
  const t2 = Date.now();
  await page.eval(`document.querySelector("[data-model=${MODEL}]").click()`);
  const signing = await page.waitFor('/sign in, in the browser/.test(document.querySelector("#status").innerText) || document.querySelector("#status").className === "err"', 300000);
  const status = await page.eval('document.querySelector("#status").innerText');
  check(signing && /sign in/.test(status), `${NAME} is installed and asks to sign in, in ${seconds(t2)}`, status);
  await shot('model-signin');
  await sleep(8000);
  await screen(`${MODEL}-signin-page`);
  check(ssh(`pgrep -f "${LOGIN}"`).ok, 'the sign-in is waiting for the person');
  if (SIGN_IN) {
    spawnSync('open', [`vnc://admin:admin@${ip}`]); // the VM's own Screen Sharing: with the VNC server tart starts, Apple's client got no keyboard
    say('→ SIGN IN NOW, on the VM’s screen (it just opened in Screen Sharing). Waiting up to an hour.');
    const t = Date.now();
    // the page's word, not `claude auth status` over SSH: the sign-in is in the keychain, which an SSH session can't read
    const how = await until(() => page.eval(`document.querySelector("input[name=model][value=${MODEL}]") ? "in" : document.querySelector("#status").className === "err" ? "failed" : null`), 3600000, 5000);
    await screen('after-sign-in');
    check(how === 'in', `signed in to ${NAME} in the browser, ${seconds(t)}`, how ? await page.eval('document.querySelector("#status").innerText') : 'nobody signed in within the hour');
    if (how !== 'in') throw new Error('no sign-in');
    check(await page.waitFor(`document.querySelector("input[name=model][value=${MODEL}]")`, 30000), `the page sees it by itself: ${NAME} ✓ Ready`, await page.eval('document.querySelector("#models").innerText'));
    await shot('model-ready');
  } else {
    // the sign-in page got lost: the page's own way out ends the real CLI's wait
    await page.eval('document.querySelector("#cancel").click()');
    check(await page.waitFor('!document.querySelector("#go").disabled', 30000), 'Start again ends a lost sign-in and leaves the page usable', await page.eval('document.querySelector("#status").innerText'));
    await shot('model-gave-up');
    const gaveUp = await page.eval('document.querySelector("#status").innerText + "|" + (document.querySelector("#log").hidden ? "" : document.querySelector("#log").innerText)');
    check(/finish signing in/i.test(gaveUp) && !/Paste code|oauth/.test(gaveUp), 'giving up on signing in reads as words', gaveUp);
  }

  // set up, without a model: the page hands over to the app. This Mac's own Gubernos may answer on the app's port, so the hand-over goes to the tunnel
  await page.eval(`(() => {
    const f = window.fetch;
    window.fetch = async (...a) => {
      const r = await f(...a);
      if (String(a[0]) !== '/job') return r;
      const j = await r.clone().json();
      if (!j.next) return r;
      window.__next = j.next; j.next = j.next.replace(':${APP_PORT}', ':${HOST_APP_PORT}');
      return new Response(JSON.stringify(j), { status: r.status, headers: { 'content-type': 'application/json' } });
    };
    document.querySelector("#name").value = "Sam";
    document.querySelector("#go").click();
  })()`);
  const t3 = Date.now();
  const went = await until(async () => (await page.eval('location.href').catch(() => '')).includes('#/onboard'), 480000, 1000);
  if (!check(!!went, `it sets up and hands over to the interview, in ${seconds(t3)}`, await page.eval('(document.querySelector("#status")?.innerText || "") + " " + (document.querySelector("#log")?.innerText || "")').catch(() => ''))) throw new Error('setup failed');
  check(await page.waitFor('document.querySelector(".ob-intro")?.innerText.includes("15–20 minutes") || document.querySelector(".onboard")', 30000), 'the interview screen shows', page.errors.join(' | '));
  await sleep(1500);
  await shot('interview');
  if (SIGN_IN) {
    // signed in: the app, as a service, reaches the model the person signed in to
    check(await page.waitFor('document.querySelector("#ob-msg")', 30000) && await page.eval('!document.querySelector("[data-act=onboard-connect]")'), 'signed in, the interview is ready to talk', await page.eval('document.querySelector("#main").innerText'));
    await page.eval('document.querySelector("#ob-msg").value = "I am Sam, I run a small bakery and have two kids."; document.querySelector("#ob-msg").dispatchEvent(new Event("input", { bubbles: true })); document.querySelector("[data-act=onboard-send]").click()');
    check(await page.waitFor('document.querySelector(".onboard .ob-agent:not(.ob-working)")', 240000), 'the real model replies in the interview', await page.eval('document.querySelector(".onboard").innerText'));
    say(`  it said: ${(await page.eval('document.querySelector(".onboard .ob-agent:not(.ob-working)")?.innerText || ""')).slice(0, 300)}`);
    await shot('interview-real-reply');
  } else {
    // still not signed in: nobody talks for 15 minutes to nothing, and signing in is a button
    check(await page.waitFor(`document.querySelector("[data-act=onboard-connect][data-val=${MODEL}]")`, 10000) && await page.eval('!document.querySelector("#ob-msg")'), 'not signed in, it says so before anyone talks', await page.eval('document.querySelector("#main").innerText'));
    await page.eval(`document.querySelector("[data-act=onboard-connect][data-val=${MODEL}]").click()`);
    check(!!await until(() => ssh(`pgrep -f "${LOGIN}"`).ok, 20000, 1000), 'Sign in, from the app itself, starts the sign-in');
    await sleep(8000);
    await screen('signin-from-the-app');
    await shot('interview-signing-in');
    await page.eval('document.querySelector("[data-act=onboard-cancel]").click()');
    check(await page.waitFor('/finish signing in/i.test(document.querySelector(".onboard").innerText) && !document.querySelector("[data-act=onboard-connect]").disabled', 15000), 'giving up there says so too and can be tried again', await page.eval('document.querySelector(".onboard").innerText'));
  }

  // what's on the machine now
  check(await until(() => !ssh('pgrep -x Gubernos').ok, 30000, 2000) !== null, 'the launcher window closed by itself');
  const home = ssh('ls -a ~ | grep -i gubernos').out.split('\n');
  check(home.includes('.gubernos') && home.includes('Gubernos') && !home.includes('gubernos'), 'the app is in ~/.gubernos, the files in ~/Gubernos', home.join(' '));
  check(/Sam/.test(ssh('cat ~/Gubernos/profile.md').out), 'the files are the person’s');
  check(ssh('launchctl list | grep -q gubernos').ok, 'it runs as a service');

  // Today, and the rest of the app, reached over the tunnel
  await page.goto(`http://127.0.0.1:${HOST_APP_PORT}/#/today`);
  check(await page.waitFor('document.querySelector("#main")?.innerText.trim().length > 0', 15000), 'Today opens');
  await sleep(1500);
  await shot('today');
  check(await page.waitFor('document.querySelector(".scr-intro:not(.ob-remind)")', 5000), 'Today explains itself the first time');
  check(await page.waitFor('document.querySelector(".ob-remind a[href=\\"#/onboard\\"]")', 5000), 'Today has the way back to the interview');
  const errors = page.errors.filter((e) => !/favicon|127\.0\.0\.1:4746/.test(e));
  check(!errors.length, 'no errors in the pages', errors.join(' | '));

  // the app, opened again: straight to the app
  ssh('pkill -x Safari; true');
  await sleep(2000);
  ssh('open /Volumes/Gubernos/Gubernos.app');
  await sleep(10000);
  await screen('second-launch');
  check(await until(() => !ssh('pgrep -x Gubernos').ok, 30000, 2000) !== null, 'opened again, it hands over to the browser and quits');

  // an update must leave the person's files alone
  const count = 'find ~/Gubernos -type f | wc -l';
  const before = ssh(count).out;
  const up = ssh('PATH="$HOME/.gubernos/node/bin:$HOME/.local/bin:$PATH" ~/.gubernos/app/scripts/update.sh', 300000);
  check(up.ok, 'an update runs', up.out.slice(-500));
  check(ssh(count).out === before, `an update leaves the files alone (${before.trim()})`, ssh(count).out);
  const answers = () => ssh(`curl -sf -o /dev/null http://127.0.0.1:${APP_PORT}/api/settings`).ok;
  check(!!await until(answers, 60000, 2000), 'the app answers after the update');

  // a restart: it comes back by itself (the video ends here: the restart drops the VM's screen)
  await stopRecording();
  tunnel.kill();
  await page.close(); page = null;
  spawnSync('ssh', [...SSH(), 'echo admin | sudo -S shutdown -r now'], { encoding: 'utf8', timeout: 20000 });
  await sleep(20000);
  check(!!await until(answers, 300000, 5000), 'after a restart the app is back by itself');
  await screen('after-restart');
}

let crashed = null;
try { await run(); } catch (e) { crashed = e; check(false, 'the run finished', e.message); await screen('crash'); }
await stopRecording();
try { await page?.close(); } catch { /* gone */ }
tunnel?.kill();
vnc?.close();
fs.writeFileSync(path.join(OUT, 'report.txt'), `${report.join('\n')}\n`);
if (KEEP || failed) say(`the VM is left running: ${VM} (${ip})`);
else { tart('stop', VM); tart('delete', VM); }
console.log(`${failed ? `✗ ${failed} failed` : '✓ all good'} · ${OUT}`);
process.exit(failed ? 1 : 0);
