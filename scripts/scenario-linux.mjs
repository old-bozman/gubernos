#!/usr/bin/env node
// The whole start on Linux as a video: a clean Ubuntu (tart VM, no screen), the one-line install in a terminal, the setup page,
// signing in to the AI (the owner does that once, in their own browser: the page opens there by itself), the first interview
// with a persona answering, tasks brought in from another app's export, Today. The terminal on the left, the page on the
// right, a caption saying the step; waits for the model play faster. Windows people go the same way inside WSL.
//   node scripts/scenario-linux.mjs [--model claude|codex] [--persona solo|family|pro|sam] [--branch main] [--keep]
// Spends a little of the owner's model plan. The video and screenshots go to the printed folder; a copy of the video to
// ~/Movies/Gubernos/. Exit 1 if a step failed.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openPage } from '../tests/chrome.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const arg = (name, d) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : d; };
const MODEL = arg('--model', 'claude'), BRANCH = arg('--branch', 'main'), KEEP = process.argv.includes('--keep');
const P = JSON.parse(fs.readFileSync(path.join(ROOT, `tests/fixtures/personas/${arg('--persona', 'solo')}.json`), 'utf8'));
const NAME = P.who.split(',')[0];
const TART = [path.join(os.homedir(), '.local/bin/tart'), '/opt/homebrew/bin/tart'].find((f) => fs.existsSync(f)) || 'tart';
const VM = 'gubernos-linux', BASE = 'ghcr.io/cirruslabs/ubuntu:latest';
const SETUP_PORT = 4746, APP_PORT = 4747, HOST_APP = 4847;
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'gubernos-scenario-'));
const W = 820, H = 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms, every = 1000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await sleep(every); } };
let failed = 0, ip, tunnel, page, term, n = 0;
const say = (l) => { console.log(l); fs.appendFileSync(path.join(OUT, 'report.txt'), `${l}\n`); };
const check = (ok, text, detail = '') => { if (!ok) failed++; say(`${ok ? '✓' : '✗'} ${text}${!ok && detail ? `\n  ${String(detail).slice(0, 600)}` : ''}`); return ok; };
const tart = (...a) => spawnSync(TART, a, { encoding: 'utf8' });
const key = path.join(OUT, 'key');
const SSH = () => ['-i', key, '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'LogLevel=ERROR', '-o', 'ConnectTimeout=5', `admin@${ip}`];
const ssh = (cmd, ms = 120000) => { const r = spawnSync('ssh', [...SSH(), cmd], { encoding: 'utf8', timeout: ms }); return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim() }; };
const shot = async (name) => { n++; await page.screenshot(path.join(OUT, `${String(n).padStart(2, '0')}-${name}.png`)); };

// ---------- the left half: a terminal on the VM, and the step's caption ----------
const TERM = `<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; background: #1e1f22; color: #d7d7d7; font: 13.5px/1.45 ui-monospace, Menlo, monospace; height: 100vh; display: flex; flex-direction: column; }
  #cap { background: #f4f1ec; color: #202020; font: 600 19px/1.35 -apple-system, sans-serif; padding: 16px 20px; border-bottom: 3px solid #dc4c3e; }
  #cap small { display: block; font-weight: 400; font-size: 14px; color: #555; margin-top: 3px; }
  #bar { color: #8b8b8b; font: 12px -apple-system, sans-serif; padding: 6px 12px; background: #2b2d31; }
  pre { margin: 0; padding: 12px 14px; white-space: pre-wrap; word-break: break-all; flex: 1; overflow: hidden; display: flex; flex-direction: column; justify-content: flex-end; }
  .p { color: #7ec699; } .c { color: #fff; }
</style><div id="cap"></div><div id="bar">admin@ubuntu — Terminal</div><pre id="t"></pre>
<script>window.set = (cap, sub, lines) => { document.getElementById('cap').innerHTML = cap + (sub ? '<small>' + sub + '</small>' : ''); document.getElementById('t').innerHTML = lines; };</script>`;
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const screen = { cap: '', sub: '', lines: [] };
const typed = (cmd) => `<span class="p">admin@ubuntu:~$</span> <span class="c">${esc(cmd)}</span>`;
async function paint() { try { await term?.eval(`set(${JSON.stringify(screen.cap)}, ${JSON.stringify(screen.sub)}, ${JSON.stringify(screen.lines.slice(-48).join('\n'))})`); } catch { /* next time */ } }
const caption = async (cap, sub = '') => { Object.assign(screen, { cap, sub }); say(`— ${cap}`); await paint(); };
const command = async (cmd) => { screen.lines.push(typed(cmd)); await paint(); };
const output = async (text) => { screen.lines.push(...String(text).split('\n').map(esc)); await paint(); };

// ---------- the video: a frame a second of both halves; while the model thinks, a frame every 4 s (it plays faster) ----------
const rec = { on: false, frames: 0, slow: false, dir: path.join(OUT, 'video') };
async function record() {
  for (const d of ['term', 'page']) fs.mkdirSync(path.join(rec.dir, d), { recursive: true });
  rec.on = true;
  rec.done = (async () => {
    while (rec.on) {
      const t = Date.now(), f = `${String(rec.frames).padStart(5, '0')}.png`;
      try { await term.screenshot(path.join(rec.dir, 'term', f)); } catch { /* filled from the frame before */ }
      try { await page.screenshot(path.join(rec.dir, 'page', f)); } catch { /* between screens */ }
      rec.frames++;
      const gap = rec.slow ? 4000 : 1000;
      while (rec.on && Date.now() - t < gap) await sleep(100);
    }
  })();
}
async function encode() {
  rec.on = false; await rec.done;
  if (!rec.frames) return;
  const blank = path.join(rec.dir, 'blank.png');
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=white:s=${W}x${H}`, '-frames:v', '1', blank]);
  for (const d of ['term', 'page']) { let last = blank; for (let i = 0; i < rec.frames; i++) { const f = path.join(rec.dir, d, `${String(i).padStart(5, '0')}.png`); if (fs.existsSync(f)) last = f; else fs.copyFileSync(last, f); } }
  const out = path.join(OUT, 'video.mp4');
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '1', '-i', path.join(rec.dir, 'term/%05d.png'), '-framerate', '1', '-i', path.join(rec.dir, 'page/%05d.png'),
    '-filter_complex', `[0]scale=-2:${H}[a];[1]scale=-2:${H}[b];[a][b]hstack,fps=30`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', out], { encoding: 'utf8' });
  if (r.status !== 0) return say(`  (the video didn't encode: ${r.stderr.slice(0, 300)})`);
  const keep = path.join(os.homedir(), 'Movies/Gubernos', `${new Date().toISOString().slice(0, 10)}-linux-${MODEL}.mp4`);
  fs.mkdirSync(path.dirname(keep), { recursive: true }); fs.copyFileSync(out, keep);
  say(`  video: ${keep} (${Math.round(rec.frames / 60)} min)`);
}

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

const onboard = async () => (await fetch(`http://127.0.0.1:${HOST_APP}/api/onboard`)).json();
const pageText = (sel) => page.eval(`document.querySelector(${JSON.stringify(sel)})?.innerText || ""`).catch(() => '');

async function run() {
  await bootVm();
  term = await openPage(); await term.resize(W, H); await term.goto(`data:text/html;base64,${Buffer.from(TERM).toString('base64')}`);
  page = await openPage(); await page.resize(W, H);
  await page.goto(`data:text/html;base64,${Buffer.from('<body style="margin:0;background:#fff"></body>').toString('base64')}`);
  await record();

  // 1. one line in a terminal
  await caption('1. Install: one line in a terminal', 'Ubuntu 24.04 with nothing on it; on Windows the same, inside WSL');
  const line = `curl -fsSL https://raw.githubusercontent.com/old-bozman/gubernos/${BRANCH}/install.sh | bash -s -- --wizard`;
  await command(line);
  ssh(`nohup bash -c 'curl -fsSL https://raw.githubusercontent.com/old-bozman/gubernos/${BRANCH}/install.sh | GUBERNOS_BRANCH=${BRANCH} bash -s -- --wizard' > ~/install.log 2>&1 &`, 20000);
  let shown = 0;
  const link = await until(async () => {
    const log = ssh('cat ~/install.log 2>/dev/null').out.split('\n').filter((l) => !/locale|LC_ALL|LANGUAGE|LANG =|are supported and installed/.test(l));
    if (log.length > shown) { await output(log.slice(shown).join('\n')); shown = log.length; }
    const r = ssh('cat ~/.gubernos/first-run-link 2>/dev/null');
    return r.ok && r.out.startsWith('http') ? r.out : null;
  }, 600000, 2000);
  if (!check(!!link, 'the installer prints the setup link')) throw new Error('no setup page');
  tunnel = spawn('ssh', [...SSH().slice(0, -1), '-N', '-L', `${SETUP_PORT}:127.0.0.1:${SETUP_PORT}`, '-L', `${HOST_APP}:127.0.0.1:${APP_PORT}`, `admin@${ip}`], { stdio: 'ignore' });
  await sleep(2000);

  // 2. the setup page, and the AI
  await caption('2. The setup page', 'opened from the link: your name, where your files live, keep the computer awake');
  await page.goto(link);
  check(await page.waitFor('document.querySelector("input[name=folder]")', 20000), 'the setup page shows', page.errors.join(' | '));
  await page.eval(`document.querySelector("#name").value = ${JSON.stringify(NAME)}`);
  await sleep(2500); await shot('setup');
  await caption(`3. Sign in to ${MODEL === 'codex' ? 'ChatGPT' : 'Claude'}`, MODEL === 'codex' ? 'no browser on this machine: the page gives a link and a one-time code' : 'no browser on this machine: the page gives the link, and takes the code Claude shows at the end');
  await page.eval(`document.querySelector("[data-model=${MODEL}]").click()`);
  check(await page.waitFor('!document.querySelector("#signin").hidden', 240000), 'the page shows how to sign in', await pageText('#status'));
  await sleep(1500); await shot('sign-in');
  say(`  SIGN-IN: the setup page is open in your browser; finish signing in there (${link})`);
  fs.writeFileSync(path.join(OUT, 'SIGN-IN'), link);
  spawnSync('open', [link]);
  rec.slow = true;
  const ready = await page.waitFor('/Ready/.test(document.querySelector("#models").innerText)', 15 * 60000);
  rec.slow = false;
  if (!check(ready, `signed in to ${MODEL}`, await pageText('#status'))) throw new Error('not signed in');
  await sleep(1500); await shot('signed-in');
  await page.eval(`(() => {
    const f = window.fetch;
    window.fetch = async (...a) => { const r = await f(...a); if (String(a[0]) !== '/job') return r; const j = await r.clone().json(); if (!j.next) return r;
      j.next = j.next.replace(':${APP_PORT}', ':${HOST_APP}'); return new Response(JSON.stringify(j), { status: r.status, headers: { 'content-type': 'application/json' } }); };
    document.querySelector("#go").scrollIntoView({ block: "center" });
  })()`);
  await sleep(1500);
  await page.eval('document.querySelector("#go").click()');
  const went = await until(async () => (await page.eval('location.href').catch(() => '')).includes('#/onboard'), 480000, 1000);
  if (!check(!!went, 'it sets up and hands over to the interview')) throw new Error('setup failed');
  await command('systemctl --user status gubernos --no-pager | head -3');
  await output(ssh('systemctl --user status gubernos --no-pager | head -3').out);

  // 4. the interview
  await caption('4. The first interview, about 10 minutes', `${P.who}, talking (typed here; the mic works the same)`);
  await page.waitFor('document.querySelector(".ob-intro")', 20000); await sleep(4000); await shot('interview');
  let cur = await onboard(), msg = P.talk, follow = 0;
  for (let i = 0; i < 7 && !cur.finished; i++) {
    const before = cur.turns.length;
    await page.eval(`(() => { const m = document.querySelector("#ob-msg"); m.value = ${JSON.stringify(msg)}; m.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await sleep(2500);
    await page.eval('document.querySelector("[data-act=onboard-send]").click()');
    rec.slow = true;
    for (let w = 0; w < 600 && cur.turns.length <= before; w++) { await sleep(1000); cur = await onboard().catch(() => cur); if (await pageText('.onboard .d-over')) break; }
    rec.slow = false;
    if (!check(cur.turns.length > before, `turn ${i + 1} answered`, await pageText('.onboard .d-over'))) break;
    await page.eval('document.querySelector(".ob-agent:last-of-type")?.scrollIntoView({ block: "start" })').catch(() => {});
    const reply = cur.turns.at(-1).text;
    await sleep(Math.min(12000, 3000 + reply.split(/\s+/).length * 120)); // time to read it
    await shot(`turn-${i + 1}`);
    msg = /important now/i.test(reply) ? P.now : /number one thing|\bhabit\b/i.test(reply) && /\?/.test(reply) ? P.habit : ['That’s about it.', 'Nothing else for now.'][Math.min(follow++, 1)];
  }
  fs.writeFileSync(path.join(OUT, 'conversation.md'), cur.turns.map((t) => `**${t.from === 'you' ? 'You' : 'Gubernos'}:** ${t.text}\n`).join('\n'));
  check(cur.finished, 'the interview ends by itself');
  await sleep(4000); await shot('interview-done');

  // 5. tasks from the old app
  await caption('5. Bring your tasks from another app', 'Settings → General → Import tasks: here a TickTick export; Todoist, Things and Reminders work too');
  await page.goto(`http://127.0.0.1:${HOST_APP}/#/settings`);
  await page.waitFor('!!document.querySelector("[data-act=set-import]")', 15000);
  await page.eval('document.querySelector("[data-act=set-import]").scrollIntoView({ block: "center" })'); await sleep(2500);
  await page.eval('document.querySelector("[data-act=set-import]").click()');
  await page.waitFor('!!document.querySelector(".imp [data-src=file]")'); await sleep(2000);
  await page.eval('document.querySelector(".imp [data-src=file]").click()'); await sleep(1500);
  const csv = fs.readFileSync(path.join(ROOT, 'tests/fixtures/import/ticktick-julia.csv'), 'utf8');
  await page.eval(`document.querySelector("#imp-text").value = ${JSON.stringify(csv)}`); await sleep(2500);
  await page.eval('document.querySelector("#imp-read").click()');
  rec.slow = true;
  const lists = await page.waitFor('document.querySelectorAll(".imp-l").length > 0 || !document.querySelector(".imp")', 300000);
  rec.slow = false;
  check(lists && await page.eval('document.querySelectorAll(".imp-l").length > 0'), 'the export is read into lists', await pageText('.imp'));
  await sleep(6000); await shot('import-lists');
  const note = await pageText('.imp .imp-note');
  check(/done left out/.test(note), 'done tasks stay out', note);
  await page.eval('document.querySelector("#imp-apply").click()');
  check(await page.waitFor('!document.querySelector(".imp")', 20000), 'imported');
  await sleep(2500);

  // 6. the day
  await caption('6. Today', 'the #1 from the interview on top; the imported tasks in their projects');
  await page.goto(`http://127.0.0.1:${HOST_APP}/#/today`);
  await page.waitFor('document.querySelector("#main")?.innerText.trim().length > 0', 15000); await sleep(5000); await shot('today');
  await page.eval('document.querySelector("[data-act=top-menu][data-m=projects]")?.click()').catch(() => {});
  await sleep(4000); await shot('projects');
  await command('ls ~/Gubernos'); await output(ssh('ls ~/Gubernos').out);
  await command('ls ~/Gubernos/10_tasks | wc -l'); await output(ssh('ls ~/Gubernos/10_tasks | wc -l').out);
  await caption('That’s it', 'one line to install, a sign-in, ten minutes of talk, your old tasks brought over');
  await sleep(5000);
  check(!page.errors.filter((e) => !/favicon|:4746/.test(e)).length, 'no errors in the pages', page.errors.join(' | '));
}

try { await run(); } catch (e) { check(false, 'the run finished', e.stack); }
finally {
  await encode().catch((e) => say(`  (no video: ${e.message})`));
  try { await page?.close(); await term?.close(); } catch { /* gone */ }
  tunnel?.kill();
  if (KEEP) say(`  the VM is left running: ${VM} (${ip})`); else { tart('stop', VM); tart('delete', VM); }
  say(failed ? `✗ ${failed} failed · ${OUT}` : `✓ all good · ${OUT}`);
  process.exit(failed ? 1 : 0);
}
