// The first interview in the app, in a real browser, with a stand-in for the model (never the owner's real one): it says what
// it takes and waits for the person, an answer resumes the same session, and only this agent may write files, without a shell.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from './helpers.js';
import { openPage } from './chrome.js';

let s, page, dir;
const calls = () => fs.readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gubernos-model-'));
  const fake = path.join(dir, 'claude');
  // like the real CLI: a prompt starting with "-" is taken for an option, and an error leaves stdout empty
  fs.writeFileSync(fake, `#!/usr/bin/env node
const a = process.argv.slice(2), prompt = a[a.indexOf('-p') + 1];
if (a[0] === 'auth') { console.log('{"loggedIn":true}'); process.exit(0); }
if (prompt.startsWith('-')) { console.error("error: unknown option '" + prompt + "'"); process.exit(1); }
if (prompt.includes('MODEL DOWN')) process.exit(1);
require('fs').appendFileSync(${JSON.stringify(path.join(dir, 'calls'))}, JSON.stringify(a) + '\\n');
const n = require('fs').readFileSync(${JSON.stringify(path.join(dir, 'calls'))}, 'utf8').trim().split('\\n').length;
console.log(JSON.stringify({ session_id: 'sess-1', structured_output: { reply: n === 1 ? 'Got it. What are your **areas**?\\n\\n| Area | Why |\\n|---|---|\\n| Family | it matters |' : 'Thanks, all done.', finished: n > 1 } }));
`, { mode: 0o755 });
  s = await startServer({ GUBERNOS_CLAUDE_BIN: fake });
  page = await openPage();
}, { timeout: 40000 });
after(async () => { try { await page?.close(); } finally { await s?.stop(); fs.rmSync(dir, { recursive: true, force: true }); } });

const send = (text) => page.eval(`document.querySelector("#ob-msg").value = ${JSON.stringify(text)}; document.querySelector("#ob-msg").dispatchEvent(new Event("input", { bubbles: true })); document.querySelector("[data-act=onboard-send]").click()`);

test('not signed in: it says so before anyone talks, and signing in needs no Terminal', { timeout: 40000 }, async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gubernos-model-'));
  const fake = path.join(d, 'claude'), flag = path.join(d, 'signed-in');
  fs.writeFileSync(fake, `#!/usr/bin/env node
const fs = require('fs'), a = process.argv.slice(2);
if (a.join(' ') === 'auth status --json') { console.log(JSON.stringify({ loggedIn: fs.existsSync(${JSON.stringify(flag)}) })); process.exit(fs.existsSync(${JSON.stringify(flag)}) ? 0 : 1); }
if (a.join(' ') === 'auth login') { if (fs.existsSync(${JSON.stringify(flag)} + '.fail')) { console.log('Paste code here if prompted >'); process.exit(1); } fs.writeFileSync(${JSON.stringify(flag)}, ''); process.exit(0); }
process.exit(1);
`, { mode: 0o755 });
  fs.writeFileSync(`${flag}.fail`, '');
  const srv = await startServer({ GUBERNOS_CLAUDE_BIN: fake });
  const p = await openPage();
  try {
    await p.goto(`${srv.url}/#/onboard`);
    assert.ok(await p.waitFor('document.querySelector("[data-act=onboard-connect][data-val=claude]")'), `no sign-in: ${await p.eval('document.querySelector("#main").innerText')}`);
    assert.ok(await p.eval('!document.querySelector("#ob-msg")'), 'it lets them talk with nothing to listen');
    assert.match(await p.eval('document.querySelector("[data-act=onboard-connect][data-val=claude]").innerText'), /Sign in to Claude/);
    // giving up: said in words, not the CLI's output
    await p.eval('document.querySelector("[data-act=onboard-connect][data-val=claude]").click()');
    // "Didn't finish…", not "finish signing in in your browser" (still waiting): only then the button works again
    assert.ok(await p.waitFor('/Didn.t finish signing in/i.test(document.querySelector(".onboard").innerText) && !document.querySelector("[data-act=onboard-connect][data-val=claude]").disabled'), 'no error shown');
    assert.ok(await p.eval('!document.querySelector(".onboard").innerText.includes("Paste code")'));
    // signing in: the interview opens by itself
    fs.rmSync(`${flag}.fail`);
    await p.eval('document.querySelector("[data-act=onboard-connect][data-val=claude]").click()');
    assert.ok(await p.waitFor('document.querySelector("#ob-msg")', 10000), `didn't open: ${await p.eval('document.querySelector("#main").innerText')}`);
  } finally { await p.close(); await srv.stop(); fs.rmSync(d, { recursive: true, force: true }); }
});

test('in the app too, a lost sign-in page can be given up on, and the button works again', { timeout: 40000 }, async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gubernos-model-'));
  const fake = path.join(d, 'claude');
  fs.writeFileSync(fake, `#!/bin/sh
case "$*" in
  "auth status --json") echo '{"loggedIn":false}'; exit 1;;
  "auth login") exec sleep 300;;
esac
`, { mode: 0o755 });
  const srv = await startServer({ GUBERNOS_CLAUDE_BIN: fake });
  const p = await openPage();
  try {
    await p.goto(`${srv.url}/#/onboard`);
    assert.ok(await p.waitFor('document.querySelector("[data-act=onboard-connect][data-val=claude]")'));
    assert.match(await p.eval('document.querySelector(".ob-connect").innerText'), /AI subscription: Claude with Claude Code/);
    assert.ok(!/Gemini/.test(await p.eval('document.querySelector(".onboard").innerText')));
    await p.eval('document.querySelector("[data-act=onboard-connect][data-val=claude]").click()');
    assert.ok(await p.waitFor('document.querySelector("[data-act=onboard-cancel]")', 10000), 'no way out of a lost sign-in');
    assert.ok(await p.eval('document.querySelector("[data-act=onboard-connect][data-val=claude]").disabled'));
    await p.eval('document.querySelector("[data-act=onboard-cancel]").click()');
    assert.ok(await p.waitFor('/Didn.t finish signing in/i.test(document.querySelector(".onboard").innerText) && !document.querySelector("[data-act=onboard-connect][data-val=claude]").disabled', 10000), await p.eval('document.querySelector(".onboard").innerText'));
    assert.ok(await p.eval('!document.querySelector("[data-act=onboard-cancel]")'));
  } finally { await p.close(); await srv.stop(); fs.rmSync(d, { recursive: true, force: true }); }
});

test('someone who left before the interview finds the way back on Today, until it is done or dismissed', { timeout: 40000 }, async () => {
  const srv = await startServer({ GUBERNOS_CLAUDE_BIN: path.join(dir, 'claude') });
  const p = await openPage();
  try {
    await srv.patch('/api/settings', { screenIntros: true });
    await p.goto(`${srv.url}/#/today`);
    assert.ok(await p.waitFor('document.querySelector(".ob-remind a[href=\\"#/onboard\\"]")'), `no way back: ${await p.eval('document.querySelector("#main").innerText')}`);
    await p.eval('document.querySelector(".ob-remind [data-intro-ok]").click()');
    await p.sleep(300);
    await p.eval('location.reload()');
    await p.waitFor('document.querySelector(".page-h")');
    await p.sleep(800);
    assert.ok(await p.eval('!document.querySelector(".ob-remind")'), 'dismissed, it came back');
    // an install from before this (no screen explanations) isn't nagged
    const old = await startServer({ GUBERNOS_CLAUDE_BIN: path.join(dir, 'claude') });
    try {
      await p.goto(`${old.url}/#/today`);
      await p.waitFor('document.querySelector(".page-h")');
      await p.sleep(800);
      assert.ok(await p.eval('!document.querySelector(".ob-remind")'));
    } finally { await old.stop(); }
  } finally { await p.close(); await srv.stop(); }
});

test('in the interview a long press on the mic starts the talk: letting go does not end it', { timeout: 40000 }, async () => {
  const mic = await openPage({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  try {
    await mic.goto(`${s.url}/#/onboard`);
    assert.ok(await mic.waitFor('document.querySelector("[data-voice][data-dictate=ob-msg], [data-dictate=ob-msg] [data-voice]")'), 'no mic');
    await mic.eval('document.querySelector("[data-voice][data-dictate=ob-msg], [data-dictate=ob-msg] [data-voice]").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }))');
    assert.ok(await mic.waitFor('document.querySelector("#rec-t")'), 'recording didn\'t start');
    await mic.sleep(900);
    await mic.eval('document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 }))');
    await mic.sleep(1500);
    assert.ok(await mic.eval('!!document.querySelector("[data-act=qa-mic]")'), 'the recording ended when the button was let go');
  } finally { await mic.close(); }
});

test('it says what it takes and waits; a talk in, the answer in the chat, to the end', { timeout: 60000 }, async () => {
  await page.goto(`${s.url}/#/onboard`);
  assert.ok(await page.waitFor('document.querySelector(".ob-intro")?.innerText.includes("about 10 minutes")'), `no intro: ${page.errors.join(' | ')}`);
  assert.ok(!fs.existsSync(path.join(dir, 'calls')), 'the model was called before the person said anything');
  // it offers the mic, and what's dictated lands in the answer box (the same [data-dictate] path as Daily reflection)
  assert.equal(await page.eval('document.querySelector(".ob-input [data-voice][data-dictate=ob-msg]")?.dataset.dictate'), 'ob-msg');
  assert.ok(await page.eval('!!document.getElementById(document.querySelector(".ob-input [data-dictate]").dataset.dictate)'));
  // a half-written answer survives a redraw
  await page.eval('const m = document.querySelector("#ob-msg"); m.value = "half an answer"; m.dispatchEvent(new Event("input", { bubbles: true })); location.hash = "#/today"');
  assert.ok(await page.waitFor('!document.querySelector("#ob-msg")'));
  await page.eval('location.hash = "#/onboard"');
  assert.ok(await page.waitFor('document.querySelector("#ob-msg")?.value === "half an answer"'), 'the draft is gone');
  // the model fails: the words come back, and the failed turn isn't kept
  await send('MODEL DOWN and my long answer');
  assert.ok(await page.waitFor('document.querySelector(".onboard .d-over")?.innerText.includes("still in the box")'), 'no error shown');
  assert.equal(await page.eval('document.querySelector("#ob-msg").value'), 'MODEL DOWN and my long answer');
  assert.equal((await (await fetch(`${s.url}/api/onboard`)).json()).turns.length, 0);
  // a pasted list starts with a dash: it must reach the model as text
  await send('- Family and work\n- Health');
  assert.ok(await page.waitFor('document.querySelector(".ob-agent")?.innerText.includes("areas")'), `no reply: ${await page.eval('document.querySelector("#main").innerText')}`);
  assert.ok(await page.eval('!document.querySelector(".ob-intro")'), 'the intro stays only until the first answer');
  // a table renders as a table, not as pipes
  assert.equal(await page.eval('document.querySelector(".ob-agent table td")?.innerText'), 'Family');
  assert.ok(await page.eval('!document.querySelector(".ob-agent").innerText.includes("|")'));
  const first = calls()[0];
  const flag = (a, f) => a[a.indexOf(f) + 1];
  assert.match(flag(first, '-p'), /- Family and work/);
  assert.match(flag(first, '-p'), new RegExp(`^\\[Now: .*${new Date().getFullYear()}`), 'the model is told the date');
  assert.match(flag(first, '--allowedTools'), /\bWrite\b/);
  assert.match(flag(first, '--disallowedTools'), /\bBash\b/);
  assert.match(flag(first, '--append-system-prompt'), /Onboarding/);
  await send(`${'A very long talk. '.repeat(600)}Done for now`);
  assert.ok(await page.waitFor('document.querySelector(".onboard")?.innerText.includes("That’s the setup")'), `didn't finish: ${await page.eval('document.querySelector("#main").innerText')}`);
  assert.equal(await page.eval('document.querySelector(".onboard a.btn.primary")?.getAttribute("href")'), '#/today');
  await page.sleep(200);
  assert.ok(await page.eval('(() => { const r = document.querySelector(".onboard a.btn.primary").getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()'), 'after a long talk the way on is off the screen');
  const second = calls()[1];
  assert.equal(flag(second, '--resume'), 'sess-1');
  assert.ok(second.includes('--permission-mode'));
  assert.deepEqual(page.errors.filter((e) => !e.includes('502')), []); // the 502 is the failure this test caused
  // it survives a reload
  await page.goto(`${s.url}/#/today`); await page.goto(`${s.url}/#/onboard`);
  assert.ok(await page.waitFor('document.querySelector(".ob-you")?.innerText.includes("Family and work")'));
  assert.equal(calls().length, 2);
});

test('the app\'s ordinary chat stays read-only', async () => {
  const r = await s.post('/api/chat', { message: 'hi', session: null });
  const chat = calls().at(-1);
  assert.equal(r.status === 200 || r.status === 502, true);
  assert.match(chat[chat.indexOf('--disallowedTools') + 1], /\bWrite\b/);
});
