// The Ask chat on a computer without voice (Linux with no Whisper, say): no mic is shown, so the chat doesn't tell people to
// hold one (a report from another install, 2026-11-09: "Or hold the mic and speak", and no mic anywhere).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { openPage } from './chrome.js';

test('no voice here: the chat neither shows a mic nor asks to hold one', { timeout: 60000 }, async () => {
  const s = await startServer();
  const page = await openPage();
  try {
    // the state as such a computer reports it
    await page.onNewDocument(`const f = window.fetch; window.fetch = async (u, o) => { const r = await f(u, o);
      if (!String(u).endsWith('/api/state')) return r; const j = await r.json(); j.voice = false;
      return new Response(JSON.stringify(j), { status: r.status, headers: { 'content-type': 'application/json' } }); };`);
    await page.resize(392, 735, true);
    await page.goto(`${s.url}/#/today`);
    assert.ok(await page.waitFor('document.body.classList.contains("no-voice")', 15000), 'the page never learned there is no voice');
    await page.eval('document.getElementById("ask").click()');
    assert.ok(await page.waitFor('!!document.querySelector(".chat-empty")'), 'the chat didn’t open');
    assert.ok(!/hold the mic/i.test(await page.eval('document.querySelector(".chat-empty").innerText')), 'it still asks to hold a mic');
    assert.equal(await page.eval('[...document.querySelectorAll(".composer [data-voice]")].filter((b) => getComputedStyle(b).display !== "none").length'), 0);
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); await s.stop(); }
});
