// The daily file (vault CLAUDE.md → "Daily file (Masterpiece Day)"): 50_reviews/daily/YYYY-MM-DD.md, one per day.
// Several writers share it — the morning plan (## Plan), habit check-ins (## Habits), the reflection (its own sections)
// and the assistant — so every write here changes one section and keeps the rest of the file as it is.
import fs from 'node:fs';
import path from 'node:path';
import { VAULT, localDate, httpError, getTask } from './vault.js';
import { now as clockNow } from './clock.js';

export const DIR = path.join(VAULT, '50_reviews', 'daily');
export const checkDate = (date) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw httpError(400, 'date must be YYYY-MM-DD'); return date; };
export const fileOf = (date) => path.join(DIR, `${checkDate(date)}.md`);
export const longDate = (date) => new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
export const addDays = (date, n) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + n); return localDate(d); };
const pad = (n) => String(n).padStart(2, '0');
export const stamp = (d = clockNow()) => `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function readText(date) {
  const f = fileOf(date);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
}

// head = everything before the first "## " (the title, the reflection's format marker); sections in file order.
// "### AM" inside ## Habits is not a section boundary.
export function split(text) {
  const parts = String(text || '').split(/^(?=## )/m);
  const head = parts[0]?.startsWith('## ') ? '' : parts.shift() || '';
  return {
    head,
    sections: parts.map((p) => {
      const nl = p.indexOf('\n');
      return { heading: (nl < 0 ? p : p.slice(0, nl)).slice(3).trim(), text: nl < 0 ? '' : p.slice(nl + 1) };
    }),
  };
}
// The plan first, then the habits, then everything else (the reflection, the assistant's notes) in the order it already has.
const rank = (h) => (/^plan$/i.test(h) ? 0 : /^habits$/i.test(h) ? 1 : 2);

function write(date, head, sections) {
  const title = `# Daily · ${longDate(date)}`;
  // the reflection used to own the file and called it "Daily reflection"; it's the whole day's file now
  let h = /^#\s+.*$/m.test(head) ? head.replace(/^#\s+.*$/m, title) : `${title}\n\n${head}`;
  h = h.replace(/\s*$/, '');
  const body = sections.map((s) => (s.text.trim() ? `## ${s.heading}\n\n${s.text.trim()}\n` : `## ${s.heading}\n`)).join('\n');
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(fileOf(date), `${h}\n\n${body}`.replace(/\n{3,}/g, '\n\n').replace(/\s*$/, '\n'));
}

// Change the file through fn({head, sections}) → the new {head, sections}; nothing else in the file moves.
export function update(date, fn) {
  const cur = split(readText(date) || '');
  const next = fn(cur) || cur;
  write(date, next.head, next.sections);
}

// One section: text = its new body (without the heading), null removes it. A new section goes where its rank says.
export function writeSection(date, heading, text) {
  update(date, ({ head, sections }) => {
    const i = sections.findIndex((s) => s.heading.toLowerCase() === heading.toLowerCase());
    if (text == null) { if (i >= 0) sections.splice(i, 1); } else if (i >= 0) sections[i].text = text;
    else {
      const j = sections.findIndex((s) => rank(s.heading) > rank(heading));
      sections.splice(j < 0 ? sections.length : j, 0, { heading, text });
    }
    return { head, sections };
  });
}

export function sectionText(text, heading) {
  return split(text).sections.find((s) => s.heading.toLowerCase() === heading.toLowerCase())?.text ?? null;
}

// ---------- ## Plan ----------
// <!-- set 2026-10-11T08:55 (Gubernos) -->        when the morning plan was fixed (Apply in Plan the day)
// - #1: <result> · [[task-or-win-or-goal]]       "- [x] #1: …" once it is done
// - [ ] [[task-id]] · 45 min                       the commitment for the day
// - Blocks: deep work 09:30–11:00 <!-- gcal:ID --> · deep love 18:00–19:00 <!-- gcal:ID -->
// - Added later: [[task-id]] · [[task-id]]        taken on after the plan was set
//
// Plan: 4/6 · #1 ✓ · 2 moved                     written in the evening
const LINK = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/;
const ONE_RE = /^- (?:\[([ xX])\] )?#1:\s*(.*?)\s*$/;
const TASK_RE = /^- \[([ xX])\] \[\[([^\]|]+)(?:\|[^\]]*)?\]\](?:\s+·\s+(\d+)\s*min)?\s*$/;
const BLOCK_RE = /^(deep work|deep love)\s+(\d{2}:\d{2})–(\d{2}:\d{2})(?:\s*<!-- gcal:([^\s<>]+) -->)?$/;
const LINE_RE = /^Plan:\s*(\d+)\/(\d+)(?:\s*·\s*#1\s*([✓✗]))?(?:\s*·\s*(\d+)\s*moved)?/;

export function parsePlan(text) {
  if (text == null) return null;
  const p = { setAt: null, one: null, tasks: [], blocks: [], added: [], line: null, extra: [] };
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    if (!l) continue;
    let m;
    if ((m = l.match(/^<!-- set (\S+)/))) p.setAt = m[1];
    else if ((m = l.match(ONE_RE))) {
      const link = m[2].match(new RegExp(`\\s*·\\s*${LINK.source}\\s*$`));
      p.one = { text: (link ? m[2].slice(0, link.index) : m[2]).trim(), link: link ? link[1].trim() : null, done: !!m[1] && m[1] !== ' ' };
    } else if ((m = l.match(TASK_RE))) p.tasks.push({ id: m[2].trim(), minutes: m[3] ? Number(m[3]) : null, done: m[1] !== ' ' });
    else if ((m = l.match(/^- Blocks:\s*(.*)$/))) {
      for (const part of m[1].split(/\s+·\s+/)) { const b = part.trim().match(BLOCK_RE); if (b) p.blocks.push({ kind: b[1] === 'deep love' ? 'love' : 'work', start: b[2], end: b[3], event: b[4] || null }); }
    } else if ((m = l.match(/^- Added later:\s*(.*)$/))) p.added.push(...[...m[1].matchAll(new RegExp(LINK.source, 'g'))].map((x) => x[1].trim()));
    else if ((m = l.match(LINE_RE))) p.line = { done: Number(m[1]), planned: Number(m[2]), one: m[3] ? m[3] === '✓' : null, moved: m[4] ? Number(m[4]) : 0 };
    else p.extra.push(raw);
  }
  return p;
}
export function formatPlan(p) {
  const out = [];
  if (p.setAt) out.push(`<!-- set ${p.setAt} (Gubernos) -->`);
  if (p.one?.text || p.one?.link) out.push(`- ${p.one.done ? '[x] ' : ''}#1: ${p.one.text || ''}${p.one.link ? ` · [[${p.one.link}]]` : ''}`.replace(/#1: · /, '#1: '));
  for (const t of p.tasks) out.push(`- [${t.done ? 'x' : ' '}] [[${t.id}]]${t.minutes ? ` · ${t.minutes} min` : ''}`);
  if (p.blocks.length) out.push(`- Blocks: ${p.blocks.map((b) => `${b.kind === 'love' ? 'deep love' : 'deep work'} ${b.start}–${b.end}${b.event ? ` <!-- gcal:${b.event} -->` : ''}`).join(' · ')}`);
  if (p.added.length) out.push(`- Added later: ${p.added.map((id) => `[[${id}]]`).join(' · ')}`);
  out.push(...p.extra);
  if (p.line) out.push('', `Plan: ${p.line.done}/${p.line.planned}${p.line.one == null ? '' : ` · #1 ${p.line.one ? '✓' : '✗'}`}${p.line.moved ? ` · ${p.line.moved} moved` : ''}`);
  return out.join('\n');
}
const emptyPlan = () => ({ setAt: null, one: null, tasks: [], blocks: [], added: [], line: null, extra: [] });
export const getPlan = (date) => parsePlan(sectionText(readText(date) || '', 'Plan'));
export function changePlan(date, fn) {
  const p = getPlan(date) || emptyPlan();
  fn(p);
  writeSection(date, 'Plan', formatPlan(p));
  return p;
}

// ---------- ## Habits ----------
// ### AM
// - [x] [[sun-greeting]] · 15 min        a value; "· minimum" for the easy version; quit habits: "· kept" / "· slipped"
export function parseHabits(text) {
  const groups = [];
  let g = null;
  for (const raw of String(text || '').split('\n')) {
    const l = raw.trim();
    if (!l) continue;
    const h = l.match(/^###\s+(.+)$/);
    if (h) { g = { name: h[1].trim(), entries: [] }; groups.push(g); continue; }
    if (!g) { g = { name: 'Day', entries: [] }; groups.push(g); }
    const m = l.match(/^- \[([ xX])\] \[\[([^\]|]+)(?:\|[^\]]*)?\]\](?:\s+·\s+(.*))?$/);
    if (!m) { g.entries.push({ raw }); continue; }
    const note = (m[3] || '').trim();
    const v = note.match(/^(-?\d+(?:[.,]\d+)?)\b\s*(.*)$/);
    g.entries.push({ slug: m[2].trim(), done: m[1] !== ' ', note, value: v ? Number(v[1].replace(',', '.')) : null, unit: v ? v[2] || null : null,
      minimum: /^minimum\b/i.test(note), kept: /^kept\b/i.test(note), slipped: /^slipped\b/i.test(note), skipped: /^skipped\b/i.test(note) });
  }
  return groups;
}
export function formatHabits(groups) {
  return groups.filter((g) => g.entries.length).map((g) => [`### ${g.name}`, ...g.entries.map((e) => (e.raw != null ? e.raw
    : `- [${e.done ? 'x' : ' '}] [[${e.slug}]]${e.note ? ` · ${e.note}` : ''}`))].join('\n')).join('\n');
}
// A day's check-ins: its daily file, or — once the weekly roll moved them — 80_archive/habits/<week>.md ("## YYYY-MM-DD")
const ARCHIVE = path.join(VAULT, '80_archive', 'habits');
function archivedHabits(date) {
  let names = [];
  try { names = fs.readdirSync(ARCHIVE).filter((n) => /^\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2}\.md$/.test(n)); } catch { return null; }
  const n = names.find((x) => x.slice(0, 10) <= date && x.slice(14, 24) >= date);
  if (!n) return null;
  const m = fs.readFileSync(path.join(ARCHIVE, n), 'utf8').match(new RegExp(`^## ${date}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'));
  return m ? m[1] : null;
}
export const getHabits = (date) => {
  const own = sectionText(readText(date) || '', 'Habits');
  return parseHabits(own != null ? own : archivedHabits(date) || '');
};

// ---------- the day as a whole ----------
export function readDay(date) {
  const text = readText(date);
  return { date, exists: text != null, file: path.relative(VAULT, fileOf(date)),
    plan: parsePlan(sectionText(text || '', 'Plan')), habits: parseHabits(sectionText(text || '', 'Habits')) };
}
// Dates that have a daily file, start..end inclusive.
export function datesBetween(start, end) {
  let names = [];
  try { names = fs.readdirSync(DIR).filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n)); } catch { return []; }
  return names.map((n) => n.slice(0, 10)).filter((d) => d >= start && d <= end).sort();
}

// ---------- plan vs actual ----------
const taskOrNull = (id) => { try { return getTask(id); } catch { return null; } };
const doneOn = (t, date) => !!t && t.status === 'done' && !t.dropped && !!t.completed && localDate(new Date(t.completed)) <= date;
const oneDone = (p) => !!p.one && (p.one.done || (!!p.one.link && p.tasks.some((t) => t.id === p.one.link && t.done)));

// A task changed in the app: keep today's plan honest. Done → its line is checked; reopened → unchecked; taken on for
// today after the plan was set (due today, or done today) and not in the plan → "Added later".
export function noteTask(task, { done = null, taken = false } = {}) {
  if (!task?.id) return;
  const date = localDate();
  const p = getPlan(date);
  // the day's #1 linked to this task: completing (or reopening) the task ticks it too — #1 may be set without a plan
  if (p?.one?.link === task.id && done != null && p.one.done !== done) changePlan(date, (x) => { x.one.done = done; });
  if (!p?.setAt) return;
  const inPlan = p.tasks.find((t) => t.id === task.id);
  if (inPlan && done != null && inPlan.done !== done) changePlan(date, (x) => { x.tasks.find((t) => t.id === task.id).done = done; });
  else if (!inPlan && (taken || done) && !p.added.includes(task.id)) changePlan(date, (x) => { x.added.push(task.id); });
}

// Evening: check the plan's tasks against what happened and write "Plan: done/planned · #1 ✓ · N moved".
export function closeDay(date) {
  const p = getPlan(date);
  if (!p || (!p.tasks.length && !p.one)) return null;
  return changePlan(date, (x) => {
    let moved = 0;
    for (const t of x.tasks) {
      const task = taskOrNull(t.id);
      if (!t.done && !task?.recurrence && doneOn(task, date)) t.done = true; // done outside the app (Obsidian, an agent)
      if (!t.done && task && task.status !== 'done' && (!task.due || task.due > date)) moved++;
    }
    if (x.one?.link && !x.one.done && doneOn(taskOrNull(x.one.link), date)) x.one.done = true;
    x.line = { done: x.tasks.filter((t) => t.done).length, planned: x.tasks.length, one: x.one ? oneDone(x) : null, moved };
  });
}

// Real pace: done minutes / planned minutes over the last `days` days that have a plan (50 min for a task without an
// estimate). null until 3 such days exist.
export function pace(date = localDate(), days = 14) {
  let planned = 0, done = 0, n = 0;
  for (const d of datesBetween(addDays(date, -days), addDays(date, -1))) {
    const p = getPlan(d);
    if (!p?.tasks.length) continue;
    n++;
    for (const t of p.tasks) { planned += t.minutes || 50; if (t.done) done += t.minutes || 50; }
  }
  return n >= 3 && planned ? { rate: Math.round((done / planned) * 100) / 100, days: n } : null;
}

// Days in a row with #1 done, back from today (today counts once it's done; an open today doesn't break it).
export function oneStreak(date = localDate()) {
  let n = 0, d = date;
  const today = getPlan(date);
  if (!(today && oneDone(today))) d = addDays(date, -1);
  for (;;) { const p = getPlan(d); if (!p || !oneDone(p)) break; n++; d = addDays(d, -1); }
  return n;
}
export const isOneDone = oneDone;

// Tasks left undone in the plan three days in a row (the three days before `date`) and still open: time to ask.
export function carryOvers(date = localDate()) {
  const plans = [1, 2, 3].map((k) => getPlan(addDays(date, -k)));
  if (plans.some((p) => !p?.tasks.length)) return [];
  const undone = (p) => new Set(p.tasks.filter((t) => !t.done).map((t) => t.id));
  const [a, b, c] = plans.map(undone);
  return [...a].filter((id) => b.has(id) && c.has(id)).filter((id) => { const t = taskOrNull(id); return t && t.status !== 'done'; });
}
