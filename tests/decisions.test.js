// Closing a decision on the Decisions screen: the recommendation in one tap, or what you decided in your own words.
// 2026-11-16 Alex, on the Decisions screen: "I need to have the possibility to close it… the decision is made".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from './helpers.js';
import { openPage } from './chrome.js';

const decision = (q, rec = 'A') => `---
type: decision
status: open
about: []
owner: alex
decide_by:
review_at:
reversible: true
provenance: stated
---

# ${q}

## Options

- **A. Stage the rooms**: walls first, furniture last.
- **B. Pause the renovation**: wait until spring.

## Recommendation

**${rec}**: no finish gets damaged by later work.

## Decision
`;

test('a decision closes with the recommendation, or with your own words', { timeout: 90000 }, async () => {
  const s = await startServer();
  const page = await openPage();
  try {
    const dir = path.join(s.vault, '05_model/decisions'), arch = path.join(s.vault, '80_archive/model');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'kids-rooms.md'), decision('Kids’ rooms: stage or pause?'));
    fs.writeFileSync(path.join(dir, 'car.md'), decision('Which car next?'));
    await page.resize(402, 874);
    await page.goto(`${s.url}/#/decisions`);
    assert.ok(await page.waitFor('document.querySelectorAll(".dec-card").length === 2', 15000), 'no decisions on screen');
    assert.match(await page.eval('document.querySelector("[data-act=dec-accept]").textContent'), /Decide A · Stage the rooms/);

    // the recommendation, one tap (recorded after the undo window)
    await page.eval('[...document.querySelectorAll(".dec-card")].find((c) => /Kids/.test(c.textContent)).querySelector("[data-act=dec-accept]").click()');
    // own words: Decided otherwise… → type → Decided
    await page.eval('[...document.querySelectorAll(".dec-card")].find((c) => /car/.test(c.textContent)).querySelector("[data-act=dec-other]").click()');
    assert.ok(await page.waitFor('!!document.querySelector("#dec-own-car")', 5000), 'no field for your own words');
    await page.eval('document.querySelector("#dec-own-car").value = "Keep the old one another year"; document.querySelector("[data-act=dec-own][data-slug=car]").click()');

    for (let i = 0; i < 60 && !(fs.existsSync(path.join(arch, 'car.md')) && fs.existsSync(path.join(arch, 'kids-rooms.md'))); i++) await new Promise((r) => setTimeout(r, 250));
    const kids = fs.readFileSync(path.join(arch, 'kids-rooms.md'), 'utf8'), car = fs.readFileSync(path.join(arch, 'car.md'), 'utf8');
    assert.match(kids, /status: decided/); assert.match(kids, /## Decision\n+\d{4}-\d{2}-\d{2}: \*\*A — Stage the rooms\*\* · no finish gets damaged/);
    assert.match(car, /status: decided/); assert.match(car, /\*\*Keep the old one another year\*\* · decided in Gubernos/);
    assert.ok(!fs.existsSync(path.join(dir, 'car.md')), 'still open');
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); await s.stop(); }
});
