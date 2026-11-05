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

test('it says what it takes and waits; a talk in, the answer in the chat, to the end', { timeout: 60000 }, async () => {
  await page.goto(`${s.url}/#/onboard`);
  assert.ok(await page.waitFor('document.querySelector(".ob-intro")?.innerText.includes("15–20 minutes")'), `no intro: ${page.errors.join(' | ')}`);
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
  assert.match(flag(first, '--allowedTools'), /\bWrite\b/);
  assert.match(flag(first, '--disallowedTools'), /\bBash\b/);
  assert.match(flag(first, '--append-system-prompt'), /Onboarding/);
  await send('Done for now');
  assert.ok(await page.waitFor('document.querySelector(".onboard")?.innerText.includes("That’s the setup")'), `didn't finish: ${await page.eval('document.querySelector("#main").innerText')}`);
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
