// Habit Tracker history → stats only (no day-by-day check-ins): vault 50_reviews/habit-stats.csv, one row per habit.
//   GUBERNOS_VAULT=<vault> node scripts/import-habit-stats.mjs <Habit Tracker export.csv> [--through YYYY-MM-DD] [--dry]
// A habit file is matched by the name it was seeded from (its ## Log: Seeded from Habit Tracker ("<name>")), else by title.
// A day counts as done when its value is > 0; a habit's target applies only where Habit Tracker recorded the same unit
// (10000 steps, 700 Cal, 1500 ml) — older rows often say 1 for "done". --through (default: yesterday) is the last day
// taken from the export; from the next day on, check-ins live in the daily files. Streaks use the app's rules (lib/habits.js):
// one missed day is a gap, two in a row end it; days off a habit's schedule don't count; a times-a-week habit counts weeks
// (best / streak in weeks, done / days = weeks met / weeks).
import fs from 'node:fs';
import path from 'node:path';
import { listHabits } from '../lib/habits.js';
import { readDoc, localDate, VAULT } from '../lib/vault.js';
import { STATS_FILE, STATS_HEADER, statsLine, dayStateOf, dailyStreak } from '../lib/habits.js';
import { weekStartDate } from '../lib/model.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && !/^\d{4}-\d{2}-\d{2}$/.test(a));
const through = args[args.indexOf('--through') + 1]?.match(/^\d{4}-\d{2}-\d{2}$/) ? args[args.indexOf('--through') + 1] : (() => { const d = new Date(); d.setDate(d.getDate() - 1); return localDate(d); })();
const dry = args.includes('--dry');
if (!file) { console.error('usage: import-habit-stats.mjs <export.csv> [--through YYYY-MM-DD] [--dry]'); process.exit(2); }

function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; } else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const [head, ...rest] = rows;
  const h = head.map((x) => x.replace(/^﻿/, '').trim());
  return rest.filter((r) => r.length > 1).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])));
}
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + n); return localDate(x); };
const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 864e5);

const rows = parseCsv(fs.readFileSync(file, 'utf8'));
const habits = listHabits(undefined, { any: true });
// the name each habit was seeded from
const seeded = Object.fromEntries(habits.map((h) => {
  const body = readDoc(path.join(VAULT, h.file)).body;
  const m = body.match(/Seeded from Habit Tracker \("([^"]+)"\)/);
  return [h.slug, norm(m ? m[1] : h.title)];
}));

const byHabit = {};
for (const r of rows) (byHabit[norm(r.Habit)] ||= []).push(r);
const out = [], unmatched = [];
for (const [name, list] of Object.entries(byHabit)) {
  const h = habits.find((x) => seeded[x.slug] === name) || habits.find((x) => norm(x.title) === name);
  if (!h) { unmatched.push(name); continue; }
  const done = new Set();
  for (const r of list) {
    if (r.Date > through) continue;
    const v = Number(String(r.Value).replace(',', '.')) || 0;
    const unitMatches = h.unit && r.Unit && norm(h.unit) === norm(r.Unit);
    if (v > 0 && (!(h.target != null && unitMatches) || v >= h.target)) done.add(r.Date);
  }
  if (!done.size) { out.push({ slug: h.slug, name: list[0].Habit.trim(), skipped: 'no done days' }); continue; }
  const since = [...done].sort()[0];
  const span = daysBetween(since, through) + 1;
  const all = Array.from({ length: span }, (_, i) => addDays(since, i));
  // the app's rules (lib/habits.js): the schedule (days / per_week) decides what is a miss
  const state = (d) => dayStateOf(h, d, done.has(d) ? 'done' : 'miss', true);
  const ok = (d) => done.has(d);
  let best = 0, streak = 0, days = 0, doneN = 0;
  if (h.perWeek) {
    const weeks = {};
    for (const d of all) { const w = localDate(weekStartDate(new Date(`${d}T12:00:00`))); weeks[w] = (weeks[w] || 0) + (ok(d) ? 1 : 0); }
    const ws = Object.keys(weeks).sort();
    let run = 0;
    for (const w of ws) { run = weeks[w] >= h.perWeek ? run + 1 : 0; best = Math.max(best, run); }
    for (const w of [...ws].reverse()) { if (weeks[w] >= h.perWeek) streak++; else break; }
    days = ws.length; doneN = ws.filter((w) => weeks[w] >= h.perWeek).length; // weeks met of weeks
  } else {
    const st = all.map(state);
    // best: one pass, oldest → newest, with the same rule (off / skipped days pass; two misses in a row end a run)
    let run = 0, miss = false;
    for (const x of st) { if (x === 'off' || x === 'skip') continue; if (x === 'done') { run++; miss = false; best = Math.max(best, run); } else { if (miss) run = 0; miss = true; } }
    streak = dailyStreak([...st].reverse(), { lenient: false });
    days = st.filter((x) => x === 'done' || x === 'miss').length; // scheduled days
    doneN = done.size;
  }
  const recent = Array.from({ length: 84 }, (_, i) => (ok(addDays(through, i - 83)) ? '1' : '0')).join(''); // the last 12 weeks, 1 = done
  out.push({ slug: h.slug, name: list[0].Habit.trim(), since, through, done: doneN, days, best, streak, recent });
}

const good = out.filter((x) => !x.skipped).sort((a, b) => a.slug.localeCompare(b.slug));
const text = [STATS_HEADER, ...good.map(statsLine)].join('\n') + '\n';
console.log(`${good.length} habits through ${through}${unmatched.length ? ` · not matched: ${unmatched.join('; ')}` : ''}${out.some((x) => x.skipped) ? ` · skipped: ${out.filter((x) => x.skipped).map((x) => x.slug).join(', ')}` : ''}`);
for (const x of good) console.log(`${x.slug.padEnd(20)} since ${x.since} · ${String(x.done).padStart(4)}/${String(x.days).padEnd(4)} (${Math.round((x.done / x.days) * 100)}%) · best ${x.best} · now ${x.streak} · ${x.recent.slice(-28)}`);
if (!dry) { fs.mkdirSync(path.dirname(STATS_FILE), { recursive: true }); fs.writeFileSync(STATS_FILE, text); console.log(`wrote ${STATS_FILE}`); }
