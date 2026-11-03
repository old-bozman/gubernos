// Habits and the AM / PM protocols that frame the day (vault 05_model/habits/, 05_model/protocols/; schemas in the
// vault's CLAUDE.md → "Personal Model"). The app reads them; check-ins go to the day's file, ## Habits (lib/daily.js).
// The whole module can be switched off (Settings → habits): then nothing here shows and the workday is profile.md's.
import fs from 'node:fs';
import path from 'node:path';
import fsx from 'node:fs';
import { readDoc, writeDoc, localDate, httpError, getTask, VAULT, slugify, DIRS as VDIRS } from './vault.js';
import { MODEL, titleOf, section, weekStartDate } from './model.js';
import { profile, offWorkOn, PROFILE } from './config.js';
import * as Settings from './settings.js';
import * as Daily from './daily.js';

const DIRS = { habits: path.join(MODEL, 'habits'), protocols: path.join(MODEL, 'protocols') };
const CHECKINS = ['reflection', 'next-one', 'by-reflection'];

// History as stats only (vault 50_reviews/habit-stats.csv, one row per habit; scripts/import-habit-stats.mjs fills it
// from a Habit Tracker export): since, through (the last day it covers), days done / days, best streak, the streak that
// ends at `through`, and the last 28 days as 1/0. After `through` the daily files are the record.
export const STATS_FILE = path.join(VAULT, '50_reviews', 'habit-stats.csv');
export const STATS_HEADER = 'habit,name,since,through,done,days,best,streak,recent';
const q = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
export const statsLine = (x) => [x.slug, x.name, x.since, x.through, x.done, x.days, x.best, x.streak, x.recent].map(q).join(',');
export function readStats() {
  let text;
  try { text = fsx.readFileSync(STATS_FILE, 'utf8'); } catch { return {}; }
  const out = {};
  for (const line of text.split('\n').slice(1).filter(Boolean)) {
    const cells = []; let cur = '', qq = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (qq) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') qq = false; else cur += ch; } else if (ch === '"') qq = true; else if (ch === ',') { cells.push(cur); cur = ''; } else cur += ch;
    }
    cells.push(cur);
    const [slug, name, since, through, done, days, best, streak, recent] = cells;
    if (slug && /^\d{4}-\d{2}-\d{2}$/.test(through)) out[slug] = { name, since, through, done: +done || 0, days: +days || 0, best: +best || 0, streak: +streak || 0, recent: recent || '' };
  }
  return out;
}
export const enabled = () => Settings.get().habits !== false;

const str = (v) => (v === null || v === undefined || v === '' ? null : String(v));
const slugOf = (v) => { const s = str(v); return s ? s.replace(/^\[\[|\]\]$/g, '').split('|')[0].trim() : null; };
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(slugOf).filter(Boolean);
const title = (body, slug) => (body.match(/^\s*#\s+(.+)$/m)?.[1] || slug).trim();
const hm = (v) => (/^\d{1,2}:\d{2}$/.test(str(v) || '') ? str(v).padStart(5, '0') : null);
const mdFiles = (dir) => { try { return fs.readdirSync(dir).filter((f) => f.endsWith('.md') && !f.startsWith('.')); } catch { return []; } };
const read = (file) => { try { return readDoc(file); } catch { return null; } };
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// Protocols in time order: {slug, title, window {start, end} | null, habits: [slug] in the body's order}
// 05_model/protocols/day.md (no window) is not a protocol: it only keeps the order of the habits without one (Day).
const DAY_ORDER = 'day';
const listOrder = (body) => [...body.matchAll(/^\s*- \[\[([^\]|]+)(?:\|[^\]]*)?\]\]/gm)].map((m) => m[1].trim());
function dayOrder() { const d = read(path.join(DIRS.protocols, `${DAY_ORDER}.md`)); return d ? listOrder(d.body) : []; }
export function listProtocols() {
  return mdFiles(DIRS.protocols).filter((f) => f !== `${DAY_ORDER}.md`).map((f) => {
    const d = read(path.join(DIRS.protocols, f));
    if (!d || d.fm.type !== 'protocol') return null;
    const slug = path.basename(f, '.md'), w = d.fm.window || {};
    const window = hm(w.start) && hm(w.end) ? { start: hm(w.start), end: hm(w.end) } : null;
    return { slug, title: title(d.body, slug), window, habits: listOrder(d.body), file: `05_model/protocols/${f}` };
  }).filter(Boolean).sort((a, b) => (a.window?.start || '99').localeCompare(b.window?.start || '99'));
}

// Active habits, in protocol order (then the rest by title).
export function listHabits(protocols = listProtocols(), { any = false } = {}) {
  const all = mdFiles(DIRS.habits).map((f) => {
    const d = read(path.join(DIRS.habits, f));
    if (!d || d.fm.type !== 'habit' || (!any && (str(d.fm.status) || 'active') !== 'active')) return null;
    const slug = path.basename(f, '.md'), fm = d.fm;
    const protocol = slugOf(fm.protocol);
    return {
      slug, title: title(d.body, slug), kind: str(fm.kind) === 'quit' ? 'quit' : 'build',
      protocol: protocols.some((p) => p.slug === protocol) ? protocol : null,
      serves: list(fm.serves), supports: list(fm.supports).map((s) => ({ slug: s, title: titleOf(s) })),
      target: num(fm.target), unit: str(fm.unit), minimum: str(fm.minimum), cue: str(fm.cue), keystone: fm.keystone === true,
      timer: timerOf(num(fm.target), str(fm.unit), title(d.body, slug)),
      obstacle: str(fm.obstacle), plan: str(fm.plan), // WOOP: if the obstacle shows up → then the plan
      // where it's checked: on the Protocol screen (null), or on Daily reflection; next-one = done by choosing tomorrow's #1;
      // by-reflection = done by saving the day's reflection
      checkin: CHECKINS.includes(str(fm.checkin)) ? str(fm.checkin) : null,
      // schedule: days (e.g. [mon, tue, wed, thu, fri]; null = every day) or per_week (N times a week, any days)
      days: (() => { const l = (Array.isArray(fm.days) ? fm.days : fm.days ? String(fm.days).split(/[\s,]+/) : []).map((x) => String(x).slice(0, 3).toLowerCase()).filter((x) => DOW.includes(x)); return l.length && new Set(l).size < 7 ? DOW.filter((x) => l.includes(x)) : null; })(),
      perWeek: (() => { const n = num(fm.per_week); return n && n >= 1 && n <= 7 ? Math.round(n) : null; })(),
      offWork: str(fm.off_work) === 'pause', // a work habit: paused on days off work (profile.md off_work, Settings → Off work)
      // filled in automatically: "<source>:<metric>[<=HH:MM]" — health (the iPhone) or oura (the Mac), see applyAuto
      auto: parseAuto(str(fm.auto)),
      why: section(d.body, 'Why'), status: str(d.fm.status) || 'active', file: `05_model/habits/${f}`,
    };
  }).filter(Boolean);
  const day = dayOrder();
  const rank = (h) => {
    const pi = protocols.findIndex((p) => p.slug === h.protocol);
    const hi = pi < 0 ? day.indexOf(h.slug) : protocols[pi].habits.indexOf(h.slug);
    return [pi < 0 ? 999 : pi, hi < 0 ? 999 : hi];
  };
  return all.sort((a, b) => { const [x, y] = rank(a), [u, v] = rank(b); return x - u || y - v || a.title.localeCompare(b.title); });
}

// The working day between the protocols: from the end of the morning one (ends by noon) to the start of the evening one
// (starts after noon). Each end falls back to profile.md's workday; with the module off it is profile.md's.
export function workday(protocols = null) {
  const w = profile().workday;
  if (!enabled()) return { start: w.start, end: w.end, from: 'profile' };
  const ps = (protocols || listProtocols()).filter((p) => p.window);
  const am = ps.filter((p) => p.window.end <= '12:00').map((p) => p.window.end).sort().pop();
  const pm = ps.filter((p) => p.window.start >= '12:00').map((p) => p.window.start).sort()[0];
  return { start: am || w.start, end: pm || w.end, from: am || pm ? 'protocols' : 'profile' };
}

const groupOf = (h, protocols) => protocols.find((p) => p.slug === h.protocol)?.title || 'Day';
// A day's line for a habit → done | min | miss | null (no line)
function stateOf(entry) {
  if (!entry) return null;
  if (entry.skipped) return 'skip';
  if (entry.minimum && entry.done) return 'min';
  return entry.done ? 'done' : 'miss';
}
function entriesOf(groups) {
  const out = {};
  for (const g of groups) for (const e of g.entries) if (e.slug) out[e.slug] = e;
  return out;
}

// Check a habit in or out for a day. body: {date, done, value, minimum, kept, slipped, clear}
// A value counts as done only when it reaches the target; a quit habit is kept or slipped.
export function checkIn(slug, b = {}) {
  if (!enabled()) throw httpError(409, 'habits are switched off (Settings)');
  const date = Daily.checkDate(b.date || localDate());
  const protocols = listProtocols(), habits = listHabits(protocols);
  const h = habits.find((x) => x.slug === slug);
  if (!h) throw httpError(404, `no active habit ${slug}`);
  let entry = null;
  if (b.skip) entry = { slug, done: false, note: 'skipped' }; // on purpose: neither done nor missed
  else if (!b.clear) {
    if (h.kind === 'quit') {
      if (!b.kept && !b.slipped) throw httpError(400, 'a quit habit is kept or slipped');
      entry = { slug, done: !!b.kept, note: b.kept ? 'kept' : 'slipped' };
    } else if (b.value !== undefined && b.value !== null && b.value !== '') {
      const v = Number(b.value);
      if (!Number.isFinite(v) || v < 0) throw httpError(400, 'value must be a number');
      entry = { slug, done: h.target != null ? v >= h.target : v > 0, note: `${v}${h.unit ? ` ${h.unit}` : ''}` };
    } else if (b.minimum) entry = { slug, done: true, note: 'minimum' };
    else entry = { slug, done: b.done !== false, note: b.done !== false && h.target != null ? `${h.target}${h.unit ? ` ${h.unit}` : ''}` : '' };
  }
  const groups = Daily.getHabits(date);
  for (const g of groups) g.entries = g.entries.filter((e) => e.slug !== slug);
  if (entry) {
    const name = groupOf(h, protocols);
    let g = groups.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!g) { g = { name, entries: [] }; groups.push(g); }
    g.entries.push(entry);
  }
  // groups in the day's order (protocols by time, Day between the morning and evening ones); lines in habit order
  const order = habits.map((x) => x.slug);
  const gRank = (n) => {
    const p = protocols.find((x) => x.title.toLowerCase() === n.toLowerCase());
    if (!p) return n.toLowerCase() === 'day' ? '12:00' : '99';
    return p.window?.start || '98';
  };
  groups.sort((a, b) => gRank(a.name).localeCompare(gRank(b.name)));
  for (const g of groups) {
    const known = g.entries.filter((e) => e.slug && order.includes(e.slug)).sort((a, b) => order.indexOf(a.slug) - order.indexOf(b.slug));
    g.entries = [...known, ...g.entries.filter((e) => !e.slug || !order.includes(e.slug))];
  }
  const text = Daily.formatHabits(groups);
  Daily.writeSection(date, 'Habits', text || null);
  return dayView(date);
}

// Per habit over the last `days` days: the last 7 days' states, the streak (one missed day is a gap, two in a row end
// it — never miss twice), and whether today is the day not to miss twice.
// "health:steps", "health:wake<=06:30", "oura:bedtime<=22:00", "app:focus" → {source, metric, op, at (minutes), spec}
// app = Gubernos itself: focus = the minutes of focus sprints finished today (lib/pomodoros.js), tasks = tasks closed
// today (lib/done-today.js). nap = minutes of daytime sleep (Apple Health on the iPhone, or Oura).
export const AUTO_METRICS = { steps: 'steps', energy: 'Cal', water: 'ml', daylight: 'min', mindful: 'min', workout: 'min', wake: 'time', bedtime: 'time', focus: 'min', tasks: 'tasks', nap: 'min' };
function parseAuto(s) {
  const m = String(s || '').trim().match(/^(health|oura|app):([a-z]+)(?:\s*<=\s*(\d{1,2}):(\d{2}))?$/);
  if (!m || !AUTO_METRICS[m[2]]) return null;
  const time = AUTO_METRICS[m[2]] === 'time';
  if (time && !m[3]) return null;
  return { source: m[1], metric: m[2], at: time ? +m[3] * 60 + +m[4] : null, spec: `${m[1]}:${m[2]}${time ? `<=${m[3].padStart(2, '0')}:${m[4]}` : ''}` };
}
// A habit measured in minutes gets a countdown (Protocol screen, the watch; lib/timers.js): its length is the target, else
// the minutes in its title ("Focus work 20 minutes", "10-minute napuccino"), else 15. null = no timer.
function timerOf(target, unit, name) {
  const t = String(name).match(/(\d{1,3})[\s-]*(?:minutes?|mins?|мин)/i), n = t && +t[1] >= 1 && +t[1] <= 240 ? +t[1] : null;
  if (/^min/i.test(unit || '')) return target && target >= 1 && target <= 240 ? target : n || 15;
  return n;
}
const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// A source's values for a day → check-ins of the habits that take them (auto: …). values: {metric: number}; for wake and
// bedtime: minutes after that day's midnight (bedtime after midnight > 1440). Totals only grow during a day, so a value is
// written when there is no line yet, or over a smaller value written before; a time check is written once. A mark made
// by hand (done without a value, skipped, kept/slipped) is never touched.
export function applyAuto({ date = localDate(), source, values = {} } = {}) {
  if (!enabled()) return { applied: [] };
  Daily.checkDate(date);
  if (!['health', 'oura', 'app'].includes(source)) throw httpError(400, 'source: health, oura or app');
  const applied = [];
  for (const h of listHabits().filter((x) => x.auto?.source === source)) {
    const v = Number(values[h.auto.metric]);
    if (!Number.isFinite(v) || v < 0) continue;
    const e = entriesOf(Daily.getHabits(date))[h.slug];
    if (h.auto.at != null) { // a time: done when it happened by then
      if (e) continue;
      checkIn(h.slug, { date, done: v <= h.auto.at });
      applied.push({ slug: h.slug, value: hhmm(v), done: v <= h.auto.at });
      continue;
    }
    if (e && (e.skipped || e.kept || e.slipped || e.minimum || (e.done && e.value == null))) continue; // marked by hand
    const val = Math.round(v);
    if (e?.value != null && e.value >= val) continue;
    if (!val && !e) continue;
    checkIn(h.slug, { date, value: val });
    applied.push({ slug: h.slug, value: val });
  }
  return { date, source, applied };
}

export const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const dowOf = (d) => DOW[new Date(`${d}T12:00:00`).getDay()];
const okS = (s) => s === 'done' || s === 'min';
const neutral = (s) => s === 'skip' || s === 'off' || s === 'free';
// not due that day by its schedule: not one of its days, or a work habit on a day off work
const offOn = (h, d) => !!(h.days && !h.days.includes(dowOf(d))) || (h.offWork && !!offWorkOn(d));
// A habit's day: done | min | miss | skip (skipped on purpose: neither done nor missed) | off (not on its schedule, or off work) |
// free (a times-a-week habit not done that day — not a miss) | null (no record yet: today, or before tracking began).
export function dayStateOf(h, d, raw, tracked = true) {
  if (raw === 'done' || raw === 'min' || raw === 'skip') return raw;
  if (offOn(h, d)) return 'off';
  if (h.perWeek) return raw === 'miss' || tracked ? 'free' : null;
  return raw === 'miss' ? 'miss' : tracked ? 'miss' : null;
}
// Streak over days newest → oldest: done days count; skipped / off days are passed; one miss is a gap, two misses in a
// row (scheduled days) end it. lenient: the first day (today) still open doesn't count as a miss.
export function dailyStreak(states, { lenient = true } = {}) {
  let n = 0, miss = false;
  for (let i = 0; i < states.length; i++) {
    const s = states[i];
    if (i === 0 && lenient && !okS(s)) continue;
    if (neutral(s)) continue;
    if (okS(s)) { n++; miss = false; continue; }
    if (s == null || miss) break;
    miss = true;
  }
  return n;
}

// Per habit over the last `days` days (and the imported stats before the daily files): this calendar week, the streak
// (days; weeks for a times-a-week habit), don't-miss-twice, the 4-week %, all-time totals.
export function history(habits, date = localDate(), days = 84) {
  const stats = readStats();
  const dates = Array.from({ length: days }, (_, i) => Daily.addDays(date, i - days + 1));
  const byDay = Object.fromEntries(Daily.datesBetween(dates[0], date).map((d) => [d, entriesOf(Daily.getHabits(d))]));
  // this calendar week (Settings → week starts on), like Habit Tracker: days after `date` are still to come
  const wsOf = (d) => localDate(weekStartDate(new Date(`${d}T12:00:00`)));
  const ws = wsOf(date);
  const weekDays = Array.from({ length: 7 }, (_, i) => Daily.addDays(ws, i));
  const out = {};
  for (const h of habits) {
    const s = stats[h.slug];
    // a day the stats cover (≤ through) with no line in a daily file comes from their recent strip
    const fromStats = (d) => { if (!s || d > s.through) return null; const k = s.recent.length - 1 - Math.round((new Date(`${s.through}T12:00:00`) - new Date(`${d}T12:00:00`)) / 864e5); return k >= 0 && k < s.recent.length ? (s.recent[k] === '1' ? 'done' : 'miss') : null; };
    const raw = dates.map((d) => stateOf(byDay[d]?.[h.slug]) ?? fromStats(d));
    const first = raw.findIndex((x) => x !== null);
    const n = dates.length - 1;
    const st = dates.map((d, k) => (k === n && raw[k] === null ? (dayStateOf(h, d, null, false) === 'off' ? 'off' : null) : dayStateOf(h, d, raw[k], first >= 0 && k >= first)));
    const weekSt = weekDays.map((d) => (d > date ? 'future' : st[dates.indexOf(d)] ?? null));
    const weekDone = weekSt.filter(okS).length;
    let streak = 0, streakUnit = 'day', behind = false, nmt = false, twice = false, rate = null;
    if (h.perWeek) {
      // weeks met in a row: this week counts once met; earlier weeks inside the window
      streakUnit = 'week';
      const weeks = [];
      for (let k = n; k >= 0; k--) { const w = wsOf(dates[k]); let g = weeks.find((x) => x.w === w); if (!g) { g = { w, done: 0, full: k - 6 >= 0 || dates[k] === w }; weeks.push(g); } if (okS(st[k])) g.done++; }
      for (let x = 0; x < weeks.length; x++) {
        const g = weeks[x], met = g.done >= h.perWeek;
        if (x === 0) { if (met) streak++; continue; }
        if (!met || !g.full) break;
        streak++;
      }
      const left = weekDays.filter((d) => d >= date).length; // days left this week, today included
      behind = !okS(st[n]) && weekDone < h.perWeek && h.perWeek - weekDone >= left;
      const prev = weeks[1]; // last week, if it was tracked and complete
      twice = !!prev && prev.full && first >= 0 && first <= dates.indexOf(prev.w) && prev.done < h.perWeek;
      const fullWeeks = weeks.slice(1).filter((g) => g.full && dates.indexOf(g.w) >= Math.max(0, first));
      rate = fullWeeks.length ? Math.round((fullWeeks.filter((g) => g.done >= h.perWeek).length / fullWeeks.length) * 100) : null;
    } else {
      // walk back; at the stats' last day, their streak continues the chain (unless that day makes two misses in a row)
      const newest = [];
      for (let k = n; k >= 0; k--) {
        if (s && dates[k] <= s.through) {
          const lenient = newest.length === 0;
          const base = dailyStreak(newest, { lenient });
          const pendingMiss = (() => { let m = false; for (let x = 0; x < newest.length; x++) { const v = newest[x]; if (x === 0 && lenient && !okS(v)) continue; if (neutral(v)) continue; m = !okS(v); } return m; })();
          const chainAlive = dailyStreak([...newest, 'done'], { lenient }) > base; // nothing broke it before the stats
          streak = base + (chainAlive && !(pendingMiss && st[k] === 'miss') ? s.streak : 0);
          break;
        }
        newest.push(st[k]);
      }
      if (!s || dates[0] > s.through) streak = dailyStreak(newest);
      // the scheduled days before today, newest first
      const before = st.slice(0, n).reverse().filter((x) => x != null && !neutral(x));
      const todayDue = !neutral(st[n]);
      nmt = todayDue && !okS(st[n]) && before[0] === 'miss';
      twice = before[0] === 'miss' && before[1] === 'miss';
      // % of scheduled days done over the last 4 weeks (from the first record; today once it's done)
      const win = st.slice(Math.max(first, n - 27)).filter((x, k, a) => x != null && !neutral(x) && (k < a.length - 1 || okS(x)));
      rate = first < 0 || !win.length ? null : Math.round((win.filter(okS).length / win.length) * 100);
    }
    // the install phase (Habits 101): unbearable the first two weeks; uncomfortable until ~66 days or under 80% done;
    // then unstoppable — from the first record (the imported stats, else the daily files)
    const age = (() => { const f = s?.since || (first >= 0 ? dates[first] : null); return f ? Math.round((new Date(`${date}T12:00:00`) - new Date(`${f}T12:00:00`)) / 864e5) + 1 : 0; })();
    const phase = !age ? null : age <= 14 ? 'unbearable' : age < 66 || (rate ?? 0) < 80 ? 'uncomfortable' : 'unstoppable';
    out[h.slug] = {
      week: weekSt, weekDone, streak, streakUnit, nmt, behind, twice, rate, phase, age,
      // all-time: the imported stats + the daily files after them
      total: s ? (() => {
        const after = dates.map((d, k) => [d, st[k]]).filter(([d]) => d > s.through);
        const doneAfter = after.filter(([, x]) => okS(x)).length;
        const daysAfter = h.perWeek ? after.length : after.filter(([d, x], k) => x != null && !neutral(x) && (d < date || okS(x))).length;
        return { since: s.since, done: s.done + doneAfter, days: s.days + daysAfter, best: Math.max(s.best, streak), unit: streakUnit };
      })() : null,
    };
  }
  return out;
}

// Is a habit for today? Not when it's off its schedule or skipped, nor a times-a-week habit already met this week.
function dueOn(h, date, entry, weekDoneBefore) {
  const raw = stateOf(entry);
  if (raw === 'skip') return false;
  if (offOn(h, date) && !okS(raw)) return false;
  if (h.perWeek && weekDoneBefore >= h.perWeek && !okS(raw)) return false;
  return true;
}
// done / total per group for one day (the Protocol badge, the reflection, the reminders): only what's due that day
export function summary(date = localDate(), protocols = listProtocols(), habits = listHabits(protocols)) {
  const e = entriesOf(Daily.getHabits(date));
  const ws = localDate(weekStartDate(new Date(`${date}T12:00:00`)));
  const earlier = Daily.datesBetween(ws, Daily.addDays(date, -1)).map((d) => entriesOf(Daily.getHabits(d)));
  const weekDone = (slug) => earlier.filter((x) => okS(stateOf(x[slug]))).length;
  const groups = [...protocols.map((p) => ({ key: p.slug, name: p.title, window: p.window })), { key: null, name: 'Day', window: null }];
  return groups.map((g) => {
    const hs = habits.filter((h) => h.protocol === g.key && !h.checkin && dueOn(h, date, e[h.slug], h.perWeek ? weekDone(h.slug) : 0)); // reflection habits are counted there
    return { protocol: g.key, name: g.name, window: g.window, total: hs.length, done: hs.filter((h) => okS(stateOf(e[h.slug]))).length };
  }).filter((g) => g.total).sort((a, b) => (a.window?.start || '12:00').localeCompare(b.window?.start || '12:00'));
}

// Everything the Day screen shows for a date.
export function dayView(date = localDate()) {
  Daily.checkDate(date);
  const day = Daily.readDay(date);
  // the plan's tasks as they are now (done ones live in the archive, which the client doesn't have)
  const ids = [...new Set([...(day.plan?.tasks || []).map((x) => x.id), ...(day.plan?.added || []), day.plan?.one?.link].filter(Boolean))];
  const tasks = {};
  for (const id of ids) { try { const x = getTask(id); tasks[id] = { title: x.title, status: x.status, project: x.project, due: x.due, dropped: !!x.dropped }; } catch { /* not a task */ } }
  const base = { date, today: localDate(), enabled: enabled(), workday: workday(), plan: day.plan, file: day.file, tasks, offWork: offWorkOn(date),
    tomorrowOne: Daily.getPlan(Daily.addDays(date, 1))?.one || null, // chosen on Daily reflection the evening before
    oneStreak: Daily.oneStreak(date), oneDone: !!day.plan && Daily.isOneDone(day.plan) };
  if (!base.enabled) return { ...base, protocols: [], habits: [], summary: [] };
  const protocols = listProtocols(), habits = listHabits(protocols);
  const e = entriesOf(day.habits), hist = history(habits, date);
  return {
    ...base, protocols, summary: summary(date, protocols, habits),
    week: Array.from({ length: 7 }, (_, i) => Daily.addDays(localDate(weekStartDate(new Date(`${date}T12:00:00`))), i)),
    reflection: (() => { const r = habits.filter((h) => h.checkin && dueOn(h, date, e[h.slug], 0)); return { total: r.length, done: r.filter((h) => ['done', 'min'].includes(stateOf(e[h.slug]))).length }; })(),
    paused: listHabits(protocols, { any: true }).filter((h) => h.status !== 'active').map((h) => ({ slug: h.slug, title: h.title, status: h.status })),
    habits: habits.map((h) => ({ ...h, entry: e[h.slug] || null, state: stateOf(e[h.slug]), ...hist[h.slug],
      due: dueOn(h, date, e[h.slug], h.perWeek ? hist[h.slug].weekDone - (okS(stateOf(e[h.slug])) ? 1 : 0) : 0) })),
  };
}

// What /api/state carries: enough for Today's badge and the protocol reminders, no history.
export function stateBrief() {
  const date = localDate();
  const p = Daily.getPlan(date);
  const brief = { enabled: enabled(), workday: workday(), one: p?.one || null, oneDone: !!p?.one && Daily.isOneDone(p), oneStreak: Daily.oneStreak(date), planSet: !!p?.setAt,
    blocks: (p?.blocks || []).map(({ kind, start, end }) => ({ kind, start, end })) }; // deep work (#1's time) / deep love
  if (brief.enabled) brief.auto = [...new Set(listHabits().filter((h) => h.auto).map((h) => `${h.auto.source}:${h.auto.metric}`))]; // what the iPhone should read from Health
  if (!brief.enabled) return { ...brief, protocols: [], summary: [] };
  const protocols = listProtocols(), habits = listHabits(protocols);
  if (!habits.length) return { ...brief, protocols: [], summary: [] };
  const e = entriesOf(Daily.getHabits(date));
  // the next one in each protocol: the first due habit not done yet (for the mid-window nudge)
  const nextOf = (x) => { const h = x.habits.map((s) => habits.find((y) => y.slug === s && !y.checkin)).find((y) => y && dueOn(y, date, e[y.slug], 0) && !okS(stateOf(e[y.slug]))); return h ? { slug: h.slug, title: h.title, cue: h.cue, quit: h.kind === 'quit' } : null; };
  return { ...brief, summary: summary(date, protocols, habits),
    protocols: protocols.filter((x) => x.window).map((x) => ({ slug: x.slug, title: x.title, window: x.window, next: nextOf(x),
      habits: x.habits.map((s) => habits.find((h) => h.slug === s && !h.checkin)?.title).filter(Boolean) })) };
}

// ---------- editing (the habit screen's Edit form, drag to reorder) ----------
const pfile = (slug) => path.join(DIRS.protocols, `${slug}.md`);
const hfile = (slug) => {
  if (!/^[\w.-]+$/.test(slug || '')) throw httpError(400, 'bad habit slug');
  const f = path.join(DIRS.habits, `${slug}.md`);
  if (!fsx.existsSync(f)) throw httpError(404, `no habit ${slug}`);
  return f;
};
const links = (doc, key, slugs) => { const n = doc.createNode(slugs.map((s) => `[[${s}]]`)); n.flow = true; doc.set(key, n); };
function setSection(body, heading, text) {
  const re = new RegExp(`^(##[ \\t]+${heading}[ \\t]*\\n)([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'mi');
  const txt = String(text || '').trim();
  if (re.test(body)) return body.replace(re, (_, h) => `${h}\n${txt ? `${txt}\n\n` : ''}`);
  return `${body.replace(/\s*$/, '')}\n\n## ${heading}\n\n${txt}\n`;
}
function logLine(body, text) {
  const line = `- ${localDate()} · ${profile().id} · ${text} (Gubernos)`;
  const m = body.match(/^##\s+Log[ \t]*$/m);
  if (!m) return `${body.replace(/\s*$/, '')}\n\n## Log\n\n${line}\n`;
  const start = m.index + m[0].length, rest = body.slice(start), end = rest.search(/^## /m);
  const sec = (end < 0 ? rest : rest.slice(0, end)).trim(), after = end < 0 ? '' : rest.slice(end);
  return `${body.slice(0, start)}\n\n${sec ? `${sec}\n` : ''}${line}\n${after ? `\n${after}` : ''}`;
}
// A protocol's (or day.md's) list of habits: remove one, or insert it before another (or at the end).
function editOrder(slug, fn) {
  const f = pfile(slug);
  let d = read(f);
  if (!d) {
    if (slug !== DAY_ORDER) throw httpError(404, `no protocol ${slug}`);
    fsx.mkdirSync(DIRS.protocols, { recursive: true });
    // the order of the habits without a protocol, created on the first drag in Day
    fsx.writeFileSync(f, '---\ntype: protocol\nwindow: null\nprovenance: stated\n---\n\n# Day\n\nThe order of the habits without a protocol (Gubernos keeps it; not a time window).\n');
    d = read(f);
  }
  const lines = d.body.split('\n');
  const at = lines.map((l, i) => [l, i]).filter(([l]) => /^\s*- \[\[/.test(l));
  let order = at.map(([l]) => l.match(/\[\[([^\]|]+)/)[1].trim());
  order = fn(order);
  const block = order.map((s) => `- [[${s}]]`);
  if (at.length) lines.splice(at[0][1], at[at.length - 1][1] - at[0][1] + 1, ...block);
  else lines.splice(lines.length, 0, ...block);
  writeDoc(f, d.doc, lines.join('\n').replace(/\s*$/, '\n'));
}

// Move a habit: into protocol `to` (null = Day), before habit `before` (null = at the end). Sets its `protocol:`.
export function arrange(slug, { to = null, before = null } = {}) {
  const f = hfile(slug);
  const protocols = listProtocols();
  if (to && !protocols.some((p) => p.slug === to)) throw httpError(400, `no protocol ${to}`);
  const { doc, fm, body } = readDoc(f);
  const was = slugOf(fm.protocol);
  // the Day list gets every habit that is in Day now, in the order shown, so a first drag keeps the rest in place
  const dayNow = listHabits(protocols).filter((h) => !h.protocol).map((h) => h.slug);
  for (const p of [...new Set([was && protocols.some((x) => x.slug === was) ? was : DAY_ORDER, to || DAY_ORDER])]) {
    editOrder(p, (order) => {
      let o = p === DAY_ORDER ? [...new Set([...order.filter((s) => dayNow.includes(s)), ...dayNow])] : order;
      o = o.filter((s) => s !== slug);
      if (p === (to || DAY_ORDER)) { const i = before ? o.indexOf(before) : -1; o.splice(i < 0 ? o.length : i, 0, slug); }
      return o;
    });
  }
  if ((was || null) !== (to || null)) {
    doc.set('protocol', to ? `[[${to}]]` : null);
    writeDoc(f, doc, logLine(body, `moved to ${to ? protocols.find((p) => p.slug === to).title : 'Day'}`));
  }
  return dayView();
}

// Edit a habit from the app: title (the # heading; the file name stays, so links keep working), kind, links, target…
export function updateHabit(slug, b = {}) {
  const f = hfile(slug);
  const { doc, fm, body: orig } = readDoc(f);
  let body = orig;
  const notes = [];
  const oldTitle = title(body, slug);
  if (b.title !== undefined && String(b.title).trim() && String(b.title).trim() !== oldTitle) {
    const nt = String(b.title).trim().replace(/\n/g, ' ');
    body = /^\s*#\s+.+$/m.test(body) ? body.replace(/^(\s*)#\s+.+$/m, `$1# ${nt}`) : `\n# ${nt}\n${body}`;
    notes.push(`renamed “${oldTitle}” → “${nt}”`);
  }
  if (b.kind !== undefined) doc.set('kind', b.kind === 'quit' ? 'quit' : 'build');
  if (b.status !== undefined) {
    if (!['active', 'paused', 'retired'].includes(b.status)) throw httpError(400, 'status: active, paused or retired');
    if (b.status !== (str(fm.status) || 'active')) notes.push(b.status === 'active' ? 'active again' : b.status);
    doc.set('status', b.status);
  }
  if (b.serves !== undefined) links(doc, 'serves', (b.serves || []).map(slugOf).filter(Boolean));
  if (b.supports !== undefined) {
    const s = (b.supports || []).map(slugOf).filter(Boolean);
    const was = list(fm.supports);
    if (s.join() !== was.join()) notes.push(`leads to ${s.map(titleOf).join(', ') || 'nothing'}`);
    links(doc, 'supports', s);
  }
  if (b.target !== undefined) {
    const v = b.target === null || b.target === '' ? null : Number(b.target);
    if (v !== null && !(Number.isFinite(v) && v > 0)) throw httpError(400, 'target must be a positive number');
    if (v !== num(fm.target)) notes.push(`target ${v ?? 'none'}${v != null && (b.unit ?? fm.unit) ? ` ${b.unit ?? fm.unit}` : ''}`);
    doc.set('target', v);
  }
  for (const k of ['unit', 'minimum', 'cue', 'obstacle', 'plan']) if (b[k] !== undefined) { const v = str(String(b[k] ?? '').trim()); if (v || doc.has(k)) doc.set(k, v); }
  if (b.days !== undefined || b.perWeek !== undefined) {
    const d = (Array.isArray(b.days) ? b.days : []).map((x) => String(x).slice(0, 3).toLowerCase()).filter((x) => DOW.includes(x));
    const days = d.length && new Set(d).size < 7 ? DOW.filter((x) => d.includes(x)) : null;
    const pw = Number(b.perWeek) >= 1 && Number(b.perWeek) <= 6 ? Math.round(Number(b.perWeek)) : null;
    const was = `${(list(fm.days).length ? fm.days : []).join(',')}|${num(fm.per_week) || ''}`;
    if (pw) { doc.set('per_week', pw); doc.delete('days'); } else if (days) { const n = doc.createNode(days); n.flow = true; doc.set('days', n); doc.delete('per_week'); } else { doc.delete('days'); doc.delete('per_week'); }
    const now = pw ? `${pw}× a week` : days ? days.join(' ') : 'every day';
    if (was !== `${days ? days.join(',') : ''}|${pw || ''}`) notes.push(`schedule: ${now}`);
  }
  if (b.auto !== undefined) {
    const a = parseAuto(b.auto);
    if ((a?.spec || null) !== (parseAuto(str(fm.auto))?.spec || null)) notes.push(a ? `filled in automatically: ${a.spec}` : 'filled in by hand');
    if (a) doc.set('auto', a.spec); else doc.delete('auto');
  }
  if (b.checkin !== undefined) {
    const c = CHECKINS.includes(b.checkin) ? b.checkin : null;
    if (c !== (str(fm.checkin) || null)) notes.push(c ? `checked on Daily reflection${c === 'next-one' ? ' (choosing tomorrow’s #1)' : c === 'by-reflection' ? ' (by saving it)' : ''}` : 'checked on the Protocol screen');
    if (c) doc.set('checkin', c); else doc.delete('checkin');
  }
  if (b.offWork !== undefined) {
    if (!!b.offWork !== (str(fm.off_work) === 'pause')) notes.push(b.offWork ? 'paused on days off work' : 'kept on days off work');
    if (b.offWork) doc.set('off_work', 'pause'); else doc.delete('off_work');
  }
  if (b.keystone !== undefined) {
    doc.set('keystone', b.keystone ? true : null);
    // the keystone is the one habit that matters most right now: only one at a time
    if (b.keystone) for (const h of listHabits().filter((x) => x.keystone && x.slug !== slug)) { const o = readDoc(hfile(h.slug)); o.doc.set('keystone', null); writeDoc(hfile(h.slug), o.doc, o.body); }
    if (!!b.keystone !== (fm.keystone === true)) notes.push(b.keystone ? 'keystone' : 'no longer the keystone');
  }
  if (b.why !== undefined) body = setSection(body, 'Why', b.why);
  if (notes.length) body = logLine(body, notes.join('; '));
  writeDoc(f, doc, body);
  if (b.protocol !== undefined && (slugOf(b.protocol) || null) !== (slugOf(fm.protocol) || null)) return arrange(slug, { to: slugOf(b.protocol) || null });
  return dayView(b.date || localDate());
}

// Days off work (a vacation): profile.md `off_work`, a list of {from, to, why}. Work habits (off_work: pause) are off
// those days: not due, neither done nor missed. add: {from, to, why} (to empty = until further notice); end: {from}
// ends that period yesterday (or drops it if it hadn't started); remove: {from} drops it.
export function setOffWork(b = {}) {
  const { doc, body } = readDoc(PROFILE);
  const today = localDate();
  const ok = (d) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? Daily.checkDate(d) : null);
  let list = profile().offWork.map((x) => ({ ...x }));
  if (b.add) {
    const from = ok(b.add.from) || today, to = ok(b.add.to) || null;
    if (to && to < from) throw httpError(400, 'the last day off is before the first');
    list = list.filter((x) => x.to < from || x.from > (to || '9999-12-31')); // a new period replaces what it overlaps
    list.push({ from, to: to || '9999-12-31', why: String(b.add.why || '').trim().slice(0, 80) || null });
  } else if (b.end || b.remove) {
    const from = ok((b.end || b.remove).from);
    const x = list.find((y) => y.from === from);
    if (!x) throw httpError(404, `no off-work period from ${from}`);
    if (b.remove || x.from >= today) list = list.filter((y) => y !== x);
    else x.to = Daily.addDays(today, -1);
  } else throw httpError(400, 'add, end or remove');
  list.sort((a, c) => a.from.localeCompare(c.from));
  if (list.length) {
    const n = doc.createNode(list.map((x) => ({ from: x.from, ...(x.to !== '9999-12-31' ? { to: x.to } : {}), ...(x.why ? { why: x.why } : {}) })));
    for (const it of n.items) it.flow = true;
    doc.set('off_work', n);
  } else doc.delete('off_work');
  writeDoc(PROFILE, doc, body);
  return offWorkState();
}
export function offWorkState() {
  const today = localDate(), all = profile().offWork;
  return { now: offWorkOn(today), upcoming: all.filter((x) => x.from > today), past: all.filter((x) => x.to < today).slice(-5).reverse(),
    habits: listHabits().filter((h) => h.offWork).map((h) => ({ slug: h.slug, title: h.title })) };
}

// Choosing the #1 for `date` the evening before (Daily reflection) is the "plan the next day" habit of the day before.
export function nextOneChosen(date) {
  if (!enabled()) return;
  const before = Daily.addDays(date, -1);
  if (before !== localDate()) return; // only tonight's choice for tomorrow counts
  for (const h of listHabits().filter((x) => x.checkin === 'next-one')) {
    const e = entriesOf(Daily.getHabits(before))[h.slug];
    if (!e?.done) checkIn(h.slug, { date: before, done: true });
  }
}

// ---------- the weekly roll: past check-ins → stats, then to the archive (only stats stay) ----------
// After a weekly review (vault 50_reviews/CLAUDE.md step 11): every habit's row in habit-stats.csv moves on to `through`
// (the last day of the reviewed week) with the same rules as history(), and the `## Habits` sections of the daily files
// up to `through` move to 80_archive/habits/<week>.md. The daily files keep their plan and reflection.
const ARCHIVE = path.join(VAULT, '80_archive', 'habits');
const RECENT = 84;
export function rollStats({ through, dry = false } = {}) {
  Daily.checkDate(through);
  if (through >= localDate()) throw httpError(400, 'through must be a past day');
  const stats = readStats(), habits = listHabits(undefined, { any: true });
  const files = Daily.datesBetween('0000-01-01', through);
  const entries = Object.fromEntries(files.map((d) => [d, entriesOf(Daily.getHabits(d))]));
  const rows = { ...stats }, report = [];
  for (const h of habits) {
    const s = stats[h.slug];
    const own = files.filter((d) => entries[d][h.slug]);
    const from = s ? Daily.addDays(s.through, 1) : own[0];
    if (!from || from > through) continue;
    const days = [];
    for (let d = from; d <= through; d = Daily.addDays(d, 1)) days.push(d);
    const raw = days.map((d) => stateOf(entries[d]?.[h.slug]));
    const st = days.map((d, k) => dayStateOf(h, d, raw[k], true));
    const doneNew = st.filter(okS).length;
    let row;
    if (h.perWeek) {
      // whole weeks only: a times-a-week habit is judged per week
      let streak = s?.streak || 0, best = s?.best || 0, met = 0, weeks = 0;
      for (let k = 0; k < days.length; k++) {
        if (days[k] !== localDate(weekStartDate(new Date(`${days[k]}T12:00:00`))) || k + 6 >= days.length) continue;
        const ok = st.slice(k, k + 7).filter(okS).length >= h.perWeek;
        weeks++; met += ok; streak = ok ? streak + 1 : 0; best = Math.max(best, streak);
      }
      row = { done: (s?.done || 0) + met, days: (s?.days || 0) + weeks, best, streak };
    } else {
      const newest = [...st].reverse();
      let streak = dailyStreak(newest, { lenient: false });
      const alive = dailyStreak([...newest, 'done'], { lenient: false }) > streak; // nothing broke it in the new days
      let pending = false; for (const v of newest) { if (neutral(v)) continue; pending = !okS(v); }
      const oldLast = s?.recent?.slice(-1);
      if (s && alive && !(pending && oldLast === '0' && dayStateOf(h, s.through, 'miss', true) === 'miss')) streak += s.streak;
      // best: the runs in the new days, the first one continuing the old streak
      let run = s ? s.streak : 0, best = s?.best || 0, miss = false;
      for (const v of st) { if (neutral(v)) continue; if (okS(v)) { run++; miss = false; best = Math.max(best, run); } else { if (miss) run = 0; miss = true; } }
      best = Math.max(best, streak);
      row = { done: (s?.done || 0) + doneNew, days: (s?.days || 0) + st.filter((v) => v === 'done' || v === 'min' || v === 'miss').length, best, streak };
    }
    const since = s?.since || days[st.findIndex(okS)] || from;
    const recent = `${s?.recent || ''}${st.map((v) => (okS(v) ? '1' : '0')).join('')}`.slice(-RECENT);
    rows[h.slug] = { slug: h.slug, name: s?.name || h.title, since, through, ...row, recent };
    report.push({ slug: h.slug, from, through, done: doneNew, streak: row.streak });
  }
  // archive the rolled check-ins: one file per week, "## YYYY-MM-DD" per day, the day's groups under it
  const moved = [];
  if (!dry) {
    fsx.mkdirSync(path.dirname(STATS_FILE), { recursive: true });
    const lines = Object.entries(rows).sort(([a], [b]) => a.localeCompare(b)).map(([slug, x]) => statsLine({ ...x, slug }));
    fsx.writeFileSync(STATS_FILE, `${[STATS_HEADER, ...lines].join('\n')}\n`);
    fsx.mkdirSync(ARCHIVE, { recursive: true });
    for (const d of files) {
      const text = Daily.sectionText(Daily.readText(d) || '', 'Habits');
      if (text == null || !text.trim()) continue;
      const ws = localDate(weekStartDate(new Date(`${d}T12:00:00`))), we = Daily.addDays(ws, 6);
      const af = path.join(ARCHIVE, `${ws}_to_${we}.md`);
      const cur = fsx.existsSync(af) ? fsx.readFileSync(af, 'utf8') : `# Habits · ${ws} → ${we}\n\nCheck-ins moved here from the daily files after the weekly review; their stats are in 50_reviews/habit-stats.csv.\n`;
      if (!cur.includes(`\n## ${d}\n`)) fsx.writeFileSync(af, `${cur.replace(/\s*$/, '')}\n\n## ${d}\n\n${text.trim()}\n`);
      Daily.writeSection(d, 'Habits', null);
      moved.push(d);
    }
  }
  return { through, habits: report.length, report, archived: moved };
}

// Saving the day's reflection is the by-reflection habits of that day (e.g. a journal written as the reflection).
export function reflectionSaved(date) {
  if (!enabled()) return;
  for (const h of listHabits().filter((x) => x.checkin === 'by-reflection')) {
    const e = entriesOf(Daily.getHabits(date))[h.slug];
    if (!e?.done && !e?.skipped) checkIn(h.slug, { date, done: true });
  }
}

// A new habit from the app: the vault's habit template's fields and sections, then the rest through updateHabit
// (block, schedule, links…). Its slug is unique across the vault (wikilinks resolve by name).
export function createHabit(b = {}) {
  const title = String(b.title || '').trim().replace(/\n/g, ' ');
  if (!title) throw httpError(400, 'title required');
  const taken = (s) => [DIRS.habits, DIRS.protocols, VDIRS.projects, VDIRS.goals, path.join(VDIRS.archive, 'projects'), path.join(VDIRS.archive, 'goals'), path.join(VDIRS.archive, 'model'),
    ...(() => { try { return fsx.readdirSync(MODEL, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(MODEL, d.name)); } catch { return []; } })()]
    .some((d) => fsx.existsSync(path.join(d, `${s}.md`)));
  const base = slugify(title) || 'habit';
  let slug = base, n = 2;
  while (taken(slug)) slug = `${base}-${n++}`;
  fsx.mkdirSync(DIRS.habits, { recursive: true });
  const fm = ['---', 'type: habit', 'status: active', `kind: ${b.kind === 'quit' ? 'quit' : 'build'}`, 'protocol: null', 'serves: []', 'supports: []',
    'target: null', 'unit: null', 'minimum: null', 'cue: null', 'keystone: null', 'provenance: stated', '---'].join('\n');
  fsx.writeFileSync(path.join(DIRS.habits, `${slug}.md`), `${fm}\n\n# ${title}\n\n## Why\n\n## Log\n\n- ${localDate()} · ${profile().id} · created (Gubernos)\n`);
  const { title: _t, ...rest } = b;
  if (rest.protocol === undefined) rest.protocol = null;
  updateHabit(slug, rest);
  // into its block's list (protocols/<slug>.md, or day.md for Day) at the end, unless updateHabit already moved it
  const h = listHabits(undefined, { any: true }).find((x) => x.slug === slug);
  if (h && !h.protocol) arrange(slug, { to: null });
  return { slug, ...dayView(b.date || localDate()) };
}

// The week start..end for the Weekly review: each day (#1 done, plan done / planned, the score's level) and each habit's
// done days of the days it was due — the same rules as the weekly review file (scripts/weekly_review.py).
export function weekSummary(start, end) {
  const days = [];
  for (let d = start; d <= end; d = Daily.addDays(d, 1)) days.push(d);
  const scoreHabit = enabled() ? listHabits(undefined, { any: true }).find((h) => /score/i.test(h.unit || '') && h.kind !== 'quit') : null;
  const out = { days: [], habits: [] };
  const entries = Object.fromEntries(days.map((d) => [d, entriesOf(Daily.getHabits(d))]));
  for (const d of days) {
    const p = Daily.getPlan(d);
    const score = scoreHabit ? entries[d][scoreHabit.slug]?.value ?? null : null;
    out.days.push({ date: d, one: p?.one ? Daily.isOneDone(p) : null, planned: p?.tasks.length || 0, done: p?.tasks.filter((x) => x.done).length || 0,
      moved: p?.line?.moved || 0, added: p?.added.length || 0, score });
  }
  if (!enabled()) return out;
  for (const h of listHabits()) {
    const st = days.map((d) => stateOf(entries[d][h.slug]));
    const done = st.filter(okS).length;
    const due = days.filter((d, k) => st[k] !== 'skip' && (okS(st[k]) || !offOn(h, d))).length;
    if (!due && !done) continue;
    out.habits.push({ slug: h.slug, title: h.title, done, due: h.perWeek ? h.perWeek : due, good: h.perWeek ? done >= h.perWeek : done >= Math.min(5, due), perWeek: h.perWeek });
  }
  out.habits.sort((a, b) => b.done / Math.max(1, b.due) - a.done / Math.max(1, a.due) || a.title.localeCompare(b.title));
  return out;
}

// Days from start to end (dates, inclusive) on which a protocol was closed (every habit due that day done) or a habit
// was done — what a win like "AM protocol × 3 days · [[am]]" counts (lib/wins.js).
export function daysDone(slug, start, end) {
  const protocols = listProtocols(), habits = listHabits(protocols, { any: true });
  const p = protocols.find((x) => x.slug === slug), h = !p && habits.find((x) => x.slug === slug);
  if (!p && !h) return null;
  let n = 0;
  for (let d = start; d <= end; d = Daily.addDays(d, 1)) {
    if (p) { const g = summary(d, protocols, listHabits(protocols)).find((x) => x.protocol === slug); if (g && g.total && g.done >= g.total) n++; }
    else if (okS(stateOf(entriesOf(Daily.getHabits(d))[slug]))) n++;
  }
  return { kind: p ? 'protocol' : 'habit', title: (p || h).title, days: n };
}
