#!/usr/bin/env node
// The first interview as a new person gets it, with nobody at the keyboard: a fresh vault, the real model, a real browser, and a
// recorded talk going through the real mic path (Chrome's fake microphone → recorder → the Mac's speech model). It answers until
// the interview ends, opens Today and checks what's on it. Spends a little of the owner's model plan, touches none of their files,
// and the model doesn't see their personal instructions. Screenshots, the talk and the resulting vault go to the printed folder.
//   node scripts/check-interview.mjs            exit 1 if a check failed
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, startServer } from '../tests/helpers.js';
import { openPage } from '../tests/chrome.js';

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'gubernos-interview-'));
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).format(new Date());
const JARGON = /\b(commitments?|responsibilit\w+|provenance|frontmatter|vault|wikilink|yaml|inferred|ontology)\b/i;
const MAX_TURNS = 7, MAX_WORDS = 110;
const FOLLOW_UPS = ['Nothing big apart from what I said. Maybe that I would like to read more.', 'No, that really is all of it for now.', 'Nothing else.'];
const report = [];
let failed = 0;
const say = (line) => { console.log(line); report.push(line); };
const check = (ok, text, detail = '') => { if (!ok) failed++; say(`${ok ? '✓' : '✗'} ${text}${!ok && detail ? `\n  ${String(detail).slice(0, 600)}` : ''}`); return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// the talk, as speech
const talk = fs.readFileSync(path.join(ROOT, 'tests/fixtures/interview-talk.txt'), 'utf8');
const wav = path.join(OUT, 'talk.wav');
execFileSync('say', ['-v', 'Samantha', '-r', '220', '-o', wav, '--file-format=WAVE', '--data-format=LEI16@48000', talk]);
const seconds = Number(execFileSync('afinfo', [wav], { encoding: 'utf8' }).match(/estimated duration: ([\d.]+)/)[1]);

// the real CLI without the owner's own instructions, memory or tools: what a new person's model sees
const real = spawnSync('/bin/sh', ['-lc', 'command -v claude'], { encoding: 'utf8' }).stdout.trim();
if (!real) { console.error('no claude on this Mac'); process.exit(1); }
const wrapper = path.join(OUT, 'claude');
fs.writeFileSync(wrapper, `#!/bin/sh\nexec ${JSON.stringify(real)} --setting-sources project,local --strict-mcp-config "$@"\n`, { mode: 0o755 });

const s = await startServer({ GUBERNOS_CLAUDE_BIN: wrapper });
const page = await openPage({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-features=AudioServiceSandbox', '--autoplay-policy=no-user-gesture-required', `--use-file-for-fake-audio-capture=${wav}%noloop`] });
let n = 0;
const shot = (name) => page.screenshot(path.join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`));
const state = async () => (await fetch(`${s.url}/api/onboard`)).json();
try {
  await s.patch('/api/settings', { screenIntros: true });
  await page.resize(1280, 900);
  await page.goto(`${s.url}/#/onboard`);
  check(await page.waitFor('document.querySelector(".ob-intro")?.innerText.includes("15–20 minutes")'), 'the screen says to set aside 15–20 minutes');
  await shot('intro');

  // 1. the talk: tap the mic, speak, Done
  const heard = await page.eval(`(async () => {
    const b = document.querySelector('[data-dictate="ob-msg"] [data-voice], [data-voice][data-dictate="ob-msg"]');
    if (!b) return 'no mic button';
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    await new Promise((r) => setTimeout(r, 900));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
    return 'ok';
  })()`);
  check(heard === 'ok', 'the mic button is there', heard);
  check(await page.waitFor('document.querySelector("#rec-t")', 15000), 'recording starts', page.errors.join(' | '));
  const t0 = Date.now();
  await sleep(Math.min(20000, seconds * 500));
  await shot('recording');
  await sleep(Math.max(0, seconds * 1000 + 2500 - (Date.now() - t0)));
  check(await page.eval('!!document.querySelector("[data-act=qa-mic]")'), `after ${Math.round(seconds)} s with pauses it's still recording, until Done`);
  await page.eval('document.querySelector("[data-act=qa-mic]").click()');
  const t1 = Date.now();
  check(await page.waitFor('(document.querySelector("#ob-msg")?.value || "").length > 200', 120000), 'what was said lands in the answer box', await page.eval('document.querySelector("#main").innerText').catch(() => ''));
  const dictated = await page.eval('document.querySelector("#ob-msg").value');
  fs.writeFileSync(path.join(OUT, 'heard.txt'), dictated);
  say(`  transcribed in ${Math.round((Date.now() - t1) / 1000)} s, ${dictated.split(/\s+/).length} of ${talk.split(/\s+/).length} words`);
  const keywords = ['Utrecht', 'physio', 'mortgage', 'accountant', 'Japan'].filter((w) => !new RegExp(w, 'i').test(dictated));
  check(keywords.length <= 1, 'the transcript has the talk in it', `missing: ${keywords.join(', ')}`);
  await shot('dictated');
  if (dictated.length < 200) throw new Error('nothing to talk to the model with');

  // 2. the talk with the model, until it ends
  const convo = [];
  let cur = await state(), msg = dictated, followUp = 0;
  const started = Date.now();
  for (let i = 0; i < MAX_TURNS && !cur.finished; i++) {
    const before = cur.turns.length, t = Date.now();
    await page.eval(`(() => { const m = document.querySelector("#ob-msg"); m.value = ${JSON.stringify(msg)}; m.dispatchEvent(new Event("input", { bubbles: true })); document.querySelector("[data-act=onboard-send]").click(); })()`);
    for (let w = 0; w < 660 && cur.turns.length <= before; w++) {
      await sleep(500);
      cur = await state();
      if (await page.eval('document.querySelector(".onboard .d-over")?.innerText || ""')) break;
    }
    const err = await page.eval('document.querySelector(".onboard .d-over")?.innerText || ""');
    if (!check(!err && cur.turns.length > before, `turn ${i + 1} answered in ${Math.round((Date.now() - t) / 1000)} s`, err || 'no answer in 5 minutes')) break;
    const reply = cur.turns.at(-1).text;
    convo.push({ you: msg, agent: reply });
    await sleep(600);
    await shot(`turn-${i + 1}`);
    msg = /\b(today|tomorrow)\b/i.test(reply) && /\?/.test(reply) ? 'Yes, that is it.' : FOLLOW_UPS[Math.min(followUp++, FOLLOW_UPS.length - 1)];
  }
  fs.writeFileSync(path.join(OUT, 'conversation.md'), convo.map((c) => `**You:** ${c.you}\n\n**Gubernos:** ${c.agent}\n`).join('\n'));
  say(`  ${convo.length} turns, ${Math.round((Date.now() - started) / 1000)} s with the model`);
  check(cur.finished, `it ends by itself within ${MAX_TURNS} turns`);
  const replies = convo.map((c) => c.agent);
  const long = replies.filter((r) => r.split(/\s+/).length > MAX_WORDS);
  check(!long.length, `every reply is short (up to ${MAX_WORDS} words)`, long[0]);
  const jargon = replies.map((r) => r.match(JARGON)?.[0]).filter(Boolean);
  check(!jargon.length, 'no system words in what it says', jargon.join(', '));
  check(!replies.some((r) => /\b(confirm|is that (right|correct)|shall i|should i (save|add|file))\b/i.test(r)), 'it asks nobody to confirm what it filed', replies.find((r) => /\b(confirm|is that (right|correct)|shall i|should i (save|add|file))\b/i.test(r)));
  check(!replies.some((r) => /\|.*\|/.test(r) || /^\s*[-*] /m.test(r)), 'it talks: no tables or lists', replies.find((r) => /\|.*\|/.test(r) || /^\s*[-*] /m.test(r)));
  const lastQ = replies.slice(0, -1).findLast((r) => /\?/.test(r)) || '';
  check(/\b(today|tomorrow)\b/i.test(lastQ), 'its last question is about today', lastQ);

  // 3. what it filed
  const dailyFile = path.join(s.vault, `50_reviews/daily/${TODAY}.md`);
  const daily = fs.existsSync(dailyFile) ? fs.readFileSync(dailyFile, 'utf8') : '';
  const one = daily.match(/^- (?:\[.\] )?#1: (.+?)(?: · \[\[(.+?)\]\])?\s*$/m);
  const after20 = new Date().getHours() >= 20; // late in the evening it plans tomorrow instead
  if (after20) say('  after 20:00: the plan may be for tomorrow');
  check(!!one || after20, 'today has a #1', daily || 'no daily file');
  const tasks = fs.readdirSync(path.join(s.vault, '10_tasks')).filter((f) => f.endsWith('.md')).map((f) => {
    const text = fs.readFileSync(path.join(s.vault, '10_tasks', f), 'utf8');
    return { id: f.replace(/\.md$/, ''), due: text.match(/^due: *"?(\d{4}-\d\d-\d\d)/m)?.[1], title: (text.match(/^# (.+)$/m) || text.match(/^title: *"?(.+?)"?$/m) || [])[1] || '' };
  });
  const dueToday = tasks.filter((t) => t.due === TODAY);
  check(!!one?.[2] && dueToday.some((t) => t.id === one[2]), 'the #1 is a task due today', `${one?.[2]} of ${tasks.map((t) => `${t.id}:${t.due}`).join(', ')}`);
  check(dueToday.length >= 2, 'more of what was said is due today', dueToday.map((t) => t.title).join(', '));
  check(tasks.length >= 4, `what was said became tasks (${tasks.length})`, tasks.map((t) => t.title).join(', '));
  const count = (d) => { const p = path.join(s.vault, d); return fs.existsSync(p) ? fs.readdirSync(p).filter((f) => f.endsWith('.md')).length : 0; };
  say(`  filed: ${tasks.length} tasks, ${count('20_projects')} projects, ${count('30_goals')} goals, ${count('05_model/people')} people, ${count('05_model/responsibilities')} areas, ${count('05_model/commitments')} commitments, ${count('05_model/wants')} wants, ${count('05_model/decisions')} decisions`);

  // 4. the way out: Today, ready
  check(await page.waitFor('document.querySelector(".onboard a.btn.primary[href=\\"#/today\\"]")'), 'it ends with Open Today');
  await sleep(300);
  check(await page.eval('(() => { const r = document.querySelector(".onboard a.btn.primary").getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()'), 'Open Today is on the screen, no scrolling');
  await shot('finished');
  await page.eval('document.querySelector(".onboard a.btn.primary").click()');
  await sleep(1500);
  const main = await page.eval('document.querySelector("#main").innerText');
  await shot('today');
  fs.writeFileSync(path.join(OUT, 'today.txt'), main);
  const has = (title) => main.toLowerCase().includes(title.slice(0, 18).toLowerCase());
  check(one && has(one[1]), 'Today shows the #1', `${one?.[1]}\n${main}`);
  const missing = dueToday.filter((t) => t.id !== one?.[2] && !has(t.title));
  check(!missing.length, 'Today lists the tasks due today', `${missing.map((t) => t.title).join(', ')}\n${main}`);
  check(await page.eval('!!document.querySelector(".scr-intro")'), 'Today explains itself the first time');
  check(!/Probably not today/.test(main), 'on an empty calendar, the tasks fit today', main);
  await page.resize(390, 844, true);
  await sleep(500);
  await shot('today-phone');
  const wide = await page.eval('document.documentElement.scrollWidth - innerWidth');
  check(wide <= 0, 'Today fits a phone', `${wide}px too wide`);
  const errors = page.errors.filter((e) => !/favicon/.test(e));
  check(!errors.length, 'no errors in the page', errors.join(' | '));
} catch (e) {
  check(false, 'the run finished', e.stack);
  await shot('crash').catch(() => {});
} finally {
  await page.close().catch(() => {});
  fs.cpSync(s.vault, path.join(OUT, 'vault'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'server.log'), s.log());
  await s.stop();
}
fs.writeFileSync(path.join(OUT, 'report.txt'), `${report.join('\n')}\n`);
console.log(`${failed ? `✗ ${failed} failed` : '✓ all good'} · ${OUT}`);
process.exit(failed ? 1 : 0);
