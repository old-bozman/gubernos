// Morning brief: the agent's first message of the day in the app's chat — a short agenda, then what the agent can take on
// today as ▶ Do it buttons. A first step towards agents that come to the owner instead of waiting to be asked.
// The facts (#1, wins, decisions, calendar, tasks, agents' work, yesterday) are put together here, by code; the model
// (lib/llm.js) writes only "How to run today" and "I can do today", from those facts, so it can't invent a meeting or a
// deadline. Built at Settings → digestAt (08:30, with the morning push) so it's ready when the app opens; built on the
// spot if the Mac was asleep. Kept in data/brief/<date>.json with when it was seen and which buttons were used (the test:
// is #1 set and done more often with it?).
// AICODE-NOTE: the developer's own install only for now (config.json "morningBrief": true turns it on elsewhere). It gives the
// model today's event titles and times: the privacy policy says Gubernos doesn't (docs/google-verification.md §3), so that
// sentence changes before the brief goes to anyone else.
import fs from 'node:fs';
import path from 'node:path';
import { listTasks, localDate } from './vault.js';
import { listDecisions, attentionItems, currentWins } from './model.js';
import * as Daily from './daily.js';
import * as H from './habits.js';
import * as G from './calendar.js';
import { dayFree } from './planner.js';
import { ask } from './llm.js';
import { profile, BRIEF } from './config.js';
import * as Settings from './settings.js';

const DATA = process.env.GUBERNOS_DATA_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data');
const DIR = path.join(DATA, 'brief');
export const enabled = () => BRIEF;
const fileOf = (date) => path.join(DIR, `${date}.json`);
const load = (date) => { try { return JSON.parse(fs.readFileSync(fileOf(date), 'utf8')); } catch { return null; } };
const save = (b) => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(fileOf(b.date), JSON.stringify(b, null, 1)); return b; };

const short = (s, n = 70) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const link = (t) => `[${short(t.title).replace(/\[/g, '(').replace(/\]/g, ')')}](#/task/${t.id})`; // "[peoplos] Launch…" would break the link
const dayName = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const hm = (s) => String(s).slice(11, 16);
const ORDER = { urgent: 0, planned: 1, someday: 2 };

// Everything the brief says, from the vault and the calendar. → plain data (tests call it with a fixed date)
export async function facts(now = new Date()) {
  const today = localDate(now), yesterday = Daily.addDays(today, -1), soon = Daily.addDays(today, 3);
  const tasks = listTasks(), open = tasks.filter((t) => t.status !== 'done');
  const mine = open.filter((t) => t.assigned !== 'agent' && t.status !== 'wait');
  const plan = Daily.getPlan(today), yplan = Daily.getPlan(yesterday);
  const oneTask = plan?.one?.link ? tasks.find((t) => t.id === plan.one.link) : null;
  let wins = null; try { wins = currentWins(); } catch { /* no focus.md */ }
  let decisions = []; try { decisions = listDecisions(); } catch { /* no model */ }
  let attention = []; try { attention = attentionItems(new Set(open.filter((t) => t.project).map((t) => t.project)), now); } catch { /* no model */ }
  let habitsY = null; try { if (H.enabled()) { const s = H.summary(yesterday); if (s.length) habitsY = { done: s.reduce((n, g) => n + g.done, 0), total: s.reduce((n, g) => n + g.total, 0) }; } } catch { /* no habits */ }
  let events = [], free = null, calendarError = null;
  try {
    events = (await G.listEvents({ from: today })).filter((e) => e.allDay || String(e.start).slice(0, 10) === today)
      .map((e) => ({ title: e.title, start: e.allDay ? null : hm(e.start), end: e.allDay ? null : hm(e.end), allDay: !!e.allDay }));
    const f = await dayFree(now); free = f.calendarError ? null : f.freeMinutes;
  } catch (e) { calendarError = e.message; }
  const byPrio = (a, b) => (ORDER[a.priority] ?? 3) - (ORDER[b.priority] ?? 3) || String(a.due).localeCompare(String(b.due));
  const pick = (t) => ({ id: t.id, title: t.title, priority: t.priority, due: t.due, deadline: t.deadline, project: t.project });
  return {
    date: today, name: profile().name,
    one: plan?.one ? { text: plan.one.text || oneTask?.title || plan.one.link, task: oneTask?.id || null, done: Daily.isOneDone(plan) } : null,
    wins: (wins?.items || []).map((w) => ({ text: w.text.replace(/\s*·\s*\[\[[^\]]+\]\]\s*$/, ''), done: w.done })),
    events, free, calendarError,
    decisions: decisions.filter((d) => d.status === 'open' && d.decide_by && d.decide_by <= soon).sort((a, b) => a.decide_by.localeCompare(b.decide_by))
      .map((d) => ({ slug: d.slug, question: d.question, by: d.decide_by, rec: d.rec ? `${d.rec}: ${short(d.recommendation.replace(/^\*\*[A-Z]\*\*\s*[,:.—-]?\s*/, ''), 140)}` : null })),
    overdue: mine.filter((t) => t.due && t.due < today).sort(byPrio).map(pick),
    dueToday: mine.filter((t) => t.due === today || (t.deadline && t.deadline <= today && !(t.due && t.due < today))).sort(byPrio).map(pick),
    waiting: open.filter((t) => t.status === 'wait' && t.assigned !== 'agent' && t.due && t.due <= today).map(pick),
    review: open.filter((t) => t.assigned === 'agent' && t.agent_state === 'review').map(pick),
    blocked: open.filter((t) => t.assigned === 'agent' && t.agent_state === 'blocked').map(pick),
    attention: attention.map((a) => ({ title: a.title, type: a.type, deadline: a.deadline, overdue: a.overdue })),
    yesterday: { plan: yplan?.line || null, habits: habitsY },
    open: open.filter((t) => t.assigned !== 'agent').sort(byPrio).slice(0, 40).map(pick), // what the model may offer to work on
  };
}

// The agenda in markdown: only the parts that have something in them.
export function agenda(f) {
  const out = [`**Good morning${f.name && f.name !== 'Me' ? `, ${f.name.split(/\s+/)[0]}` : ''}** · ${dayName(f.date)}`];
  const today = [];
  if (f.one) today.push(`- **#1:** ${f.one.task ? link({ title: f.one.text, id: f.one.task }) : short(f.one.text)}${f.one.done ? ' ✓' : ''}`);
  else today.push('- **#1:** not set yet: choose it in Plan the day');
  const openWins = f.wins.filter((w) => !w.done);
  if (openWins.length) today.push(`- **This week:** ${openWins.map((w) => short(w.text, 60)).join(' · ')}`);
  const timed = f.events.filter((e) => !e.allDay), allDay = f.events.filter((e) => e.allDay);
  if (timed.length) today.push(`- **Calendar:** ${timed.slice(0, 8).map((e) => `${e.start}–${e.end} ${short(e.title, 40)}`).join(' · ')}${timed.length > 8 ? ` · +${timed.length - 8} more` : ''}`);
  if (allDay.length) today.push(`- **All day:** ${allDay.map((e) => short(e.title, 40)).join(' · ')}`);
  if (f.free != null) today.push(`- **Free for work:** ${Math.floor(f.free / 60)}h${f.free % 60 ? ` ${f.free % 60}m` : ''}`);
  else if (f.calendarError) today.push('- **Calendar:** couldn’t read it this morning');
  out.push('', '**Today**', ...today);

  const you = [];
  for (const d of f.decisions) you.push(`- **Decide** ${d.by < f.date ? '(overdue)' : d.by === f.date ? '(today)' : `(by ${dayName(d.by)})`}: ${short(d.question, 90)}${d.rec ? ` → I’d say ${d.rec}` : ''}`);
  if (f.overdue.length) you.push(`- **Overdue:** ${f.overdue.slice(0, 4).map(link).join(' · ')}${f.overdue.length > 4 ? ` · +${f.overdue.length - 4}` : ''}`);
  if (f.dueToday.length) you.push(`- **Due today:** ${f.dueToday.slice(0, 5).map(link).join(' · ')}${f.dueToday.length > 5 ? ` · +${f.dueToday.length - 5}` : ''}`);
  if (f.waiting.length) you.push(`- **Waiting on others, due:** ${f.waiting.slice(0, 3).map(link).join(' · ')}`);
  if (f.review.length) you.push(`- **Agents’ work to review:** ${f.review.slice(0, 3).map(link).join(' · ')}${f.review.length > 3 ? ` · +${f.review.length - 3}` : ''}`);
  if (f.blocked.length) you.push(`- **Agents need you:** ${f.blocked.slice(0, 3).map(link).join(' · ')}`);
  if (f.attention.length) you.push(`- **Time to prepare:** ${f.attention.slice(0, 3).map((a) => `${short(a.title, 50)}${a.deadline ? ` (${a.overdue ? 'overdue' : `by ${dayName(a.deadline)}`})` : ''}`).join(' · ')}`);
  if (you.length) out.push('', '**Needs you**', ...you);

  const y = f.yesterday, ybits = [];
  if (y.plan) ybits.push(`plan ${y.plan.done}/${y.plan.planned}${y.plan.one == null ? '' : ` · #1 ${y.plan.one ? '✓' : '✗'}`}${y.plan.moved ? ` · ${y.plan.moved} moved` : ''}`);
  if (y.habits) ybits.push(`habits ${y.habits.done}/${y.habits.total}`);
  if (ybits.length) out.push('', `**Yesterday:** ${ybits.join(' · ')}`);
  return out.join('\n');
}

const SCHEMA = { type: 'object', required: ['advice', 'offers'], properties: {
  advice: { type: 'array', items: { type: 'string' } },
  offers: { type: 'array', items: { type: 'object', required: ['text', 'task_id'], properties: { text: { type: 'string' }, task_id: { type: ['string', 'null'] } } } },
} };
const system = (N) => `You are ${N}'s assistant in Gubernos, their personal system. Every morning you open their day with a short brief.
The agenda is already written (given below, from their vault and calendar). You add two things, in English, short and concrete:
1. advice: 2–3 lines, one sentence each (under 25 words), on how to run today: what to protect (the #1, a focus window), what to drop or move, where the day is
   overloaded or fragile. Base each line on a fact in the agenda (a meeting, a deadline, yesterday's result); no generic tips,
   no greetings, never repeat the agenda back.
2. offers: up to 3 pieces of real work an AI agent could do for ${N} today, end to end, that move something in the agenda: research
   and compare, prepare a brief for a meeting, draft a document or a message for review, collect information. The agent can
   browse the web, read their Gmail and Calendar and write notes into the vault; it can't send, buy, call or decide for them.
   text = the instruction to the agent, self-contained, one or two sentences, starting with a verb ("Compare … and save …").
   task_id = the id of the task it is about (from the lists), or null for new work. Nothing that just restates a task as is.
Never invent facts that are not in the agenda or the lists.`;

export async function build(now = new Date()) {
  const f = await facts(now);
  const text = agenda(f);
  let advice = [], offers = [];
  try {
    const ids = new Set([...f.open, ...f.overdue, ...f.dueToday, ...f.waiting].map((t) => t.id));
    const prompt = `Today is ${new Date(`${f.date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}.\n\nThe agenda:\n${text}\n\n`
      + `Their open tasks (id · title · priority · due · project):\n${f.open.map((t) => `- ${t.id} · ${t.title} · ${t.priority} · ${t.due || '-'} · ${t.project || '-'}`).join('\n') || '(none)'}\n`
      + `${f.decisions.length ? `\nDecisions due:\n${f.decisions.map((d) => `- ${d.question} (by ${d.by})${d.rec ? `; recommended ${d.rec}` : ''}`).join('\n')}\n` : ''}`;
    const r = await ask({ system: system(profile().name), prompt, schema: SCHEMA, deep: true, timeoutMs: 120000 });
    advice = (r.output.advice || []).map((s) => String(s).trim()).filter(Boolean).slice(0, 3);
    offers = (r.output.offers || []).filter((o) => String(o.text || '').trim()).slice(0, 3)
      .map((o) => ({ text: String(o.text).trim(), taskId: o.task_id && ids.has(o.task_id) ? o.task_id : null }));
  } catch (e) { console.warn('[brief] the model part:', String(e.message).slice(0, 200)); }
  const parts = [text];
  if (advice.length) parts.push('', '**How to run today**', ...advice.map((a) => `- ${a}`));
  if (offers.length) parts.push('', '**I can do today**', ...offers.map((o) => `- ${o.text}`));
  const actions = [...offers.map((o) => ({ type: 'run', taskId: o.taskId, text: o.text, items: [] })), { type: 'plan_day', items: [] }];
  const prev = load(f.date);
  return save({ date: f.date, at: new Date().toISOString(), text: parts.join('\n'), actions, model: advice.length > 0 || offers.length > 0, seenAt: prev?.seenAt || null, used: prev?.used || [] });
}

// one build at a time per day: the morning tick and an app opening at the same minute share it
let building = null;
export function ensure(now = new Date()) {
  const date = localDate(now), have = load(date);
  if (have) return Promise.resolve(have);
  if (building?.date !== date) building = { date, p: build(now).finally(() => { building = null; }) };
  return building.p;
}
// Prepared ahead, at the morning push's time (lib/notify.js, every 20 s): nothing is awaited there.
export function prepare(now = new Date()) {
  const at = Settings.get().digestAt || '08:30', t = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (!enabled() || t < at || t >= '14:00' || load(localDate(now)) || building) return;
  ensure(now).catch((e) => console.warn('[brief]', e.message));
}
// the app asks once per open: whether to show it (not seen yet today, in the morning), and the brief itself
export const status = (now = new Date()) => { const b = load(localDate(now)); return { enabled: enabled(), ready: !!b, seen: !!b?.seenAt }; };
export async function open({ seen = true } = {}, now = new Date()) {
  if (!enabled()) return { enabled: false };
  const b = await ensure(now);
  if (seen && !b.seenAt) { b.seenAt = new Date().toISOString(); save(b); }
  return b;
}
export function used({ type }, now = new Date()) {
  const b = load(localDate(now));
  if (!b) return { ok: false };
  b.used.push({ type: String(type || ''), at: new Date().toISOString() });
  save(b);
  return { ok: true };
}
export const today = (now = new Date()) => load(localDate(now));
