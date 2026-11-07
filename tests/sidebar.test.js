// The menu on a wide screen: names by default; folded into icons, each icon says its name the moment the pointer is on it.
// 2026-11-07, a tester: "the sidebar has no hints neither its expandable - so one must click to guess what the section does".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { openPage } from './chrome.js';

let s;
before(async () => { s = await startServer(); }, { timeout: 30000 });
after(async () => { await s?.stop(); });

test('a first visit shows the menu with its names; folded, an icon names itself on hover at once', { timeout: 60000 }, async () => {
  const page = await openPage();
  try {
    await page.resize(1200, 800);
    await page.goto(`${s.url}/#/today`);
    assert.ok(await page.waitFor('!!document.querySelector(".side .nav[href=\'#/today\']")', 15000), 'no menu');
    assert.equal(await page.eval('document.body.classList.contains("rail")'), false, 'folded into icons on a first visit');
    assert.ok(await page.eval('document.querySelector(".side .nav[href=\'#/inbox\'] .lbl").offsetWidth > 0'), 'the names don’t show');
    await page.eval('document.querySelector("[data-act=side-rail]").click()');
    assert.equal(await page.eval('document.body.classList.contains("rail")'), true);
    await page.eval('document.querySelector(".side .nav[href=\'#/inbox\'] .ic").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))');
    assert.equal(await page.eval('document.querySelector(".rail-tip.on")?.textContent'), 'Inbox');
    const [tip, icon] = await page.eval('[document.querySelector(".rail-tip").getBoundingClientRect().left, document.querySelector(".side .nav[href=\'#/inbox\']").getBoundingClientRect().right]');
    assert.ok(tip > icon, 'the name sits over the icon instead of beside it');
    await page.eval('document.querySelector("#main").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))');
    assert.equal(await page.eval('!!document.querySelector(".rail-tip.on")'), false, 'the name stays after the pointer left');
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); }
});
