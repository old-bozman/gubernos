// The app itself in a real browser, on a fresh install's vault: it renders and no screen throws, at desktop and phone
// width. 2026-11-04: a stray apostrophe in public/app.js blanked every screen while the API tests stayed green.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { openPage } from './chrome.js';

const SCREENS = ['today', 'inbox', 'upcoming', 'agent', 'waiting', 'someday', 'day', 'plan', 'logbook', 'projects', 'more', 'how', 'phone', 'reflect', 'weekly', 'settings'];
let s, page;
before(async () => {
  s = await startServer();
  await s.post('/api/tasks', { title: 'Buy milk', priority: 'planned', due: new Date().toISOString().slice(0, 10) });
  await s.post('/api/items', { text: 'call the plumber' });
  page = await openPage();
});
after(async () => { await page?.close(); await s?.stop(); });

const mainText = 'document.querySelector("#main")?.innerText.trim() || ""';

for (const [label, w, h, mobile] of [['desktop', 1280, 800, false], ['phone', 390, 844, true]]) {
  test(`every screen renders without an error (${label})`, { timeout: 60000 }, async () => {
    await page.resize(w, h, mobile);
    page.errors.length = 0;
    await page.goto(`${s.url}/`);
    assert.ok(await page.waitFor(`(${mainText}).length > 0`), `the app stayed blank: ${page.errors.join(' | ')}`);
    assert.match(await page.eval(mainText), /Buy milk/);
    const failed = [];
    for (const screen of SCREENS) {
      await page.eval(`location.hash = "#/${screen}"`);
      const shown = await page.waitFor(`(${mainText}).length > 0`, 3000);
      await page.sleep(150); // what the screen loads after its first paint
      if (!shown) failed.push(`${screen}: blank`);
    }
    assert.deepEqual(failed, []);
    assert.deepEqual(page.errors, []);
  });
}
