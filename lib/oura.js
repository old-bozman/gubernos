// Oura → the habits that take it (a habit's `auto: oura:<metric>`, lib/habits.js applyAuto), on the Mac: the Oura API v2
// with a Personal Access Token from ~/.config/gubernos/oura.json {"token": "…"} (or OURA_TOKEN). Read only.
//   steps, energy (active calories)   ← daily_activity of the day
//   mindful (min)                      ← sessions of type meditation / breathing that day
//   workout (min)                      ← workouts that day
//   wake (min after midnight)          ← the end of the night's long sleep that ended that morning (Oura's `day`)
//   bedtime (min after that midnight)  ← the start of the long sleep that ends the next morning
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR } from './config.js';
import { localDate } from './vault.js';
import { applyAuto, listHabits } from './habits.js';

const API = process.env.GUBERNOS_OURA_API || 'https://api.ouraring.com/v2/usercollection';
export function token() {
  if (process.env.OURA_TOKEN) return process.env.OURA_TOKEN;
  try { return JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'oura.json'), 'utf8')).token || null; } catch { return null; }
}
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + n); return localDate(x); };
async function get(what, start, end) {
  const r = await fetch(`${API}/${what}?start_date=${start}&end_date=${end}`, { headers: { Authorization: `Bearer ${token()}` } });
  if (!r.ok) throw new Error(`Oura ${what}: ${r.status}`);
  return (await r.json()).data || [];
}
// minutes from a day's local midnight to an ISO time (Oura gives local times with an offset)
const minsFrom = (day, iso) => Math.round((new Date(iso) - new Date(`${day}T00:00:00`)) / 60000);
const minutes = (a, b) => Math.max(0, (new Date(b) - new Date(a)) / 60000);

// {date: {metric: value}} for the dates, only the metrics some habit takes
export async function read(dates, metrics) {
  const want = new Set(metrics), start = dates.reduce((a, b) => (a < b ? a : b)), end = dates.reduce((a, b) => (a > b ? a : b));
  const out = Object.fromEntries(dates.map((d) => [d, {}]));
  if (want.has('steps') || want.has('energy')) {
    for (const x of await get('daily_activity', start, addDays(end, 1))) {
      if (!out[x.day]) continue;
      if (want.has('steps') && x.steps != null) out[x.day].steps = x.steps;
      if (want.has('energy') && x.active_calories != null) out[x.day].energy = x.active_calories;
    }
  }
  if (want.has('wake') || want.has('bedtime')) {
    const sleeps = (await get('sleep', start, addDays(end, 1))).filter((x) => x.type === 'long_sleep' || x.type === 'sleep');
    for (const d of dates) {
      const morning = sleeps.filter((x) => x.day === d).sort((a, b) => (a.bedtime_end < b.bedtime_end ? 1 : -1))[0];
      if (want.has('wake') && morning?.bedtime_end) out[d].wake = minsFrom(d, morning.bedtime_end);
      const night = sleeps.filter((x) => x.day === addDays(d, 1)).sort((a, b) => (a.bedtime_start > b.bedtime_start ? 1 : -1))[0];
      if (want.has('bedtime') && night?.bedtime_start) out[d].bedtime = minsFrom(d, night.bedtime_start);
    }
  }
  if (want.has('mindful')) {
    for (const x of await get('session', start, end)) {
      if (out[x.day] && ['meditation', 'breathing', 'relaxation'].includes(x.type)) out[x.day].mindful = (out[x.day].mindful || 0) + minutes(x.start_datetime, x.end_datetime);
    }
  }
  if (want.has('workout')) {
    for (const x of await get('workout', start, end)) if (out[x.day]) out[x.day].workout = (out[x.day].workout || 0) + minutes(x.start_datetime, x.end_datetime);
  }
  return out;
}

// Yesterday and today → applyAuto (the notifier calls it every hour; POST /api/oura/sync to run it now).
export async function sync(now = new Date()) {
  if (!token()) return { skipped: 'no Oura token (~/.config/gubernos/oura.json)' };
  const metrics = [...new Set(listHabits().filter((h) => h.auto?.source === 'oura').map((h) => h.auto.metric))];
  if (!metrics.length) return { skipped: 'no habit takes Oura' };
  const today = localDate(now), dates = [addDays(today, -1), today];
  const values = await read(dates, metrics);
  return { applied: dates.flatMap((d) => applyAuto({ date: d, source: 'oura', values: values[d] }).applied.map((x) => ({ date: d, ...x }))) };
}
