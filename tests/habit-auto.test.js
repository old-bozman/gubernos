// An automatic habit names where its value comes from. 2026-11-17 Alex: habits filled in by Gubernos itself
// (auto: app:…) said "⟲ Oura" on the Protocol screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from './helpers.js';
import { openPage } from './chrome.js';

const habit = (title, auto) => `---
type: habit
status: active
kind: build
protocol: null
serves: []
supports: []
target: null
unit: null
auto: "${auto}"
provenance: stated
---

# ${title}
`;

test('the Protocol screen names each automatic habit’s source', { timeout: 60000 }, async () => {
  const s = await startServer();
  const page = await openPage();
  try {
    const dir = path.join(s.vault, '05_model/habits');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'keep-promises.md'), habit('Keep promises', 'app:tasks'));
    fs.writeFileSync(path.join(dir, 'steps.md'), habit('Steps', 'health:steps'));
    fs.writeFileSync(path.join(dir, 'sleep.md'), habit('Sleep by 22:00', 'oura:bedtime<=22:00'));
    await page.resize(402, 874);
    await page.goto(`${s.url}/#/day`);
    assert.ok(await page.waitFor('document.querySelectorAll(".hb-row").length >= 3', 15000), 'no habits on screen');
    const src = await page.eval(`Object.fromEntries([...document.querySelectorAll(".hb-row")].map((r) => [r.dataset.slug, [...r.querySelectorAll('[title="filled in automatically"]')].map((x) => x.textContent).join()]))`);
    assert.equal(src['keep-promises'], '⟲ Gubernos');
    assert.equal(src.steps, '⟲ Health');
    assert.equal(src.sleep, '⟲ Oura');
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); await s.stop(); }
});
