// Web Push (RFC 8030/8291/8292) with node:crypto only: VAPID auth + aes128gcm payload encryption.
// Works for the home-screen web app on iOS 16.4+ and desktop browsers. Subscriptions live in data/push-subs.json.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PUBLIC_URL, CONFIG_DIR } from './config.js';
import { get as settings } from './settings.js';
import * as Apns from './apns.js';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = process.env.GUBERNOS_DATA_DIR || path.join(ROOT, 'data');
const SUBS = path.join(DATA, 'push-subs.json');
const KEYS = path.join(process.env.GUBERNOS_GOOGLE_DIR || CONFIG_DIR, 'vapid.json');
// AICODE-NOTE: VAPID "sub" must be a mailto: or https URL; the app's own URL avoids handing out an address.
const SUBJECT = PUBLIC_URL?.startsWith('https:') ? PUBLIC_URL : 'mailto:gubernos@example.com';

const b64u = (b) => Buffer.from(b).toString('base64url');
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const write = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 1), { mode: 0o600 }); };

function vapid() {
  let k = read(KEYS, null);
  if (!k) {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    k = { jwk: privateKey.export({ format: 'jwk' }) };
    write(KEYS, k);
  }
  const pub = Buffer.concat([Buffer.from([4]), Buffer.from(k.jwk.x, 'base64url'), Buffer.from(k.jwk.y, 'base64url')]);
  return { key: crypto.createPrivateKey({ key: k.jwk, format: 'jwk' }), pub: b64u(pub) };
}
export const publicKey = () => vapid().pub;

export const subscriptions = () => read(SUBS, []);
export const deviceCount = () => subscriptions().length + Apns.devices().length; // web + iPhone app
export function subscribe(sub, ua = '') {
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) throw Object.assign(new Error('bad subscription'), { status: 400 });
  const list = subscriptions().filter((s) => s.endpoint !== sub.endpoint);
  list.push({ endpoint: sub.endpoint, keys: sub.keys, ua: String(ua).slice(0, 80), at: new Date().toISOString() });
  write(SUBS, list);
  return { ok: true, devices: list.length };
}
export function unsubscribe(endpoint) {
  write(SUBS, subscriptions().filter((s) => s.endpoint !== endpoint));
  return { ok: true };
}

// RFC 8291: one aes128gcm record.
export function encrypt(payload, { p256dh, auth }) {
  const ua = Buffer.from(p256dh, 'base64url');
  const ecdh = crypto.createECDH('prime256v1');
  const asPub = ecdh.generateKeys();
  const shared = ecdh.computeSecret(ua);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.from(auth, 'base64url'), Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPub]), 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const head = Buffer.alloc(21); salt.copy(head); head.writeUInt32BE(4096, 16); head[20] = 65;
  return Buffer.concat([head, asPub, body]);
}

function jwt(aud, key) {
  const enc = (o) => b64u(JSON.stringify(o));
  const data = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT })}`;
  return `${data}.${b64u(crypto.sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' }))}`;
}

// msg: {title, body, url?, tag?, kind?}. Sends to every subscribed device — Web Push, and APNs to the iPhone app
// (lib/apns.js; kind 'reminder' / 'checkin' skips a phone that rings those itself); drops expired subscriptions.
// Settings → Time format am / pm: "16:30" in a push reads "4:30pm" (the app rewrites its screens the same way).
const clock = (t) => (typeof t === 'string' && settings().clock === '12h'
  ? t.replace(/\b([01]\d|2[0-3]):([0-5]\d)\b(?!\s?[ap]m)/g, (_, h, m) => `${+h % 12 || 12}${m === '00' ? '' : `:${m}`}${+h < 12 ? 'am' : 'pm'}`) : t);
export async function sendAll(msg) {
  msg = { ...msg, title: clock(msg.title), body: clock(msg.body) };
  const { key, pub } = vapid();
  const subs = subscriptions();
  const results = await Promise.all(subs.map(async (s) => {
    try {
      const r = await fetch(s.endpoint, {
        method: 'POST',
        headers: { Authorization: `vapid t=${jwt(new URL(s.endpoint).origin, key)}, k=${pub}`, TTL: '86400', Urgency: 'normal',
          'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream' },
        body: encrypt(JSON.stringify(msg), s.keys),
      });
      return { endpoint: s.endpoint, status: r.status, gone: r.status === 404 || r.status === 410 };
    } catch (e) { return { endpoint: s.endpoint, status: 0, error: e.message }; }
  }));
  const gone = new Set(results.filter((r) => r.gone).map((r) => r.endpoint));
  if (gone.size) write(SUBS, subscriptions().filter((s) => !gone.has(s.endpoint)));
  const apns = await Apns.send(msg).catch((e) => ({ sent: 0, devices: 0, results: [{ error: e.message }] }));
  return { sent: results.filter((r) => r.status >= 200 && r.status < 300).length + apns.sent, devices: subs.length + apns.devices,
    results: [...results.map(({ endpoint, ...r }) => ({ host: new URL(endpoint).host, ...r })), ...apns.results.map((r) => ({ host: 'apns', ...r }))] };
}
