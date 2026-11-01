// Google OAuth (loopback, no SDK) shared by Calendar and Gmail.
// Setup: an OAuth client JSON (Desktop, or Web with the callback URI below) at ~/.config/gubernos/google_oauth_client.json,
// then open http://127.0.0.1:4747/api/gcal/connect ON THE MAC once. The refresh token is kept next to it.
// AICODE-NOTE: adding a scope needs one re-connect; status().missing lists scopes the saved token lacks.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { httpError } from './vault.js';
import { PORT, GOOGLE_SCOPES, CONFIG_DIR } from './config.js';

const DIR = process.env.GUBERNOS_GOOGLE_DIR || CONFIG_DIR;
const TOKEN_URL = process.env.GUBERNOS_GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
export const CLIENT_FILE = path.join(DIR, 'google_oauth_client.json');
const TOKEN_FILE = path.join(DIR, 'google_calendar_token.json'); // historical name; holds all Google scopes
const REDIRECT = `http://127.0.0.1:${PORT}/api/gcal/callback`;
export const SCOPES = {
  calendar: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.freebusy'],
  gmail: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose'],
  // read-only, for the agents (gubernos-tools): who is this / their address; documents a task refers to
  contacts: ['https://www.googleapis.com/auth/contacts.readonly', 'https://www.googleapis.com/auth/contacts.other.readonly'],
  drive: ['https://www.googleapis.com/auth/drive.readonly'],
};
const ALL = Object.entries(SCOPES).filter(([k]) => GOOGLE_SCOPES.includes(k)).flatMap(([, v]) => v);
let oauthState = null;

function client() {
  if (!fs.existsSync(CLIENT_FILE)) return null;
  const j = JSON.parse(fs.readFileSync(CLIENT_FILE, 'utf8'));
  const c = j.installed || j.web || j;
  return c.client_id && c.client_secret ? c : null;
}
const readToken = () => (fs.existsSync(TOKEN_FILE) ? JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')) : null);
function saveToken(t) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(t, null, 1), { mode: 0o600 });
}

// {configured, connected, granted: {calendar, gmail}}
export function authStatus() {
  const t = readToken();
  const have = new Set(String(t?.scope || '').split(/\s+/));
  const granted = Object.fromEntries(Object.entries(SCOPES).map(([k, v]) => [k, !!t?.refresh_token && v.every((s) => have.has(s))]));
  // expired: Google refused the refresh token (Testing-mode clients expire after 7 days; access withdrawn) → reconnect
  return { configured: !!client(), connected: !!t?.refresh_token && !t?.expired, expired: t?.expired || null, granted, wanted: GOOGLE_SCOPES, setupFile: CLIENT_FILE };
}

export function authUrl() {
  const c = client();
  if (!c) throw httpError(400, `No OAuth client. Put the Google OAuth client JSON at ${CLIENT_FILE}`);
  oauthState = crypto.randomBytes(12).toString('hex');
  const q = new URLSearchParams({ client_id: c.client_id, redirect_uri: REDIRECT, response_type: 'code', scope: ALL.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: oauthState });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export async function callback({ code, state }) {
  if (!code || state !== oauthState) throw httpError(400, 'OAuth state mismatch — start again from /api/gcal/connect');
  const c = client();
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: c.client_id, client_secret: c.client_secret, redirect_uri: REDIRECT, grant_type: 'authorization_code' }) });
  const j = await r.json();
  if (!r.ok || !j.refresh_token) throw httpError(502, `token exchange failed: ${j.error_description || j.error || 'no refresh token'}`);
  saveToken({ ...j, expires_at: Date.now() + (j.expires_in - 60) * 1000 });
  oauthState = null;
}

export const accessTokenFor = (what) => accessToken(what);
async function accessToken(what) {
  const t = readToken();
  if (!t?.refresh_token) throw httpError(409, `Google (${what}) is not connected — open /api/gcal/connect on the Mac`);
  if (t.access_token && t.expires_at > Date.now()) return t.access_token;
  const c = client();
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: t.refresh_token, grant_type: 'refresh_token' }) });
  const j = await r.json();
  if (!r.ok) {
    if (j.error === 'invalid_grant') saveToken({ ...readToken(), expired: new Date().toISOString() }); // noticed by notify.js → push
    throw httpError(j.error === 'invalid_grant' ? 409 : 502, j.error === 'invalid_grant'
      ? `Google connection expired — reconnect on the Mac: http://127.0.0.1:${PORT}/api/gcal/connect` : `token refresh failed: ${j.error_description || j.error}`);
  }
  const { expired: _gone, ...rest } = readToken();
  saveToken({ ...rest, access_token: j.access_token, expires_at: Date.now() + (j.expires_in - 60) * 1000 });
  return j.access_token;
}

// Authorized JSON call. what = 'calendar' | 'gmail' (for messages and the scope check).
export async function gfetch(what, base, method, url, body) {
  if (!authStatus().granted[what] && readToken()?.refresh_token && !readToken()?.expired) {
    throw httpError(409, `Google ${what} access not granted yet — re-connect once: open http://127.0.0.1:${PORT}/api/gcal/connect on the Mac`);
  }
  const r = await fetch(`${base}${url}`, {
    method, headers: { Authorization: `Bearer ${await accessToken(what)}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw httpError(r.status === 401 ? 409 : r.status === 404 ? 404 : 502, `Google ${what}: ${j.error?.message || r.status}`);
  return j;
}
