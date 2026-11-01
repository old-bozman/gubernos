// The Mac's own calendars (Calendar.app: iCloud, Google, Exchange… whatever the owner added there) through EventKit:
// Plan the day without a Google Cloud project. The work is done by a small Swift helper (tools/calendar/main.swift),
// built here on first use with Apple's Command Line Tools into ~/.gubernos/bin and rebuilt when its source changes.
// Same functions as lib/gcal.js; lib/calendar.js picks one of the two.
// AICODE-NOTE: macOS asks for access once (a system dialog on the Mac: Settings → Calendar → Allow). The access belongs to
// the helper binary, so a rebuild (a new binary) may ask again.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { httpError, localDate } from './vault.js';
import { get as settings } from './settings.js';

const SRC = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'tools', 'calendar');
const BIN = process.env.GUBERNOS_MACCAL_BIN || path.join(process.env.GUBERNOS_BIN_DIR || path.join(os.homedir(), '.gubernos', 'bin'), 'gubernos-calendar');
const STAMP = `${BIN}.src`;

const srcHash = () => crypto.createHash('sha256').update(fs.readFileSync(path.join(SRC, 'main.swift'))).update(fs.readFileSync(path.join(SRC, 'Info.plist'))).digest('hex').slice(0, 16);
const exec = (cmd, args, timeout) => new Promise((ok, no) => {
  execFile(cmd, args, { timeout, maxBuffer: 2e7 }, (e, out, err) => (e && !out ? no(Object.assign(new Error(String(err || e.message).trim().slice(0, 400)), { code: e.code })) : ok({ out: String(out), code: e?.code ?? 0 })));
});

let building = null;
async function ensureBuilt() {
  if (process.env.GUBERNOS_MACCAL_BIN) return; // tests: a stand-in
  const want = srcHash();
  if (fs.existsSync(BIN) && fs.existsSync(STAMP) && fs.readFileSync(STAMP, 'utf8').trim() === want) return;
  building ||= (async () => {
    if (process.platform !== 'darwin') throw httpError(501, 'the Mac’s calendars need macOS');
    fs.mkdirSync(path.dirname(BIN), { recursive: true });
    const tmp = `${BIN}.new`;
    try {
      await exec('swiftc', ['-O', path.join(SRC, 'main.swift'), '-o', tmp, '-Xlinker', '-sectcreate', '-Xlinker', '__TEXT', '-Xlinker', '__info_plist', '-Xlinker', path.join(SRC, 'Info.plist')], 300000);
    } catch (e) {
      throw httpError(501, /ENOENT|not found|xcrun/i.test(e.message) ? 'the Mac’s calendars need Apple’s Command Line Tools: run xcode-select --install in Terminal' : `couldn’t build the calendar helper: ${e.message}`);
    }
    await exec('codesign', ['-s', '-', '-f', '--identifier', 'app.gubernos.calendar', tmp], 60000).catch(() => {});
    fs.renameSync(tmp, BIN);
    fs.writeFileSync(STAMP, want);
    console.log('[maccal] built', BIN);
  })().finally(() => { building = null; });
  await building;
}

// on the server's start: build now, so the first Plan the day doesn't wait for the compiler
export const prepare = () => (process.platform === 'darwin' ? ensureBuilt().catch((e) => console.error('[maccal]', e.message)) : null);

async function helper(...args) {
  await ensureBuilt();
  const { out } = await exec(BIN, args, 60000).catch((e) => ({ out: JSON.stringify({ error: e.message }) }));
  let r;
  try { r = JSON.parse(out.trim().split('\n').pop()); } catch { throw httpError(502, `calendar helper: ${out.slice(0, 200)}`); }
  if (r && r.error) throw httpError(/no access/.test(r.error) ? 403 : /not found/.test(r.error) ? 404 : 502, r.error);
  return r;
}

// access: full | notDetermined | denied | restricted | writeOnly (cached a minute; Allow in Settings refreshes it)
let accessCache = null;
export async function access(fresh = false) {
  if (!fresh && accessCache && Date.now() - accessCache.at < 60e3) return accessCache.value;
  let value;
  try { value = (await helper('status')).access; } catch (e) { value = `error: ${e.message}`; }
  accessCache = { at: Date.now(), value };
  return value;
}
// the system dialog (on the Mac's screen); → the access after it
export async function request() {
  const r = await helper('request');
  accessCache = { at: Date.now(), value: r.access };
  return r.access;
}

export const writeCalendar = () => settings().macCalendar || ''; // '' = Calendar.app's default for new events
export const readCalendars = () => settings().macCalendars || []; // [] = all

export async function status() {
  const a = await access();
  return { source: 'macos', connected: a === 'full', access: a };
}

export async function listCalendars() {
  const all = await helper('calendars'), read = readCalendars(), w = writeCalendar();
  return all.map((c) => ({ id: c.id, name: c.title, account: c.source, writable: c.writable, primary: w ? c.id === w : c.default, on: !read.length || read.includes(c.id) || (w ? c.id === w : c.default) }))
    .sort((x, y) => (y.primary - x.primary) || x.account.localeCompare(y.account) || x.name.localeCompare(y.name));
}

// Events in a local range, every calendar read. Like lib/gcal.js: another calendar's event counts only when it takes time
// (not "free", not declined); the calendar time blocks go to counts as is.
export async function listEvents({ from, to, max = 50 }) {
  const a = `${from || localDate()}T00:00`, b = `${to || from || localDate()}T23:59`;
  const read = readCalendars(), w = writeCalendar();
  const ids = read.length ? [...new Set([...read, ...(w ? [w] : [])])].join(',') : '';
  const list = await helper('events', a, b, ...(ids ? [ids] : []));
  const mainId = w || null; // the calendar blocks go to: shown as is (Calendar.app's default: like any other)
  return list.filter((e) => e.calendarId === mainId || (!e.free && !e.declined))
    .map((e) => ({ id: e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay, location: e.location, attendees: e.attendees, link: e.url, calendar: e.calendarId === mainId ? null : e.calendar }))
    .sort((x, y) => String(x.start).localeCompare(String(y.start))).slice(0, max);
}

export async function createEvent({ title, start, end, description, taskId: _ }) {
  if (!title || !start || !end) throw httpError(400, 'title, start and end required');
  const link = String(description || '').match(/^https?:\/\/\S+/)?.[0] || '';
  const r = await helper('create', writeCalendar(), start, end, `⏱ ${title}`, description || '', link);
  return { id: r.id, link: null, start, end };
}
export async function moveEvent(id, { start, end }) {
  const r = await helper('move', id, start, end);
  return { id: r.id, link: null, start, end };
}
export async function deleteEvent(id) {
  await helper('delete', id);
  return { ok: true };
}

// First free slots of `minutes` in working hours over the next `days` (the time-block picker), from the events read.
export async function freeSlots({ minutes = 50, days = 7, count = 6, from = null, work }) {
  const now = new Date();
  const start = from ? new Date(`${from}:00`) : new Date(Math.ceil((now.getTime() + 15 * 60000) / (15 * 60000)) * 15 * 60000);
  const end = new Date(start.getTime() + days * 864e5);
  const events = await listEvents({ from: localDate(start), to: localDate(end), max: 500 });
  const busy = events.filter((e) => !e.allDay).map((e) => [new Date(`${e.start}:00`).getTime(), new Date(`${e.end}:00`).getTime()]);
  const slots = [], mins = (d) => d.getHours() * 60 + d.getMinutes(), len = minutes * 60000;
  const loc = (d) => `${localDate(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  for (let t = start.getTime(); t + len <= end.getTime() && slots.length < count; t += 15 * 60000) {
    const s = new Date(t), e = new Date(t + len);
    if (mins(s) < work.start || mins(e) > work.end || localDate(s) !== localDate(e)) continue;
    if ([0, 6].includes(s.getDay()) && !process.env.GUBERNOS_WORK_WEEKENDS) continue;
    if (busy.some(([bs, be]) => t < be && t + len > bs)) continue;
    const half = `${localDate(s)}-${s.getHours() < 13 ? 'am' : 'pm'}`; // one per half-day: spread over the week
    if (slots.some((x) => x.half === half)) continue;
    slots.push({ start: loc(s), end: loc(e), half });
  }
  return slots.map(({ start: st, end: en }) => ({ start: st, end: en }));
}
