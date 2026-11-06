#!/usr/bin/env node
// Gubernos as an installed web app in Chrome on Android, on an emulator: a throwaway server (a fresh kit vault, never the
// owner's) with pairing required; the phone reaches it as http://localhost:4747 (adb reverse onto the server's proxy port,
// so it's a device from outside, not the Mac itself). Checks: closed without the code, the pairing link opens Today,
// Chrome can install it, Settings on a phone, notifications on and a push from the Mac arriving. Screenshots: the folder.
//   node scripts/check-android.mjs     needs a booted emulator with Chrome (Google Play image) and adb on PATH or in
//                                       $ANDROID_SDK_ROOT (brew: openjdk@17, android-commandlinetools; see docs/install.md → Android)
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
import { startServer } from '../tests/helpers.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SDK = process.env.ANDROID_SDK_ROOT || '/opt/homebrew/share/android-commandlinetools';
const ADB = fs.existsSync(`${SDK}/platform-tools/adb`) ? `${SDK}/platform-tools/adb` : 'adb';
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'gubernos-android-'));
const s = await startServer({ GUBERNOS_PUBLIC_URL: 'http://localhost:4747' });
const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
await s.post('/api/tasks', { title: 'Call the plumber', priority: 'planned', due: today });
await s.post('/api/pair/required', { on: true });
const srv = { url: s.url, token: JSON.parse(fs.readFileSync(path.join(s.dir, 'data/pair.json'), 'utf8')).token };
// a clean Chrome every run: no pairing cookie, push subscription or notification left from the last one
execFileSync(ADB, ['shell', 'pm', 'clear', 'com.android.chrome']);
execFileSync(ADB, ['shell', 'pm', 'grant', 'com.android.chrome', 'android.permission.POST_NOTIFICATIONS']);
execFileSync(ADB, ['reverse', 'tcp:4747', `tcp:${new URL(s.proxyUrl).port}`]);
execFileSync(ADB, ['forward', 'tcp:9333', 'localabstract:chrome_devtools_remote']);
execFileSync(ADB, ['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'about:blank', 'com.android.chrome']);
await new Promise((r) => setTimeout(r, 3000));
let fails = 0; const check = (ok, t, d = '') => { if (!ok) fails++; console.log(`${ok ? '✓' : '✗'} ${t}${!ok && d ? `\n  ${String(d).slice(0, 400)}` : ''}`); };
const shot = (n) => fs.writeFileSync(`${S}/android-${n}.png`, execFileSync(ADB, ['exec-out', 'screencap', '-p']));
let tabs = [];
for (let i = 0; i < 30 && !tabs.some((x) => x.type === 'page'); i++) { try { tabs = await (await fetch('http://127.0.0.1:9333/json')).json(); } catch { /* Chrome is starting */ } if (!tabs.some((x) => x.type === 'page')) await sleep(1000); }
const t = tabs.find((x) => x.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const wait = new Map(); ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && wait.has(j.id)) { wait.get(j.id)(j); wait.delete(j.id); } };
const send = (method, params = {}) => new Promise((r) => { const n = ++id; wait.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const until = async (expr, ms = 15000) => { for (let i = 0; i < ms / 300; i++) { if (await ev(expr).catch(() => false)) return true; await sleep(300); } return false; };
await send('Page.enable'); await send('Runtime.enable');

await send('Page.navigate', { url: 'http://localhost:4747/' }); await sleep(3000);
check(/not paired/i.test(await ev('document.body.innerText')), 'without the code the app is closed: "not paired yet"', await ev('document.body.innerText'));
shot('1-not-paired');
await send('Page.navigate', { url: `http://localhost:4747/pair?t=${srv.token}` });
check(await until('document.querySelector("#main")?.innerText.includes("Call the plumber")', 20000), 'the pairing link opens the app: Today with its tasks', await ev('document.body.innerText.slice(0,300)'));
await sleep(1500); shot('2-today');
check(await ev('innerWidth <= 430 && document.documentElement.scrollWidth <= innerWidth'), 'Today fits the phone, no sideways scroll', await ev('innerWidth + " " + document.documentElement.scrollWidth'));
check(await until('navigator.serviceWorker.getRegistration().then((r) => !!r?.active)', 15000), 'the service worker is active (needed for install and push)');
const inst = await send('Page.getInstallabilityErrors');
check(Array.isArray(inst.result?.installabilityErrors) && !inst.result.installabilityErrors.length, 'Chrome can install it as an app', JSON.stringify(inst.result || inst.error));
const man = await send('Page.getAppManifest');
check(!!man.result?.url && !(man.result.errors || []).length, 'the manifest loads', JSON.stringify(man.result?.errors || man.error));

// notifications: Settings → This device → On; then a test push from the "Mac"
await send('Browser.grantPermissions', { origin: 'http://localhost:4747', permissions: ['notifications'] });
await ev('location.hash = "#/settings"'); await until('document.querySelector(".settings .set-row")');
await sleep(1500);
const groups = await ev('[...document.querySelectorAll(".settings h2.set-g")].map((h) => h.textContent).join(" | ")');
check(groups === 'This device | General | Your day | Your Mac | About', `Settings on the phone: ${groups}`);
check(await ev('/set on the Mac itself/.test(document.querySelector(".settings").innerText) && !/Model|iPhone and other devices/.test([...document.querySelectorAll(".settings .set-l")].map((l) => l.firstChild.textContent).join("|"))'), 'the Mac’s own settings are one line on the phone');
shot('3-settings');
await ev('document.querySelector(".settings [data-act=set-notif][data-val=on]")?.click()');
check(await until('fetch("/api/push/key").then((r) => r.json()).then((j) => j.devices > 0)', 25000), 'notifications on: the phone is subscribed to pushes', await ev('document.querySelector(".settings").innerText.match(/Notifications[\\s\\S]{0,120}/)?.[0]'));
execFileSync(ADB, ['shell', 'input', 'keyevent', 'KEYCODE_HOME']); await sleep(1000);
const r = await (await fetch(`${srv.url}/api/push/test`, { method: 'POST' })).json();
check(r.sent > 0, `the Mac sends a test push (${r.sent} of ${r.devices})`, JSON.stringify(r));
let seen = false;
for (let i = 0; i < 20 && !seen; i++) { await sleep(1500); seen = /Notifications work/.test(execFileSync(ADB, ['shell', 'dumpsys', 'notification', '--noredact'], { encoding: 'utf8' })); }
check(seen, 'the push shows on the phone: "Notifications work ✓"');
execFileSync(ADB, ['shell', 'cmd', 'statusbar', 'expand-notifications']); await sleep(1500); shot('4-push'); execFileSync(ADB, ['shell', 'cmd', 'statusbar', 'collapse']);
ws.close();
execFileSync(ADB, ['reverse', '--remove', 'tcp:4747']);
await s.stop();
console.log(`${fails ? `✗ ${fails} failed` : '✓ all good'} · ${S}`);
process.exit(fails ? 1 : 0);
