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

let s, stub, got;
const shared = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gg-')), 'google-client.json');
before(async () => {
  fs.writeFileSync(shared, JSON.stringify({ installed: { client_id: 'shared-id.apps.googleusercontent.com', client_secret: 'shared-secret' } }));
  stub = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => { b += d; }).on('end', () => {
      got = Object.fromEntries(new URLSearchParams(b));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy' }));
    });
  }).listen(0, '127.0.0.1');
  await new Promise((r) => stub.once('listening', r));
  s = await startServer({ GUBERNOS_GOOGLE_SHARED_CLIENT: shared, GUBERNOS_GOOGLE_TOKEN_URL: `http://127.0.0.1:${stub.address().port}/token` });
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
  const cb = await fetch(`${s.url}/api/gcal/callback?code=c1&state=${u.searchParams.get('state')}`);
  assert.equal(cb.status, 200, await cb.text());
  assert.equal(got.code, 'c1');
  assert.equal(crypto.createHash('sha256').update(got.code_verifier).digest('base64url'), u.searchParams.get('code_challenge'));
  assert.equal((await s.get('/api/gcal/status')).body.connected, true);
});

test('a wrong state is refused', async () => {
  const r = await fetch(`${s.url}/api/gcal/callback?code=c2&state=nope`);
  assert.equal(r.status, 400);
});
