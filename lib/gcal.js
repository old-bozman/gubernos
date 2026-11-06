// Google Calendar for time-blocking tasks (plain REST; OAuth lives in google.js).
// AICODE-NOTE: events are only created after the owner confirms in the UI (calendar is always proposed, never written by an agent).
import { httpError, localDate } from './vault.js';
import { profile, minutesOf } from './config.js';
import { gfetch, authStatus } from './google.js';
import { get as settings } from './settings.js';
export { authUrl, callback, disconnect } from './google.js';

// Overridable for tests against a local stub.
const API = process.env.GUBERNOS_GCAL_API || 'https://www.googleapis.com/calendar/v3';
const CAL = process.env.GUBERNOS_GCAL_ID || 'primary';
// calendars read for busy time (Plan the day, free slots, the agent's calendar tool): the one the app writes to, plus the
// ones picked in Settings → Your Mac → Google (a work calendar shared into this account…). Blocks are only ever written to CAL.
export const readCalendars = () => [CAL, ...(settings().calendars || []).filter((id) => id !== CAL)];
// working hours in minutes: profile.md → workday (env overrides, in hours, for tests)
export const work = () => {
  const w = profile().workday;
  return { start: process.env.GUBERNOS_WORK_START ? 60 * Number(process.env.GUBERNOS_WORK_START) : minutesOf(w.start),
    end: process.env.GUBERNOS_WORK_END ? 60 * Number(process.env.GUBERNOS_WORK_END) : minutesOf(w.end) };
};

export function status() {
  const s = authStatus();
  return { configured: s.configured, shared: s.shared, connected: s.granted.calendar, gmail: s.granted.gmail, contacts: s.granted.contacts, drive: s.granted.drive, calendar: CAL, expired: s.expired, wanted: s.wanted, workHours: work(), setupFile: s.setupFile };
}
const gapi = (method, url, body) => gfetch('calendar', API, method, url, body);

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
// Local wall-clock "YYYY-MM-DDTHH:MM" (the app's format) ↔ Date. The Mac's clock/zone is the reference.
export const toLocal = (d) => `${localDate(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const fromLocal = (s) => new Date(s.length === 16 ? `${s}:00` : s);

// First free slots of `minutes` within working hours over the next `days`, starting ~15 min from now.
export async function freeSlots({ minutes = 50, days = 7, count = 6, from = null }) {
  const now = new Date();
  const start = from ? fromLocal(from) : new Date(Math.ceil((now.getTime() + 15 * 60000) / (15 * 60000)) * 15 * 60000);
  const end = new Date(start.getTime() + days * 864e5);
  const fb = await gapi('POST', '/freeBusy', { timeMin: start.toISOString(), timeMax: end.toISOString(), timeZone: tz(), items: readCalendars().map((id) => ({ id })) });
  const busy = Object.values(fb.calendars || {}).flatMap((c) => c.busy || []).map((b) => [new Date(b.start).getTime(), new Date(b.end).getTime()]);
  const slots = [], WORK = work(), mins = (d) => d.getHours() * 60 + d.getMinutes();
  const step = 15 * 60000, len = minutes * 60000;
  for (let t = start.getTime(); t + len <= end.getTime() && slots.length < count; t += step) {
    const s = new Date(t), e = new Date(t + len);
    if (mins(s) < WORK.start || mins(e) > WORK.end || localDate(s) !== localDate(e)) continue;
    if ([0, 6].includes(s.getDay()) && !process.env.GUBERNOS_WORK_WEEKENDS) continue;
    if (busy.some(([bs, be]) => t < be && t + len > bs)) continue;
    // one suggestion per half-day, so the list spreads over the week instead of 6 adjacent slots
    const half = `${localDate(s)}-${s.getHours() < 13 ? 'am' : 'pm'}`;
    if (slots.some((x) => x.half === half)) continue;
    slots.push({ start: toLocal(s), end: toLocal(e), half });
  }
  return slots.map(({ start: st, end: en }) => ({ start: st, end: en }));
}

export async function createEvent({ title, start, end, description, taskId }) {
  if (!title || !start || !end) throw httpError(400, 'title, start and end required');
  const ev = await gapi('POST', `/calendars/${encodeURIComponent(CAL)}/events`, {
    summary: `⏱ ${title}`,
    description,
    start: { dateTime: fromLocal(start).toISOString(), timeZone: tz() },
    end: { dateTime: fromLocal(end).toISOString(), timeZone: tz() },
    extendedProperties: { private: { gubernosTask: taskId || '' } },
    reminders: { useDefault: true },
  });
  return { id: ev.id, link: ev.htmlLink, start, end };
}

export async function moveEvent(id, { start, end }) {
  const ev = await gapi('PATCH', `/calendars/${encodeURIComponent(CAL)}/events/${encodeURIComponent(id)}`, {
    start: { dateTime: fromLocal(start).toISOString(), timeZone: tz() }, end: { dateTime: fromLocal(end).toISOString(), timeZone: tz() },
  });
  return { id: ev.id, link: ev.htmlLink, start, end };
}

export async function deleteEvent(id) {
  await gapi('DELETE', `/calendars/${encodeURIComponent(CAL)}/events/${encodeURIComponent(id)}`);
  return { ok: true };
}

// Events in a local range (Plan the day, the agent's calendar tool) from every calendar read. from/to: YYYY-MM-DD,
// inclusive. Another calendar's events count only when they take time: "free" (transparent) ones and declined
// invitations are left out, and a meeting that is in two calendars shows once (the app's own calendar wins).
export async function listEvents({ from, to, max = 50 }) {
  const a = new Date(`${from || localDate()}T00:00:00`), b = new Date(`${to || from || localDate()}T23:59:59`);
  const q = new URLSearchParams({ timeMin: a.toISOString(), timeMax: b.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: String(Math.min(max, 250)) });
  const lists = await Promise.all(readCalendars().map(async (id, i) => {
    try {
      const r = await gapi('GET', `/calendars/${encodeURIComponent(id)}/events?${q}`);
      return (r.items || []).filter((e) => e.status !== 'cancelled' && (i === 0 || (e.transparency !== 'transparent' && e.attendees?.find((x) => x.self)?.responseStatus !== 'declined')))
        .map((e) => ({ e, calendar: i === 0 ? null : r.summary || id }));
    } catch (err) {
      if (i === 0) throw err; // the main calendar not readable: the caller says so
      console.error(`[gcal] ${id}: ${err.message}`); return [];
    }
  }));
  const seen = new Set(), out = [];
  for (const { e, calendar } of lists.flat()) {
    const key = `${e.iCalUID || e.id}|${e.start?.dateTime || e.start?.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: e.id, title: e.summary || '(no title)', start: e.start?.dateTime ? toLocal(new Date(e.start.dateTime)) : e.start?.date, end: e.end?.dateTime ? toLocal(new Date(e.end.dateTime)) : e.end?.date,
      allDay: !e.start?.dateTime, location: e.location || null, attendees: (e.attendees || []).map((x) => x.email).slice(0, 10), link: e.htmlLink, calendar,
    });
  }
  return out.sort((x, y) => String(x.start).localeCompare(String(y.start))).slice(0, max);
}

// The account's calendars for Settings → Your Mac → Google: which are read (`on`); the app's own one is always on.
export async function listCalendars() {
  const r = await gapi('GET', '/users/me/calendarList?minAccessRole=freeBusyReader');
  const on = new Set(readCalendars());
  return (r.items || []).map((c) => ({ id: c.id, name: c.summaryOverride || c.summary || c.id, primary: !!c.primary, mine: c.accessRole === 'owner', on: (c.primary && CAL === 'primary') || on.has(c.id) }))
    .sort((x, y) => (y.primary - x.primary) || x.name.localeCompare(y.name));
}
