// The first-run page on a fresh "Mac" (a fake home, nothing started): filled in a real browser, it installs the vault and the
// config and hands over to the app. It runs installers, so another site must not be able to drive it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './helpers.js';
import { openPage } from './chrome.js';

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
let child, page, d, home, base, link;
before(async () => {
  d = fs.mkdtempSync(path.join(os.tmpdir(), 'gubernos-first-'));
  home = path.join(d, 'home'); fs.mkdirSync(home);
  // a copy of the app, so npm ci and setup touch nothing here
  const app = path.join(d, 'app');
  fs.cpSync(ROOT, app, { recursive: true, filter: (f) => !/\/(node_modules|data|\.git|\.venv|\.runs)(\/|$)|server\.log$/.test(f.slice(ROOT.length)) });
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(app, 'scripts/first-run.mjs'), '--port', String(port), '--no-open'], {
    env: { ...process.env, HOME: home, PATH: '/usr/bin:/bin', GUBERNOS_NO_LAUNCHD: '1', GUBERNOS_LAUNCH_AGENTS: path.join(d, 'agents'), GUBERNOS_FIRST_RUN_ARGS: '--no-launchd' }, stdio: ['ignore', 'pipe', 'pipe'] });
  process.once('exit', () => child.kill('SIGKILL'));
  link = await new Promise((resolve, reject) => { let o = ''; child.stdout.on('data', (x) => { o += x; const m = o.match(/first run: (\S+)/); if (m) resolve(m[1]); }); child.once('exit', () => reject(new Error('first-run exited'))); setTimeout(() => reject(new Error('no link')), 8000); });
  page = await openPage();
}, { timeout: 60000 });
after(async () => { child?.kill(); try { await page?.close(); } finally { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } });

test('the page\'s link is kept for this user only, while it runs', () => {
  const f = path.join(home, '.gubernos/first-run-link');
  assert.equal(fs.readFileSync(f, 'utf8'), link);
  assert.equal(fs.statSync(f).mode & 0o777, 0o600);
});

test('without its code, or under another host name, it refuses', async () => {
  assert.equal((await fetch(`${base}/`)).status, 403);
  assert.equal((await fetch(`${base}/install`, { method: 'POST', body: '{}' })).status, 403);
  const rebind = await new Promise((resolve) => { const s = net.connect(Number(new URL(base).port), '127.0.0.1', () => { s.write(`GET ${new URL(link).pathname}${new URL(link).search} HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n`); }); let o = ''; s.on('data', (x) => { o += x; }).on('end', () => resolve(o)); });
  assert.match(rebind, /^HTTP\/1\.1 403/);
});

test('filled in the browser, it sets everything up and hands over to the interview', { timeout: 120000 }, async () => {
  await page.goto(link);
  assert.ok(await page.waitFor('document.querySelector("input[name=folder]")'), `no form: ${page.errors.join(' | ')}`);
  assert.match(await page.eval('document.querySelector("#models").innerText'), /Get it and sign in/); // no model on this "Mac"
  // nobody fills all this in to learn afterwards that a free plan won't do: it's above the form, and on screen
  assert.match(await page.eval('document.querySelector("#need").innerText'), /paid AI subscription[\s\S]*Free plans aren’t supported/);
  assert.ok(await page.eval('document.querySelector("#need").getBoundingClientRect().bottom <= innerHeight && document.querySelector("#need").getBoundingClientRect().top < document.querySelector("#name").getBoundingClientRect().top'), 'the requirement is below the form or off screen');
  assert.ok(!/Gemini/.test(await page.eval('document.body.innerText')));
  assert.equal(await page.eval('document.querySelectorAll("input[name=folder]").length'), 1); // no iCloud here: only the Mac
  await page.eval('document.querySelector("#name").value = "Sam"; document.querySelector("#language").value = "Dutch"; document.querySelector("#go").click()');
  // the page moves to the app (not running in this test: --no-launchd), so look at what's on disk
  const cfg = path.join(home, '.config/gubernos/config.json');
  for (let i = 0; i < 900 && !(fs.existsSync(cfg) && (await page.eval('location.href').catch(() => '')).includes('#/onboard')); i++) await page.sleep(100);
  assert.ok(fs.existsSync(cfg), `no config: ${await page.eval('document.querySelector("#status")?.innerText + document.querySelector("#log")?.innerText').catch(() => '')}`);
  const vault = JSON.parse(fs.readFileSync(cfg, 'utf8')).vault;
  assert.equal(fs.realpathSync(vault), fs.realpathSync(path.join(home, 'Gubernos')));
  const profile = fs.readFileSync(path.join(vault, 'profile.md'), 'utf8');
  assert.match(profile, /Sam/); assert.match(profile, /Dutch/);
  assert.match(await page.eval('location.href'), /:4747\/#\/onboard$/);
});

test('giving up on signing in reads as words, not the model tool\'s output', { timeout: 60000 }, async () => {
  const dd = fs.mkdtempSync(path.join(os.tmpdir(), 'gubernos-first-'));
  const h = path.join(dd, 'home'), bin = path.join(dd, 'bin');
  fs.mkdirSync(h); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh
case "$*" in
  "auth status --json") echo '{"loggedIn":false}'; exit 1;;
  "auth login") echo "If the browser didn't open, visit: https://example.com/oauth"; echo "Paste code here if prompted >"; exit 1;;
esac
`, { mode: 0o755 });
  const port = await freePort();
  const c = spawn(process.execPath, [path.join(ROOT, 'scripts/first-run.mjs'), '--port', String(port), '--no-open'], { env: { ...process.env, HOME: h, PATH: `${bin}:/usr/bin:/bin` }, stdio: ['ignore', 'pipe', 'ignore'] });
  const p = await openPage();
  try {
    const l = await new Promise((resolve, reject) => { let o = ''; c.stdout.on('data', (x) => { o += x; const m = o.match(/first run: (\S+)/); if (m) resolve(m[1]); }); c.once('exit', () => reject(new Error('it stopped'))); });
    await p.goto(l);
    assert.ok(await p.waitFor('document.querySelector("[data-model=claude]")', 20000));
    await p.eval('document.querySelector("[data-model=claude]").click()');
    assert.ok(await p.waitFor('document.querySelector("#status").className === "err"', 15000));
    const seen = await p.eval('document.querySelector("#status").innerText + "|" + (document.querySelector("#log").hidden ? "" : document.querySelector("#log").innerText)');
    assert.match(seen, /finish signing in/i);
    assert.ok(!/Paste code|oauth/.test(seen), seen);
    assert.ok(await p.eval('!document.querySelector("#go").disabled'), 'the page is stuck');
  } finally { c.kill(); await p.close(); fs.rmSync(dd, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
});

test('the sign-in page got lost: nobody is stuck, they can start again', { timeout: 60000 }, async () => {
  const dd = fs.mkdtempSync(path.join(os.tmpdir(), 'gubernos-first-'));
  const h = path.join(dd, 'home'), bin = path.join(dd, 'bin'), logins = path.join(dd, 'logins');
  fs.mkdirSync(h); fs.mkdirSync(bin);
  // like the real one: it waits for the browser for ever
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh
case "$*" in
  "auth status --json") echo '{"loggedIn":false}'; exit 1;;
  "auth login") echo x >> ${JSON.stringify(logins)}; exec sleep 300;;
esac
`, { mode: 0o755 });
  const port = await freePort();
  const c = spawn(process.execPath, [path.join(ROOT, 'scripts/first-run.mjs'), '--port', String(port), '--no-open'], { env: { ...process.env, HOME: h, PATH: `${bin}:/usr/bin:/bin` }, stdio: ['ignore', 'pipe', 'ignore'] });
  const p = await openPage();
  try {
    const l = await new Promise((resolve, reject) => { let o = ''; c.stdout.on('data', (x) => { o += x; const m = o.match(/first run: (\S+)/); if (m) resolve(m[1]); }); c.once('exit', () => reject(new Error('it stopped'))); });
    await p.goto(l);
    assert.ok(await p.waitFor('document.querySelector("[data-model=claude]")', 20000));
    assert.ok(await p.eval('document.querySelector("#lost").hidden'), 'offered before any sign-in');
    await p.eval('document.querySelector("[data-model=claude]").click()');
    assert.ok(await p.waitFor('!document.querySelector("#lost").hidden && !document.querySelector("#cancel").disabled', 10000), 'no way out of a lost sign-in');
    await p.sleep(300);
    assert.ok(await p.eval('(() => { const r = document.querySelector("#cancel").getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()'), 'the way out is below the screen');
    assert.ok(await p.eval('document.querySelector("#go").disabled'));
    await p.eval('document.querySelector("#cancel").click()');
    assert.ok(await p.waitFor('document.querySelector("#status").className === "err" && !document.querySelector("#go").disabled && document.querySelector("#lost").hidden', 10000), await p.eval('document.querySelector("#status").innerText'));
    assert.match(await p.eval('document.querySelector("#status").innerText'), /finish signing in/i);
    // and again: a new sign-in starts
    await p.eval('document.querySelector("[data-model=claude]").click()');
    assert.ok(await p.waitFor('!document.querySelector("#lost").hidden', 10000));
    for (let i = 0; i < 50 && fs.readFileSync(logins, 'utf8').trim().split('\n').length < 2; i++) await p.sleep(100);
    assert.equal(fs.readFileSync(logins, 'utf8').trim().split('\n').length, 2);
    await p.eval('document.querySelector("#cancel").click()');
  } finally { c.kill(); await p.close(); fs.rmSync(dd, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
});

test('a page left open after its setup stopped says what to do, not "Failed to fetch"', { timeout: 30000 }, async () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/first-run.html'), 'utf8').replace('__CODE__', 'x');
  const p = await openPage();
  try {
    const port = await freePort(); // nothing listens here: the setup is gone
    const srv = (await import('node:http')).createServer((_, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(html)).listen(port, '127.0.0.1');
    await new Promise((r) => srv.once('listening', r));
    await p.goto(`http://127.0.0.1:${port}/`);
    await p.waitFor('document.querySelector("#go")');
    srv.closeAllConnections(); await new Promise((r) => srv.close(r));
    await p.eval('document.querySelector("#name").value = "Sam"; document.querySelector("#status").textContent = ""; refresh().catch((e) => { document.querySelector("#status").textContent = e.message; })');
    assert.ok(await p.waitFor('document.querySelector("#status").textContent.includes("open Gubernos again")'), await p.eval('document.querySelector("#status").textContent'));
  } finally { await p.close(); }
});
