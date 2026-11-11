// Sign in with Google with the shared Gubernos client (no client of one's own): the consent URL carries PKCE, and the
// code is exchanged with the verifier this Mac kept. Google's token endpoint is a local stub.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startServer } from './helpers.js';
import { openPage } from './chrome.js';

let s, stub, got, revoked;
const shared = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gg-')), 'google-client.json');
before(async () => {
  fs.writeFileSync(shared, JSON.stringify({ installed: { client_id: 'shared-id.apps.googleusercontent.com', client_secret: 'shared-secret' } }));
  stub = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => { b += d; }).on('end', () => {
      if (req.url === '/revoke') { revoked = Object.fromEntries(new URLSearchParams(b)); return res.writeHead(200).end(); }
      got = Object.fromEntries(new URLSearchParams(b));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy' }));
    });
  }).listen(0, '127.0.0.1');
  await new Promise((r) => stub.once('listening', r));
  s = await startServer({ GUBERNOS_GOOGLE_SHARED_CLIENT: shared, GUBERNOS_GOOGLE_TOKEN_URL: `http://127.0.0.1:${stub.address().port}/token`, GUBERNOS_GOOGLE_REVOKE_URL: `http://127.0.0.1:${stub.address().port}/revoke` });
});
after(async () => { await s?.stop(); stub?.close(); });

test('no own client: the shared one signs in, with PKCE', async () => {
  const st = (await s.get('/api/gcal/status')).body;
  assert.equal(st.configured, true);
  assert.equal(st.shared, true);
  const r = await fetch(`${s.url}/api/gcal/connect`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  const u = new URL(r.headers.get('location'));
  assert.equal(u.searchParams.get('client_id'), 'shared-id.apps.googleusercontent.com');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.match(u.searchParams.get('scope'), /calendar\.calendarlist\.readonly/);
  // the shared client asks for the calendar only: what Google verifies without a yearly audit (lib/google.js)
  assert.deepEqual(u.searchParams.get('scope').split(' ').filter((x) => !/\/auth\/calendar\./.test(x)), []);
  assert.deepEqual(st.wanted, ['calendar']);
  const cb = await fetch(`${s.url}/api/gcal/callback?code=c1&state=${u.searchParams.get('state')}`);
  assert.equal(cb.status, 200, await cb.text());
  assert.equal(got.code, 'c1');
  assert.equal(crypto.createHash('sha256').update(got.code_verifier).digest('base64url'), u.searchParams.get('code_challenge'));
  assert.equal((await s.get('/api/gcal/status')).body.googleCalendar, true);
});

// 2026-11-11 (recording the demo for Google): Settings said Gubernos is about mail, contacts and docs, and its Disconnect did nothing
test('Settings: the shared sign-in is about the calendar; Disconnect revokes at Google and forgets the token', { timeout: 60000 }, async () => {
  assert.equal((await s.get('/api/gcal/status')).body.googleCalendar, true);
  const page = await openPage();
  try {
    await page.goto(`${s.url}/#/settings`);
    const row = `[...document.querySelectorAll(".settings .set-row")].find((r) => r.querySelector(".set-l").firstChild.textContent.trim() === "Google")`;
    assert.ok(await page.waitFor(`${row}?.innerText.includes("Connected: Calendar")`, 15000), 'Settings never showed the connection');
    const text = await page.eval(`${row}.innerText`);
    assert.match(text, /your calendar/);
    assert.doesNotMatch(text, /mail|contacts|docs|Drive/i, text);
    await page.eval(`${row}.querySelector("[data-act=google-disconnect]").click()`);
    assert.ok(await page.waitFor(`${row}?.innerText.includes("Not connected")`, 10000), await page.eval(`${row}.innerText`));
    assert.deepEqual(page.errors.filter((e) => !/api\/gcal\/calendars/.test(e)), []); // the calendar list asks Google itself: none here
  } finally { await page.close(); }
  assert.equal(revoked.token, 'r');
  assert.equal((await s.get('/api/gcal/status')).body.googleCalendar, false);
});

test('a wrong state is refused', async () => {
  const r = await fetch(`${s.url}/api/gcal/callback?code=c2&state=nope`);
  assert.equal(r.status, 400);
});
