// The app itself in a real browser, on a fresh install's vault: it renders and no screen throws, at desktop and phone
// width. 2026-11-04: a stray apostrophe in public/app.js blanked every screen while the API tests stayed green.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { openPage } from './chrome.js';

const SCREENS = ['today', 'inbox', 'upcoming', 'agent', 'waiting', 'someday', 'day', 'plan', 'logbook', 'projects', 'more', 'how', 'phone', 'onboard', 'reflect', 'weekly', 'settings'];
let s, page;
before(async () => {
  s = await startServer();
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  await s.post('/api/tasks', { title: 'Buy milk', priority: 'planned', due: today });
  await s.post('/api/items', { text: 'call the plumber' });
  page = await openPage();
}, { timeout: 40000 });
after(async () => { try { await page?.close(); } finally { await s?.stop(); } });

test('each screen explains itself once on a new install, and only there', { timeout: 40000 }, async () => {
  const intro = 'document.querySelector(".scr-intro:not(.ob-remind)")?.innerText || ""';
  await page.goto(`${s.url}/#/today`);
  await page.waitFor('document.querySelector("#main")?.innerText.includes("Buy milk")');
  assert.equal(await page.eval(intro), '', 'an install already in use keeps its screens as they are');
  await s.patch('/api/settings', { screenIntros: true });
  await page.eval('location.reload()');
  assert.ok(await page.waitFor('document.querySelector(".scr-intro:not(.ob-remind)")?.innerText.includes("Pick the one thing")'), 'no line on Today');
  await page.eval('document.querySelector(".scr-intro:not(.ob-remind) [data-intro-ok]").click()');
  assert.ok(await page.waitFor('!document.querySelector(".scr-intro:not(.ob-remind)")'));
  assert.ok(await page.waitFor('document.querySelector("#main")?.innerText.includes("Buy milk")'), 'the screen itself stays');
  for (let i = 0; i < 50 && !(await (await fetch(`${s.url}/api/settings`)).json()).seenIntros?.includes('today'); i++) await page.sleep(100);
  await page.goto(`${s.url}/#/inbox`);
  assert.ok(await page.waitFor('document.querySelector(".scr-intro:not(.ob-remind)")?.innerText.includes("capture")'), 'the next screen has its own line');
  await page.goto(`${s.url}/#/today`);
  await page.waitFor('document.querySelector("#main")?.innerText.includes("Buy milk")');
  assert.equal(await page.eval(intro), '', 'seen once');
  await s.patch('/api/settings', { screenIntros: false, seenIntros: [] });
  await page.eval('location.reload()');
  await page.waitFor('document.querySelector("#main")?.innerText.includes("Buy milk")');
});

const mainText = 'document.querySelector("#main")?.innerText.trim() || ""';

for (const [label, w, h, mobile] of [['desktop', 1280, 800, false], ['phone', 390, 844, true]]) {
  test(`every screen renders without an error (${label})`, { timeout: 60000 }, async () => {
    await page.resize(w, h, mobile);
    page.errors.length = 0;
    await page.goto(`${s.url}/`);
    assert.ok(await page.waitFor(`(${mainText}).length > 0`), `the app stayed blank: ${page.errors.join(' | ')}`);
    // the first paint comes before the data
    assert.ok(await page.waitFor(`(${mainText}).includes("Buy milk")`), `today's task never showed: ${await page.eval(mainText)} | ${page.errors.join(' | ')}`);
    const failed = [];
    for (const screen of SCREENS) {
      await page.eval(`location.hash = "#/${screen}"`);
      const shown = await page.waitFor(`(${mainText}).length > 0`, 3000);
      await page.sleep(150); // what the screen loads after its first paint
      if (!shown) failed.push(`${screen}: blank`);
    }
    assert.deepEqual(failed, []);
    await page.eval('location.hash = "#/onboard"');
    assert.ok(await page.waitFor('document.querySelector(".onboard")?.innerText.includes("connect the AI")'), 'no model: the interview should say so');
    assert.deepEqual(page.errors, []);
  });
}
