// The relay worker (relay/worker.js) with GitHub and Apple stubbed: what other people's installs send through it.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const worker = (await import('../relay/worker.js')).default;
const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const env = { FEEDBACK_REPO: 'o/feedback', GITHUB_TOKEN: 't', KEY_SECRET: 'secret', APNS_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T', APNS_TOPIC: 'app.gubernos' };
let calls;
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
beforeEach(() => {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (/\/issues$/.test(url)) return reply(201, { number: 7 });
    if (/\/issues\/7$/.test(url)) return reply(200, { state: 'open' });
    if (/\/issues\/7\/comments/.test(url)) return init.method === 'POST' ? reply(201, {}) : reply(200, [{ body: 'Fixed?', created_at: 'x' }, { body: '<!-- reporter -->\n**Reporter:** still wrong', created_at: 'y' }]);
    if (/\/3\/device\//.test(url)) return new Response('', { status: 200 });
    return reply(404, {});
  };
});
const call = (method, path, body) => worker.fetch(new Request(`https://relay.test${path}`, { method, body: body ? JSON.stringify(body) : undefined }), env);

test('a report becomes an issue; only its key reads the answers', async () => {
  assert.equal((await call('POST', '/feedback', { install: 'abc' })).status, 400); // no title
  const r = await call('POST', '/feedback', { install: 'abc', kind: 'bug', title: 'It broke', body: 'details' });
  const { issue, key } = await r.json();
  assert.equal(issue, 7);
  assert.equal((await call('GET', '/feedback/7?key=nope')).status, 403);
  const a = await (await call('GET', `/feedback/7?key=${key}`)).json();
  assert.equal(a.state, 'OPEN');
  assert.deepEqual(a.comments.map((c) => [c.from, c.body]), [['developer', 'Fixed?'], ['reporter', 'still wrong']]);
  assert.equal((await call('POST', `/feedback/7/reply?key=${key}`, { body: 'ok' })).status, 200);
});

test('push: only APNs JSON to well-formed device tokens, topic fixed', async () => {
  const tok = 'a'.repeat(64);
  assert.equal((await call('POST', '/push', { env: 'production', tokens: ['nothex'], payload: '{"aps":{}}' })).status, 400);
  assert.equal((await call('POST', '/push', { env: 'production', tokens: [tok], payload: '{"x":1}' })).status, 400);
  assert.equal((await call('POST', '/push', { env: 'other', tokens: [tok], payload: '{"aps":{}}' })).status, 400);
  const r = await call('POST', '/push', { env: 'production', tokens: [tok], payload: '{"aps":{"alert":"hi"}}' });
  assert.deepEqual((await r.json()).results, [{ device: 'aaaaaaaa', status: 200, reason: '' }]);
  const sent = calls.find((c) => c.url.includes('/3/device/'));
  assert.equal(sent.init.headers['apns-topic'], 'app.gubernos');
  assert.match(sent.init.headers.authorization, /^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
});

test('anything else is 404', async () => {
  assert.equal((await call('GET', '/')).status, 404);
});

test('tunnel: a Cloudflare tunnel, its ingress to the Mac port and its DNS name; only its key deletes it', async () => {
  const tenv = { ...env, CF_API_TOKEN: 'cf', CF_ACCOUNT_ID: 'acc', CF_ZONE_ID: 'zone', TUNNEL_DOMAIN: 'mac.test' };
  const id = '11111111-2222-3333-4444-555555555555';
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const ok = (result) => reply(200, { success: true, result });
    if (init.method === 'POST' && url.endsWith('/cfd_tunnel')) return ok({ id, token: 'TOK' });
    if (init.method === 'GET' && url.includes('/dns_records?')) return ok([{ id: 'd1' }]);
    return ok({});
  };
  const tcall = (method, path, body) => worker.fetch(new Request(`https://relay.test${path}`, { method, body: body ? JSON.stringify(body) : undefined }), tenv);
  assert.equal((await tcall('POST', '/tunnel', { port: 80 })).status, 400);
  const t = await (await tcall('POST', '/tunnel', { port: 4748 })).json();
  assert.equal(t.id, id); assert.equal(t.token, 'TOK');
  assert.match(t.hostname, /^m-[0-9a-f]{12}\.mac\.test$/);
  const cfg = JSON.parse(calls.find((c) => c.url.endsWith('/configurations')).init.body);
  assert.deepEqual(cfg.config.ingress[0], { hostname: t.hostname, service: 'http://localhost:4748', originRequest: {} });
  const dns = JSON.parse(calls.find((c) => c.init.method === 'POST' && c.url.endsWith('/dns_records')).init.body);
  assert.equal(dns.content, `${id}.cfargotunnel.com`);
  assert.equal((await tcall('DELETE', `/tunnel/${id}?key=nope`)).status, 403);
  assert.equal((await tcall('DELETE', `/tunnel/${id}?key=${t.key}`)).status, 200);
  assert.ok(calls.some((c) => c.init.method === 'DELETE' && c.url.endsWith(`/cfd_tunnel/${id}`)));
});
