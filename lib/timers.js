// Countdown timers for habits measured in minutes (Sun greeting, Clear your mind 30 min; a habit's `timer` length comes
// from lib/habits.js). Started from the Protocol screen or the watch, kept here (data/habit-timers.json) and finished by
// the Mac at the end: the minutes are added to the day's check-in (checkIn value) and a push says so (not for a watch
// timer — the watch rings its own). Stopping early adds the minutes so far; cancelling adds nothing.
// Every call is idempotent by the timer's id, because the watch's queue (through the iPhone's outbox) may replay a start
// after its end (→ finished at once, with the full minutes) and a stop after that (→ corrected to the minutes it ran).
import fs from 'node:fs';
import path from 'node:path';
import { listHabits, checkIn } from './habits.js';
import * as Daily from './daily.js';
import { localDate, httpError } from './vault.js';
import { sendAll } from './push.js';

const DATA = process.env.GUBERNOS_DATA_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data');
const FILE = path.join(DATA, 'habit-timers.json');
const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; } };
const save = (l) => { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(l, null, 1)); };
const armed = new Map();
let onChange = () => {};

// today's timers (running first), for the page and the watch
export function list() {
  const today = localDate();
  return read().filter((t) => t.date === today || t.state === 'running').sort((a, b) => (a.state === 'running' ? 0 : 1) - (b.state === 'running' ? 0 : 1) || b.start.localeCompare(a.start));
}

// Mindful sessions for Apple Health: the finished timers of habits filled in from it (auto: health:mindful), of the
// last 3 days, which the iPhone writes to Health as mindful minutes (once each, by id: Gubernos/Health.swift). Cancelled
// ones are listed too, so a session written before is taken back. Health's total then includes the timer's minutes,
// and applyAuto keeps the larger of the two, so nothing counts twice.
export function healthSessions() {
  const mindful = new Set(listHabits().filter((h) => h.auto?.spec === 'health:mindful').map((h) => h.slug));
  return read().filter((t) => mindful.has(t.slug) && t.state !== 'running')
    .map((t) => (t.state === 'cancelled' || !(t.logged > 0)
      ? { id: t.id, cancelled: true }
      : { id: t.id, title: t.title, start: t.start, end: t.state === 'stopped' ? t.stopped : t.end }));
}

// minutes → the day's value for the habit (what's there + delta), as a check-in
function addMinutes(slug, date, delta) {
  if (!delta) return;
  const entry = Daily.getHabits(date).flatMap((g) => g.entries).find((e) => e.slug === slug);
  const base = entry && !entry.skipped && !entry.minimum && entry.value != null ? entry.value : 0;
  const v = Math.max(0, Math.round((base + delta) * 10) / 10);
  try { checkIn(slug, v > 0 ? { date, value: v } : { date, clear: true }); } catch (e) { console.warn('[timers]', slug, e.message); }
}

function update(id, fn) {
  const all = read(), t = all.find((x) => x.id === id);
  if (!t) throw httpError(404, 'no such timer');
  const out = fn(t);
  save(all);
  onChange();
  return out ?? t;
}

function finish(id) {
  armed.delete(id);
  let done = null;
  update(id, (t) => {
    if (t.state !== 'running') return;
    t.state = 'done'; t.logged = t.minutes;
    addMinutes(t.slug, t.date, t.minutes);
    done = t;
  });
  if (done && done.from !== 'watch') sendAll({ title: `✓ ${done.title} · ${done.minutes} min`, body: 'Timer done — counted for today', url: '/#/day', tag: `timer-${done.slug}`, kind: 'timer' }).catch(() => {});
}

function arm(t) {
  clearTimeout(armed.get(t.id));
  const ms = new Date(t.end).getTime() - Date.now();
  if (ms <= 0) return finish(t.id);
  armed.set(t.id, setTimeout(() => finish(t.id), Math.min(ms, 2 ** 31 - 1)));
}

// {id?, start? (ISO, when it was started on the watch), minutes, from?: 'app' | 'watch'}
export function start(slug, b = {}) {
  const h = listHabits().find((x) => x.slug === slug);
  if (!h) throw httpError(404, `no active habit ${slug}`);
  const minutes = Math.round(Number(b.minutes || h.timer || 0));
  if (!(minutes >= 1 && minutes <= 240)) throw httpError(400, 'minutes: 1–240');
  const id = /^[\w.-]{6,64}$/.test(b.id || '') ? b.id : `${Date.now().toString(36)}-${slug}`.slice(0, 64);
  const have = read().find((x) => x.id === id);
  if (have) return have;
  const at = b.start && !Number.isNaN(Date.parse(b.start)) ? new Date(b.start) : new Date();
  // one timer per habit: an older one still running is stopped (its minutes so far count)
  for (const o of read().filter((x) => x.slug === slug && x.state === 'running')) stop(o.id, { at: at.toISOString() });
  const t = { id, slug, title: h.title, date: localDate(at), start: at.toISOString(), minutes, end: new Date(at.getTime() + minutes * 60e3).toISOString(),
    from: b.from === 'watch' ? 'watch' : 'app', state: 'running', logged: 0 };
  save([...read().filter((x) => Date.now() - Date.parse(x.start) < 3 * 864e5), t]);
  onChange();
  arm(t);
  return read().find((x) => x.id === id);
}

// stopped early: the minutes it ran count (at = when it was stopped, for a stop that waited in a queue)
export function stop(id, { at } = {}) {
  clearTimeout(armed.get(id)); armed.delete(id);
  return update(id, (t) => {
    if (t.state === 'cancelled') return;
    const when = Math.min(at && !Number.isNaN(Date.parse(at)) ? Date.parse(at) : Date.now(), Date.parse(t.end));
    const ran = Math.max(0, Math.round((when - Date.parse(t.start)) / 60e3));
    addMinutes(t.slug, t.date, ran - (t.logged || 0));
    t.state = 'stopped'; t.logged = ran; t.stopped = new Date(when).toISOString();
  });
}

// never mind: nothing counts (minutes already added by a finish are taken back)
export function cancel(id) {
  clearTimeout(armed.get(id)); armed.delete(id);
  return update(id, (t) => {
    addMinutes(t.slug, t.date, -(t.logged || 0));
    t.state = 'cancelled'; t.logged = 0;
  });
}

// at boot: running timers are armed again (ended ones finish now)
export function boot(changed = () => {}) {
  onChange = changed;
  for (const t of read().filter((x) => x.state === 'running')) arm(t);
}
