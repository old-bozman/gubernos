#!/usr/bin/env node
// Tasks from another app, for the onboarding's import (kit/vault/.claude/skills/onboarding/SKILL.md, step 3): reads the
// app and writes one JSON in a common shape the agent turns into the seeding sheet. Nothing is written to the vault here,
// and nothing is changed in the other app (read only).
//   node scripts/import-tasks.mjs reminders           Apple Reminders on this Mac (tools/reminders; macOS asks once)
//   node scripts/import-tasks.mjs things              Things 3 on this Mac (AppleScript; macOS asks once)
//   node scripts/import-tasks.mjs todoist             Todoist: the API token in TODOIST_TOKEN, or pasted when asked
//   … --done      completed items too (default: open only)        … --stdout   print the JSON instead of saving it
// Saved to data/import/<app>-<YYYYMMDD-HHMM>.json; a summary goes to stderr. The shape:
//   {source, at, lists: [{name, kind: inbox|list|project|area|someday, area?, notes?, deadline?, items: [{title, notes?,
//    due?, time?, deadline?, priority? (urgent|planned|someday), tags?, recurrence?, repeat?, subtasks?, section?, url?,
//    created?, done?}]}]}
// `recurrence` is already in the vault's form (cron or "every N weeks", public/recur.js); `repeat` keeps the app's own
// words when they couldn't be converted.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import readline from 'node:readline';
import { toRecurrence } from '../public/recur.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = process.env.GUBERNOS_DATA_DIR || path.join(ROOT, 'data');
const args = process.argv.slice(2), source = args[0], withDone = args.includes('--done');
const pad = (n) => String(n).padStart(2, '0');
const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = localDay(new Date());
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)));
const recur = (words) => { if (!words) return {}; const r = toRecurrence(words, today); return r ? { recurrence: r } : { repeat: words }; };

// ---------- Apple Reminders (tools/reminders/gubernos-reminders, EventKit) ----------
const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const nth = (n) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
function reminderRepeat(r, due) {
  if (!r) return null;
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[r.freq];
  if (r.interval > 1) return `every ${r.interval} ${unit}s`;
  if (r.freq === 'weekly' && r.days?.length) return `every ${r.days.map((d) => DOW[d]).join(' and ')}`;
  if (r.freq === 'weekly' && due) return `every ${DOW[new Date(`${due}T12:00:00`).getDay()]}`;
  if (r.freq === 'monthly' && r.monthDays?.length === 1) return `monthly on the ${nth(r.monthDays[0])}`;
  if (r.freq === 'monthly' && due) return `monthly on the ${nth(+due.slice(8))}`;
  if (r.freq === 'yearly' && due) return `every year on ${+due.slice(8)} ${new Date(`${due}T12:00:00`).toLocaleString('en', { month: 'short' }).toLowerCase()}`;
  return `every ${unit}`;
}
function reminders() {
  const bin = path.join(ROOT, 'tools', 'reminders', 'gubernos-reminders');
  let raw;
  try { raw = execFileSync(bin, ['export', ...(withDone ? ['--done'] : [])], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { raw = e.stdout || ''; }
  const j = JSON.parse(raw || '{}');
  if (j.error) throw new Error(j.error);
  return j.lists.map((l) => ({
    name: l.name, kind: 'list',
    items: l.items.map((r) => clean({
      title: r.title, notes: r.notes, due: r.due, time: r.time, url: r.url, created: r.created?.slice(0, 10), done: r.completed || null,
      priority: r.priority >= 1 && r.priority <= 4 ? 'urgent' : r.priority === 5 ? 'planned' : null, // EventKit: 1–4 high, 5 medium, 6–9 low
      ...recur(reminderRepeat(r.repeat, r.due)),
    })),
  }));
}

// ---------- Things 3 (AppleScript through JXA) ----------
// Lists Inbox, Today, Upcoming, Anytime, Someday (Logbook with --done): each open to-do once; projects with their area.
// Things' scripting has no checklists or repeat rules: a repeating to-do comes as its next copy.
const THINGS_JXA = `
function run(argv) {
  const app = Application('Things3'), done = argv[0] === 'done';
  const s = (f) => { try { const v = f(); return v === undefined ? null : v; } catch (e) { return null; } };
  const day = (d) => d ? d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) : null;
  const projects = app.projects(), pids = {};
  const P = projects.map((p) => { const id = p.id(); pids[id] = 1; return { id, name: p.name(), notes: s(() => p.notes()), area: s(() => p.area() && p.area().name()), deadline: day(s(() => p.dueDate())), when: day(s(() => p.activationDate())), status: p.status() }; });
  const seen = {}, T = [];
  for (const ln of ['Inbox', 'Today', 'Upcoming', 'Anytime', 'Someday'].concat(done ? ['Logbook'] : [])) {
    const L = app.lists.byName(ln).toDos;
    const ids = L.id(), names = L.name(), notes = L.notes(), dues = L.dueDate(), acts = L.activationDate(), tags = L.tagNames(), st = L.status(), made = L.creationDate();
    for (let i = 0; i < ids.length; i++) {
      if (seen[ids[i]] || pids[ids[i]]) continue;
      seen[ids[i]] = 1;
      const t = L[i];
      T.push({ list: ln, title: names[i], notes: notes[i], deadline: day(dues[i]), when: day(acts[i]), tags: tags[i], status: st[i], created: day(made[i]),
        project: s(() => t.project() && t.project().name()), area: s(() => t.area() && t.area().name()) });
    }
  }
  return JSON.stringify({ projects: P, todos: T });
}`;
function things() {
  let raw;
  try { raw = execFileSync('osascript', ['-l', 'JavaScript', '-e', THINGS_JXA, withDone ? 'done' : 'open'], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { throw new Error(/-1743|not allowed/i.test(e.stderr || '') ? 'macOS didn\'t allow controlling Things: System Settings → Privacy & Security → Automation → your terminal or agent → Things 3' : /-1728|-2700|find/i.test(e.stderr || '') ? 'Things 3 isn\'t installed (or never opened) on this Mac' : String(e.stderr || e.message).trim()); }
  const { projects, todos } = JSON.parse(raw);
  const lists = new Map();
  const list = (key, o) => { if (!lists.has(key)) lists.set(key, { ...o, items: [] }); return lists.get(key); };
  list('inbox', { name: 'Inbox', kind: 'inbox' });
  for (const p of projects.filter((x) => withDone || x.status === 'open')) list(`p:${p.name}`, clean({ name: p.name, kind: 'project', area: p.area, notes: p.notes, deadline: p.deadline }));
  for (const t of todos) {
    if (!withDone && t.status !== 'open') continue;
    const l = t.project ? list(`p:${t.project}`, { name: t.project, kind: 'project' }) : t.area ? list(`a:${t.area}`, { name: t.area, kind: 'area' }) : t.list === 'Someday' ? list('someday', { name: 'Someday', kind: 'someday' }) : list('inbox', { name: 'Inbox', kind: 'inbox' });
    l.items.push(clean({
      title: t.title, notes: t.notes, deadline: t.deadline, due: t.list === 'Today' ? today : t.when, created: t.created, done: t.status === 'completed' || null,
      priority: t.list === 'Someday' ? 'someday' : null, tags: t.tags ? t.tags.split(/,\s*/) : null,
    }));
  }
  return [...lists.values()].filter((l) => l.items.length || l.kind === 'project');
}

// ---------- Todoist (API v1, read only) ----------
const TODOIST = process.env.GUBERNOS_TODOIST_API || 'https://api.todoist.com/api/v1';
async function ask(q) {
  if (!process.stdin.isTTY) throw new Error('no terminal to ask in: copy your API token (Todoist → Settings → Integrations → Developer) and run\n  TODOIST_TOKEN=$(pbpaste) node scripts/import-tasks.mjs todoist');
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const a = await new Promise((r) => rl.question(q, r)); rl.close(); return a.trim();
}
async function todoist() {
  const token = process.env.TODOIST_TOKEN || await ask('Todoist API token (Settings → Integrations → Developer): ');
  const all = async (what) => {
    const out = []; let cursor = null;
    do {
      const r = await fetch(`${TODOIST}/${what}?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.status === 401 || r.status === 403) throw new Error('Todoist didn\'t take the token (Settings → Integrations → Developer → copy the API token)');
      if (!r.ok) throw new Error(`Todoist ${what}: ${r.status}`);
      const j = await r.json(); out.push(...(j.results || [])); cursor = j.next_cursor;
    } while (cursor);
    return out;
  };
  const [projects, sections, tasks] = [await all('projects'), await all('sections'), await all('tasks')];
  const pById = new Map(projects.map((p) => [p.id, p])), sById = new Map(sections.map((s) => [s.id, s.name]));
  const lists = new Map(projects.filter((p) => !p.is_archived && !p.is_deleted).map((p) => [p.id, clean({
    name: p.inbox_project ? 'Inbox' : p.name, kind: p.inbox_project ? 'inbox' : 'project', area: p.parent_id ? pById.get(p.parent_id)?.name : null, notes: p.description, items: [],
  })]));
  for (const l of lists.values()) l.items ||= [];
  const open = tasks.filter((t) => !t.is_deleted && (withDone || !t.checked));
  const kids = new Map();
  for (const t of open) if (t.parent_id) kids.set(t.parent_id, [...(kids.get(t.parent_id) || []), t.content]);
  for (const t of open) {
    if (t.parent_id && open.some((x) => x.id === t.parent_id)) continue; // a subtask: a line under its parent
    const l = lists.get(t.project_id); if (!l) continue;
    // a fixed-time due comes in UTC (…Z): this Mac's local time; a floating one is local already
    const due = t.due?.date?.endsWith('Z') ? (() => { const d = new Date(t.due.date); return `${localDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; })() : t.due?.date || null, words = t.due?.is_recurring ? String(t.due.string || '').replace(/\bevery!/i, 'every').replace(/\bworkday\b/i, 'weekday') : null;
    l.items.push(clean({
      title: t.content, notes: t.description, due: due?.slice(0, 10), time: due?.length > 10 ? due.slice(11, 16) : null, deadline: t.deadline?.date,
      priority: { 4: 'urgent', 3: 'planned', 2: 'planned' }[t.priority] || null, tags: t.labels, section: t.section_id ? sById.get(t.section_id) : null,
      subtasks: kids.get(t.id), url: `https://app.todoist.com/app/task/${t.id}`, created: t.added_at?.slice(0, 10), done: t.checked || null,
      ...recur(words),
    }));
  }
  return [...lists.values()];
}

// ---------- run ----------
const READERS = { reminders, things, todoist };
if (!READERS[source]) { console.error('usage: node scripts/import-tasks.mjs reminders | things | todoist [--done] [--stdout]'); process.exit(1); }
try {
  const lists = await READERS[source]();
  const result = { source, at: new Date().toISOString(), lists };
  const n = lists.reduce((a, l) => a + l.items.length, 0);
  const summary = `${source}: ${n} item${n === 1 ? '' : 's'} in ${lists.filter((l) => l.items.length).length} list${lists.length === 1 ? '' : 's'}`
    + ` · ${lists.flatMap((l) => l.items).filter((i) => i.due).length} with a date · ${lists.flatMap((l) => l.items).filter((i) => i.recurrence || i.repeat).length} repeating`;
  if (args.includes('--stdout')) { console.log(JSON.stringify(result, null, 1)); console.error(summary); }
  else {
    const d = new Date(), file = path.join(DATA, 'import', `${source}-${localDay(d).replace(/-/g, '')}-${pad(d.getHours())}${pad(d.getMinutes())}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(result, null, 1));
    console.log(`${summary}\n→ ${file}`);
  }
} catch (e) { console.error(`✗ ${e.message}`); process.exit(2); }
