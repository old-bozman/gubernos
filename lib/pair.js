// Pairing: who may use this Mac's app from another device. The Mac itself (a browser on 127.0.0.1) always may; a phone
// or another computer comes through Tailscale serve (or any proxy) and needs the pairing token — the iPhone app sends it
// as a header, a browser keeps it in a cookie. The token reaches a device once, from the Mac's Settings → Pair a device:
// a QR code the iPhone's camera opens in the app (gubernos://pair?url=…&token=…), or a link for a browser
// (<publicUrl>/pair?t=…). New token = every device unpaired.
// While `required` is off (an install from before pairing, until its devices are paired) every request is let through.
// State: ~/.config/gubernos/pair.json {token, required}; GUBERNOS_PAIR_FILE moves it (the test server).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CONFIG_DIR, PUBLIC_URL } from './config.js';

const FILE = process.env.GUBERNOS_PAIR_FILE || path.join(CONFIG_DIR, 'pair.json');
const COOKIE = 'gubernos_token';
const newToken = () => crypto.randomBytes(24).toString('base64url');

function read() {
  try { const s = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (s.token) return s; } catch { /* first use */ }
  return save({ token: newToken(), required: false });
}
function save(s) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, `${JSON.stringify(s, null, 1)}\n`, { mode: 0o600 });
  return s;
}

// Straight from the Mac: the loopback address, no proxy in between, and the page opened as 127.0.0.1 / localhost.
export function isLocal(req) {
  const ip = req.socket.remoteAddress || '';
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip) && !req.headers['x-forwarded-for']
    && /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(req.headers.host || '');
}

const same = (a, b) => typeof a === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
function presented(req) {
  const bearer = String(req.headers.authorization || '').match(/^Bearer\s+(\S+)/i)?.[1];
  const cookie = String(req.headers.cookie || '').split(/;\s*/).map((c) => c.match(/^gubernos_token=(.*)$/)?.[1]).find(Boolean);
  return bearer || req.headers['x-gubernos-token'] || cookie || null;
}
export const paired = (req) => same(presented(req), read().token);

// server.log: who was turned away and why (once a minute per device and reason, so a polling device doesn't flood it)
const logged = new Map();
function note(req, what) {
  const who = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?').split(',')[0].trim();
  const key = `${who} ${what}`;
  if (Date.now() - (logged.get(key) || 0) < 60e3) return;
  logged.set(key, Date.now());
  console.log(`[pair] ${who} ${what} · ${String(req.headers['user-agent'] || '').slice(0, 80)}`);
}
// icons and the manifest show nothing private, and browsers fetch them without cookies (Safari's apple-touch-icon, Add to Dock)
const PUBLIC = /^\/(favicon\.ico|apple-touch-icon[\w-]*\.png|icons\/[\w.-]+|manifest\.webmanifest)$/;
export const allowed = (req) => !read().required || isLocal(req) || PUBLIC.test(new URL(req.url, 'http://x').pathname) || paired(req);

// What Settings shows: the links for the QR code / a browser; the token itself only to someone already allowed in
export function info(req) {
  const s = read(), url = PUBLIC_URL;
  return {
    required: !!s.required, local: isLocal(req), publicUrl: url,
    appLink: url ? `gubernos://pair?url=${encodeURIComponent(url)}&token=${s.token}` : null,
    webLink: url ? `${url}/pair?t=${s.token}` : null,
  };
}
export const setRequired = (on) => save({ ...read(), required: !!on });
export const rotate = () => save({ ...read(), token: newToken() });

// GET /pair?t=<token>: a browser on another device gets the cookie and goes to the app. `t` may also be a whole pairing
// link pasted into the form below (a Safari web app in the Dock keeps its own cookies, so it is paired from inside it).
export function pairPage(req, res, url) {
  let t = (url.searchParams.get('t') || '').trim();
  t = decodeURIComponent(t.match(/[?&](?:t|token)=([^&\s#]+)/)?.[1] || t);
  if (!same(t, read().token)) { note(req, `/pair with a wrong code (${t.length} chars)`); return page(res, 403, 'This pairing link is not valid any more. On your Mac: Settings → Connections → Pair a device, then paste the new link.', true); }
  note(req, 'paired by link');
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.writeHead(302, { 'Set-Cookie': `${COOKIE}=${t}; Path=/; Max-Age=315360000; HttpOnly; SameSite=Lax${secure}`, Location: '/' }).end();
}

// a request that isn't allowed: JSON for the API, a short page for a browser
export function deny(req, res, url) {
  note(req, `not paired: ${req.method} ${url.pathname} (${presented(req) ? 'wrong token' : 'no token'})`);
  if (url.pathname.startsWith('/api/')) return res.writeHead(401, { 'Content-Type': 'application/json' }).end('{"error":"not paired: on your Mac open Settings → Connections → Pair a device"}');
  return page(res, 401, 'This device is not paired with your Mac yet. On the Mac: Settings → Connections → <b>Pair a device</b>, then scan the code with this phone’s camera, or <b>Copy link</b> and paste it here.', true);
}
const FORM = `<form action="/pair" style="display:flex;gap:8px;margin-top:20px"><input name="t" required autofocus placeholder="Paste the pairing link"
  style="flex:1;font:inherit;padding:8px 10px;border:1px solid #bbb;border-radius:8px"><button style="font:inherit;padding:8px 16px;border-radius:8px">Pair</button></form>`;
const page = (res, status, html, form) => res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  .end(`<!doctype html><meta name="viewport" content="width=device-width"><title>Gubernos</title><body style="font:16px/1.5 system-ui;padding:40px;max-width:560px;margin:auto"><h2>Gubernos</h2><p>${html}</p>${form ? FORM : ''}</body>`);
