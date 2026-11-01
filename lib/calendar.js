// The calendar Plan the day reads and writes time blocks to: the Mac's own calendars (Calendar.app, through EventKit —
// lib/maccal.js; nothing to set up but one "Allow") or Google Calendar (lib/gcal.js; the owner's own OAuth client).
// Settings → Calendar picks one (calendarSource); not picked: Google when it is connected, else the Mac's.
// Everything else (server routes, the planner, the agents' calendar tool) goes through here.
import * as Google from './gcal.js';
import * as Mac from './maccal.js';
import { get as settings } from './settings.js';

export const source = () => {
  const s = settings().calendarSource;
  if (s === 'google' || s === 'macos') return s;
  return Google.status().connected || process.platform !== 'darwin' ? 'google' : 'macos';
};
const C = () => (source() === 'macos' ? Mac : Google);

export const readCalendars = () => C().readCalendars();
export const listEvents = (a) => C().listEvents(a);
export const listCalendars = () => C().listCalendars();
export const createEvent = (a) => C().createEvent(a);
export const moveEvent = (id, a) => C().moveEvent(id, a);
export const deleteEvent = (id) => C().deleteEvent(id);
export const freeSlots = (a) => C().freeSlots({ ...a, work: Google.work() });

// Settings and the time-block picker: which source, whether it works, and Google's own state (Gmail, Contacts, Drive
// stay Google's either way).
export async function status() {
  const g = Google.status(), src = source();
  const mac = process.platform === 'darwin' ? await Mac.access() : 'unavailable';
  return { ...g, googleCalendar: g.connected, source: src, chosen: settings().calendarSource || null, macAccess: mac,
    connected: src === 'macos' ? mac === 'full' : g.connected };
}
export const requestMacAccess = () => Mac.request();
export const prepare = () => Mac.prepare();
