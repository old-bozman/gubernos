// The first interview in the app, in a real browser, with a stand-in for the model (never the owner's real one): it starts
// itself, an answer resumes the same session, and only this agent may write files, without a shell.
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
  fs.writeFileSync(fake, `#!/usr/bin/env node
require('fs').appendFileSync(${JSON.stringify(path.join(dir, 'calls'))}, JSON.stringify(process.argv.slice(2)) + '\\n');
const n = require('fs').readFileSync(${JSON.stringify(path.join(dir, 'calls'))}, 'utf8').trim().split('\\n').length;
console.log(JSON.stringify({ session_id: 'sess-1', structured_output: { reply: n === 1 ? 'Hello, what are your **areas**?' : 'Thanks, all done.', finished: n > 1 } }));
`, { mode: 0o755 });
  s = await startServer({ GUBERNOS_CLAUDE_BIN: fake });
  page = await openPage();
}, { timeout: 40000 });
after(async () => { try { await page?.close(); } finally { await s?.stop(); fs.rmSync(dir, { recursive: true, force: true }); } });

test('the interview starts itself, resumes, finishes', { timeout: 40000 }, async () => {
  await page.goto(`${s.url}/#/onboard`);
  assert.ok(await page.waitFor('document.querySelector(".ob-agent")?.innerText.includes("areas")'), `no first question: ${page.errors.join(' | ')}`);
  const first = calls()[0];
  const flag = (a, f) => a[a.indexOf(f) + 1];
  assert.match(flag(first, '--allowedTools'), /\bWrite\b/);
  assert.match(flag(first, '--disallowedTools'), /\bBash\b/);
  assert.match(flag(first, '--append-system-prompt'), /Onboarding/);
  await page.eval('document.querySelector("#ob-msg").value = "Family and work"; document.querySelector("[data-act=onboard-send]").click()');
  assert.ok(await page.waitFor('document.querySelector(".onboard")?.innerText.includes("That’s the setup")'), `didn't finish: ${await page.eval('document.querySelector("#main").innerText')}`);
  const second = calls()[1];
  assert.equal(flag(second, '--resume'), 'sess-1');
  assert.ok(second.includes('--permission-mode'));
  assert.deepEqual(page.errors, []);
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
