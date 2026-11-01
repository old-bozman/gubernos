// Day planner: how much time today really has (Google Calendar, 9–19, minus meetings and an hour for lunch; "Focus time"
// blocks are working time), and an agent's draft: minutes per task, what truly has to happen today, what can move and where.
// The app turns the draft into a plan only when the owner taps Apply (time blocks, agent runs, new due dates).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ask } from './llm.js';
import * as G from './calendar.js'; // the Mac's calendars or Google's
import { listTasks, listProjects, localDate } from './vault.js';
import { readFocus } from './model.js';
import { profile, minutesOf } from './config.js';
import { workday } from './habits.js';
import * as Daily from './daily.js';
import * as Settings from './settings.js';

// the working day: between the AM and PM protocols (05_model/protocols), else profile.md → workday (default 9–19);
// lunch from Settings (time, length, or not counted; unset: 12:00 and profile.md's workday.lunch); "Focus time" blocks
// (profile focus_time) are working time
const day = () => { const w = workday(); return { start: minutesOf(w.start), end: minutesOf(w.end), from: w.from }; };
// at its time, or the first free slot starting within the hour after it
// lunchDay: moved or skipped for one day in Plan the day (Settings.lunchDay {date, at}); other days keep the setting
const lunchOf = (today = localDate()) => {
  const st = Settings.get(), day = st.lunchDay?.date === today ? st.lunchDay : null;
  const at = day ? day.at : st.lunchAt ?? '12:00';
  const n = at ? Number(st.lunchMinutes ?? profile().workday.lunch ?? 60) || 0 : 0;
  const from = at ? minutesOf(at) : 12 * 60;
  return { minutes: n, from, key: `${at}/${n}`, today: day ? day.at || 'off' : null };
};
const LUNCH_EVENT = /lunch|обед|ланч/i; // a lunch in the calendar is the lunch: no extra hour
const working = () => new RegExp(profile().focusTime.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
const DATA = process.env.GUBERNOS_DATA_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data');
const CACHE = path.join(DATA, 'plan-cache.json');

const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const mins = (s) => { const t = String(s).slice(11, 16) || String(s); const [h, m] = t.split(':').map(Number); return h * 60 + m; };

// Free windows today from now (or the start of the workday) to its end.
let freeCache = null;
export const forgetFree = () => { freeCache = null; }; // a block was added or removed: the day's calendar changed
export async function dayFree(now = new Date()) {
  const today = localDate(now);
  const nowMin = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 5) * 5;
  const key = `${today}|${Math.floor(nowMin / 5)}|${lunchOf(today).key}|${G.readCalendars().join()}`;
  if (freeCache?.key === key && Date.now() - freeCache.at < 2 * 60e3) return freeCache.value; // calendar edits show within 2 min
  let events = [], calendarError = null;
  try { events = await G.listEvents({ from: today }); } catch (e) { calendarError = e.message; }
  const DAY = day(), LUNCH = lunchOf(today), WORKING = working();
  const timed = events.filter((e) => !e.allDay && e.start?.slice(0, 10) === today).map((e) => ({
    id: e.id, title: e.title, start: mins(e.start), end: mins(e.end),
    kind: e.title.startsWith('⏱') ? 'block' : WORKING.test(e.title) ? 'focus' : 'meeting',
  }));
  const start = Math.max(DAY.start, nowMin), end = DAY.end;
  // busy = meetings and task time blocks already set; "Focus time" stays free for work
  let gaps = start < end ? [[start, end]] : []; // after the workday: nothing left today
  for (const b of timed.filter((e) => e.kind !== 'focus')) {
    gaps = gaps.flatMap(([a, z]) => (b.end <= a || b.start >= z ? [[a, z]] : [[a, Math.min(z, b.start)], [Math.max(a, b.end), z]]).filter(([x, y]) => y - x >= 5));
  }
  // lunch: at its time if that's free, else the nearest free slot within the hour after it, then the hour before
  let lunch = null;
  const ownLunch = timed.some((e) => LUNCH_EVENT.test(e.title)), n = LUNCH.minutes;
  const free = (t) => gaps.some(([a, z]) => a <= t && t + n <= z);
  if (n && !ownLunch) {
    const tries = [...Array.from({ length: 13 }, (_, i) => LUNCH.from + i * 5), ...Array.from({ length: 12 }, (_, i) => LUNCH.from - (i + 1) * 5)];
    const t = tries.find(free);
    if (t != null) lunch = [t, t + n];
  }
  if (lunch) gaps = gaps.flatMap(([a, z]) => (lunch[1] <= a || lunch[0] >= z ? [[a, z]] : [[a, lunch[0]], [lunch[1], z]]).filter(([x, y]) => y - x >= 5));
  const value = {
    today, from: hm(start), to: hm(end), workday: { start: hm(DAY.start), end: hm(DAY.end), from: DAY.from },
    events: timed.map((e) => ({ id: e.id, title: e.title, start: hm(e.start), end: hm(e.end), kind: e.kind })),
    lunch: lunch && { start: hm(lunch[0]), end: hm(lunch[1]) },
    lunchToday: LUNCH.today, // "HH:MM" moved for today, "off" skipped today, null = as in Settings
    gaps: gaps.map(([a, z]) => ({ start: hm(a), end: hm(z), minutes: z - a })),
    freeMinutes: gaps.reduce((n, [a, z]) => n + z - a, 0),
    plannedMinutes: timed.filter((e) => e.kind === 'block' && e.end > start).reduce((n, e) => n + e.end - Math.max(e.start, start), 0),
    calendarError,
  };
  freeCache = { key, at: Date.now(), value };
  return value;
}

const readCache = () => { try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { return {}; } };
const saveCache = (c) => { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(CACHE, JSON.stringify(c, null, 1)); };
// the judgement depends on the task and on the day, so both go into the key
const clip = (x, n) => (x.length > n ? `${x.slice(0, n).replace(/\s+\S*$/, '')} …` : x);
const taskHash = (t, today) => crypto.createHash('sha1').update([today, t.title, t.due, t.deadline, t.priority, t.assigned, t.project, t.checks.done, t.checks.total, t.body.length].join('|')).digest('hex').slice(0, 12);

// Cached estimates only (no model call): { taskId: minutes } for today's list.
export function cachedEstimates() {
  const c = readCache(), today = localDate();
  const out = Object.fromEntries(Object.entries(c).filter(([, v]) => v.day === today).map(([k, v]) => [k, v.minutes]));
  for (const t of listTasks()) if (t.estimate && t.status !== 'done') out[t.id] = t.estimate; // the owner's own time wins
  return out;
}

const system = (N = profile().name) => `You help ${N} plan ONE working day. They have more tasks due today than time. For each task you get, estimate how long
${N.toUpperCase()} needs for it today, and judge whether it truly has to happen today.
- minutes: realistic focused time for the next meaningful chunk today (15–240, in steps of 5). Admin/phone/email 15–30; research 45–90; building/writing 60–180.
- must_today = true only when postponing has a real cost: deadline today or tomorrow, a promise or appointment for today, someone is waiting and blocked,
  it's this week's WIN #1, or it unblocks today's other work. Priority "urgent" alone is not enough — people mark things urgent loosely.
  Be strict: typically 2–4 of their tasks are must_today, the rest can move.
- move_to (when must_today is false): tomorrow · weekend (personal/household things) · next_week · someday (no real commitment behind it).
- why: max 10 words, in English, the concrete reason (e.g. "deadline Thursday; 30 min call is enough", "nobody waits; next week is fine").
- "due" is only the day ${N} had planned to do it — NOT a deadline. A real deadline is marked "DEADLINE <date>". Never call a due date a deadline.
- Return one entry per task, with "task" = its title copied exactly, so answers can't get mixed up.
Use only the facts given; never invent deadlines, promises or people.`;

// Draft for today's list: estimates + keep/move for the owner's tasks (agent tasks are just listed to hand over).
export async function draft({ refresh = false } = {}) {
  const now = new Date(), today = localDate(now);
  const free = await dayFree(now);
  const open = listTasks().filter((t) => t.status !== 'done' && t.due && t.due <= today);
  const mine = open.filter((t) => t.assigned !== 'agent');
  const agents = open.filter((t) => t.assigned === 'agent');
  const cache = readCache();
  const need = mine.filter((t) => refresh || cache[t.id]?.hash !== taskHash(t, today));
  let cost = 0, estimateError = null;
  if (need.length) {
    const projects = Object.fromEntries(listProjects().map((p) => [p.slug, p.title]));
    const focus = (() => { try { return readFocus(); } catch { return null; } })();
    const wins = (focus && [focus.week, focus.next].find((x) => x?.iso === focus.current.iso)?.items.map((w, i) => `${i + 1}. ${w.text}`).join('\n')) || '';
    const lines = need.map((t, i) => `${i + 1}. "${t.title}"${t.project ? ` [project: ${projects[t.project] || t.project}]` : ''} · priority ${t.priority} · planned for ${t.due}${t.deadline ? ` · DEADLINE ${t.deadline}` : ' · no deadline'}${t.status === 'wait' ? ' · waiting on someone' : ''}${t.estimate ? ` · takes ${t.estimate} min (their own estimate)` : ''}${t.checks.total ? ` · steps ${t.checks.done}/${t.checks.total}` : ''}${t.body.trim() ? `\n   notes (shortened): ${clip(t.body.replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim(), 240)}` : ''}`).join('\n');
    const prompt = `Today is ${now.toLocaleDateString('en-GB', { weekday: 'long' })} ${today}. Free time for their own tasks today: ${Math.round(free.freeMinutes / 6) / 10} h.
${wins ? `This week's wins (in order):\n${wins}\n` : ''}Tasks due today or overdue:\n${lines}`;
    let res = null;
    try {
      res = await ask({
      system: system(), prompt, timeoutMs: 120000,
      schema: { type: 'object', required: ['tasks'], properties: { tasks: { type: 'array', items: { type: 'object', required: ['n', 'task', 'minutes', 'must_today', 'why'],
        properties: { n: { type: 'integer' }, task: { type: 'string' }, minutes: { type: 'integer' }, must_today: { type: 'boolean' }, move_to: { enum: ['tomorrow', 'weekend', 'next_week', 'someday', null] }, why: { type: 'string' } } } } } },
    });
    } catch (e) { estimateError = e.message; } // plan with defaults rather than fail the screen
    const output = res?.output || { tasks: [] };
    cost = res?.cost || 0;
    const norm = (x) => String(x || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    for (const r of output.tasks || []) {
      // match by the copied title; the number is only a fallback (models mix numbers up)
      const t = need.find((x) => norm(x.title) === norm(r.task)) || need.find((x) => norm(r.task).length > 8 && norm(x.title).startsWith(norm(r.task).slice(0, 30))) || need[r.n - 1];
      if (!t) continue;
      cache[t.id] = { day: today, hash: taskHash(t, today), minutes: Math.min(240, Math.max(15, Math.round((r.minutes || 50) / 5) * 5)),
        must: !!r.must_today, moveTo: r.must_today ? null : r.move_to || 'tomorrow', why: String(r.why || '').slice(0, 120) };
    }
    for (const [k, v] of Object.entries(cache)) if (v.day !== today) delete cache[k]; // only today's judgements
    saveCache(cache);
  }
  const soon = localDate(new Date(now.getTime() + 864e5));
  // plan vs actual (lib/daily.js): the real pace of the last two weeks sets how much of the free time to fill (at most 85%)
  const pace = (() => { try { return Daily.pace(today); } catch { return null; } })();
  const fill = Math.min(0.85, pace?.rate ?? 0.85);
  const carry = (() => { try { return Daily.carryOvers(today); } catch { return []; } })();
  return {
    free, cost, estimateError, pace, fill, capacity: Math.round(free.freeMinutes * fill), carry,
    plan: Daily.getPlan(today), oneStreak: Daily.oneStreak(today),
    // no estimate (the model failed): 50 min; must-today only for a real deadline by tomorrow
    // the owner's own time (task `estimate`) over the agent's; agentMinutes keeps the agent's for the picker
    tasks: mine.map((t) => {
      const e = cache[t.id] || { minutes: 50, must: !!t.deadline && t.deadline <= soon, moveTo: 'tomorrow', why: estimateError ? 'no estimate this time' : '' };
      return { id: t.id, ...e, agentMinutes: cache[t.id]?.minutes || null, ...(t.estimate ? { minutes: t.estimate, own: true } : {}) };
    }),
    agents: agents.map((t) => ({ id: t.id, agent: t.agent || null, state: t.agent_state || 'queued' })),
  };
}
