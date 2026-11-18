// Everyone can run Gubernos on their own Anthropic API key (2026-11-18), added in Settings → Model or in the first interview
// instead of signing in to Claude Code or ChatGPT: checked with Anthropic before it's kept, only on the computer itself
// (through the phone's tunnel it would pass Cloudflare readable), kept where only this user reads it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { startServer } from './helpers.js';
import { openPage } from './chrome.js';

const GOOD = 'sk-ant-api03-good-key-for-the-test-0123456789';
function fakeAnthropic() {
  const server = http.createServer((req, res) => {
    const ok = req.url === '/v1/models' && req.headers['x-api-key'] === GOOD;
    res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' }).end(JSON.stringify(ok ? { data: [] } : { type: 'error', error: { type: 'authentication_error' } }));
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}

test('an API key added on the computer: checked, kept, used, removed; not through the phone’s connection', { timeout: 90000 }, async () => {
  const api = await fakeAnthropic();
  const s = await startServer({ GUBERNOS_API_URL: api.url });
  const page = await openPage();
  try {
    const listed = (await s.get('/api/ai')).body.list.find((p) => p.id === 'api');
    assert.ok(listed, 'the Claude API is offered to everyone'); assert.equal(listed.installed, false);

    // the Settings row and the interview both have the field
    await page.resize(1200, 900);
    await page.goto(`${s.url}/#/settings`);
    assert.ok(await page.waitFor('!!document.querySelector("#ai-key")', 15000), 'no key field in Settings');
    await page.goto(`${s.url}/#/onboard`);
    assert.ok(await page.waitFor('!!document.querySelector("#ob-key")', 15000), 'no key field in the interview');

    const bad = await s.post('/api/ai/key', { key: 'sk-ant-api03-wrong-key-0123456789abcdef' });
    assert.equal(bad.status, 400); assert.match(bad.body.error, /didn’t accept/);
    assert.equal((await s.post('/api/ai/key', { key: 'not a key' })).status, 400);

    const viaTunnel = await fetch(`${s.proxyUrl}/api/ai/key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: GOOD }) });
    assert.equal(viaTunnel.status, 403, 'a key typed on the phone would pass Cloudflare readable');

    const ok = await s.post('/api/ai/key', { key: GOOD });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.current, 'api', 'added here = the app runs on it');
    const file = path.join(s.dir, 'config/anthropic-key');
    assert.equal(fs.readFileSync(file, 'utf8').trim(), GOOD);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'only this user reads it');
    assert.ok(!JSON.stringify((await s.get('/api/state')).body).includes(GOOD), 'the key never goes back to a page');

    await page.goto(`${s.url}/#/settings`); await page.eval('location.reload()'); // a fresh page: Settings asks the Mac again
    assert.ok(await page.waitFor('[...document.querySelectorAll(".set-l")].some((x) => /Anthropic API key/.test(x.textContent) && /set ✓/.test(x.textContent))', 15000), 'Settings doesn’t show the key as set');

    const gone = (await fetch(`${s.url}/api/ai/key`, { method: 'DELETE' }).then((r) => r.json()));
    assert.equal(gone.list.find((p) => p.id === 'api').installed, false);
    assert.ok(!fs.existsSync(file));
    assert.deepEqual(page.errors.filter((e) => !/api\/gcal/.test(e)), []);
  } finally { await page.close(); await s.stop(); api.close(); }
});
