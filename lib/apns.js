// Apple Push (APNs) straight to the iPhone app (gubernos-ios), next to Web Push for the home-screen web app (lib/push.js).
// Token auth: ~/.config/gubernos/apns.json {keyId, teamId, topic} + apns.p8 (the key from developer.apple.com → Keys, made for
// Sandbox & Production) — only the app owner (the developer) has it. Every other install hands the push to the relay
// (config PUSH_RELAY, relay/worker.js /push), which signs it with that key: the same payload, the key never leaves. Devices register via POST /api/push/apns {token, env, name, local}; they live in data/apns-devices.json.
// env: sandbox = an app installed from Xcode / build.sh (development signing), production = TestFlight / App Store.
// local: what the app already rings by itself on the phone (Reminders.swift — reminders, check-ins), never sent twice.
import fs from 'node:fs';
import path from 'node:path';
import http2 from 'node:http2';
import crypto from 'node:crypto';
import { CONFIG_DIR, PUSH_RELAY } from './config.js';
import * as Settings from './settings.js';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = process.env.GUBERNOS_DATA_DIR || path.join(ROOT, 'data');
const DEVICES = path.join(DATA, 'apns-devices.json');
const DIR = process.env.GUBERNOS_GOOGLE_DIR || CONFIG_DIR;
const HOSTS = { sandbox: 'https://api.sandbox.push.apple.com', production: 'https://api.push.apple.com' };

const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const write = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 1), { mode: 0o600 }); };

function config() {
  const c = read(path.join(DIR, 'apns.json'), null);
  if (!c?.keyId || !c?.teamId) return null;
  try { return { ...c, topic: c.topic || 'app.gubernos', key: crypto.createPrivateKey(fs.readFileSync(path.join(DIR, c.file || 'apns.p8'))) }; } catch { return null; }
}
export const configured = () => !!config() || (!!PUSH_RELAY && Settings.get().relayPush !== false);

export const devices = () => read(DEVICES, []);
// alerts: false = notifications are off for the app in iOS Settings — nothing is sent to it (an older app doesn't say: sent)
export function register({ token, env, name, local, alerts } = {}) {
  if (!/^[0-9a-f]{64,200}$/i.test(String(token || ''))) throw Object.assign(new Error('bad device token'), { status: 400 });
  const e = env === 'production' ? 'production' : 'sandbox';
  const list = devices().filter((d) => d.token !== token);
  list.push({ token, env: e, name: String(name || '').slice(0, 60), local: { reminders: !!local?.reminders, checkins: !!local?.checkins }, ...(alerts === false ? { alerts: false } : {}), at: new Date().toISOString() });
  write(DEVICES, list);
  return { ok: true, devices: list.length, configured: configured() };
}

// The provider token: ES256, reused for 50 min (Apple refuses a new one more often than every 20 min, and an older than 60).
let jwt = null;
function bearer(c) {
  if (jwt && jwt.kid === c.keyId && Date.now() - jwt.at < 50 * 60e3) return jwt.token;
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const data = `${enc({ alg: 'ES256', kid: c.keyId })}.${enc({ iss: c.teamId, iat: Math.floor(Date.now() / 1000) })}`;
  const sig = crypto.sign('sha256', Buffer.from(data), { key: c.key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  jwt = { kid: c.keyId, at: Date.now(), token: `${data}.${sig}` };
  return jwt.token;
}

function post(session, c, token, payload, msg) {
  return new Promise((resolve) => {
    const req = session.request({
      ':method': 'POST', ':path': `/3/device/${token}`, authorization: `bearer ${bearer(c)}`,
      'apns-topic': c.topic, 'apns-push-type': 'alert', 'apns-priority': '10', 'apns-expiration': String(Math.floor(Date.now() / 1000) + 86400),
      ...(msg.tag ? { 'apns-collapse-id': String(msg.tag).slice(0, 64) } : {}),
    });
    let status = 0, body = '';
    req.setTimeout(10000, () => { req.close(); resolve({ status: 0, reason: 'timeout' }); });
    req.on('response', (h) => { status = h[':status']; });
    req.on('data', (d) => { body += d; });
    req.on('end', () => resolve({ status, reason: (() => { try { return JSON.parse(body).reason; } catch { return ''; } })() }));
    req.on('error', (e) => resolve({ status: 0, reason: e.message }));
    req.end(payload);
  });
}

// No key here: the relay sends it (10 devices a request); the answers look like Apple's own.
async function viaRelay(env, tokens, payload, msg) {
  const out = [];
  for (let i = 0; i < tokens.length; i += 10) {
    const batch = tokens.slice(i, i + 10);
    try {
      const r = await fetch(`${PUSH_RELAY.replace(/\/$/, '')}/push`, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ env, tokens: batch, payload, ...(msg.tag ? { collapse: String(msg.tag).slice(0, 64) } : {}) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `relay ${r.status}`);
      out.push(...j.results.map((x, k) => ({ token: batch[k], env, status: x.status, reason: x.reason })));
    } catch (e) { out.push(...batch.map((token) => ({ token, env, status: 0, reason: e.message }))); }
  }
  return out;
}

// msg: {title, body, url?, tag?, kind?, category?, data?} — kind 'reminder' / 'checkin' is skipped for a device that rings
// those itself. category = the app's notification actions (Done, Snooze, Accept…, Gubernos/Reminders.swift); data = what they
// act on ({taskId} / {habit}), next to url in the payload.
export async function send(msg) {
  const c = config(), all = devices();
  const list = all.filter((d) => d.alerts !== false && !(msg.kind === 'reminder' && d.local?.reminders) && !(msg.kind === 'checkin' && d.local?.checkins));
  const relay = !c && PUSH_RELAY && Settings.get().relayPush !== false; // Settings → Notifications → Pushes through the relay
  if ((!c && !relay) || !list.length) return { sent: 0, devices: list.length, results: [] };
  const payload = JSON.stringify({ aps: { alert: { title: msg.title, body: msg.body || '' }, sound: 'default', ...(msg.tag ? { 'thread-id': String(msg.tag).replace(/-.*/, '') } : {}),
    ...(msg.kind === 'checkin' ? { 'interruption-level': 'time-sensitive' } : {}), ...(msg.category ? { category: msg.category } : {}) },
    ...(msg.data || {}), url: msg.url || '/#/today' });
  const results = [];
  for (const env of ['sandbox', 'production']) {
    const mine = list.filter((d) => d.env === env);
    if (!mine.length) continue;
    if (!c) { results.push(...await viaRelay(env, mine.map((d) => d.token), payload, msg)); continue; }
    const session = http2.connect(HOSTS[env]);
    session.on('error', () => {});
    try { for (const d of mine) results.push({ token: d.token, env, ...(await post(session, c, d.token, payload, msg)) }); } finally { session.close(); }
  }
  // gone: the app was deleted, or the token belongs to the other environment
  const gone = new Set(results.filter((r) => r.status === 410 || ['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic'].includes(r.reason)).map((r) => r.token));
  if (gone.size) write(DEVICES, devices().filter((d) => !gone.has(d.token)));
  for (const r of results) if (r.status !== 200) console.warn(`[apns] ${r.env} ${r.token.slice(0, 8)}… → ${r.status} ${r.reason}`);
  return { sent: results.filter((r) => r.status === 200).length, devices: list.length, results: results.map(({ token, ...r }) => ({ device: token.slice(0, 8), ...r })) };
}
