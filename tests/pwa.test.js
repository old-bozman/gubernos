// Android has no app of its own: Gubernos is installed from Chrome (⋮ → Install app). Chrome itself says whether it can be.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { openPage } from './chrome.js';

let s;
before(async () => { s = await startServer(); }, { timeout: 30000 });
after(async () => { await s?.stop(); });

test('Chrome can install it as an app: a manifest with its icons, nothing in the way', { timeout: 60000 }, async () => {
  const page = await openPage();
  try {
    await page.goto(`${s.url}/#/today`);
    assert.ok(await page.waitFor('!!document.querySelector(".side")', 15000), 'the app didn’t open');
    const m = await page.send('Page.getAppManifest');
    assert.deepEqual(m.errors, [], 'the manifest has errors');
    assert.equal(JSON.parse(m.data).display, 'standalone');
    let errs;
    for (let i = 0; i < 30; i++) { errs = (await page.send('Page.getInstallabilityErrors')).installabilityErrors; if (!errs.length) break; await page.sleep(300); }
    assert.deepEqual(errs.map((e) => e.errorId), [], 'Chrome won’t install it');
  } finally { await page.close(); }
});
