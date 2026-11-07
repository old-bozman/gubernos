// Settings → General → Import tasks: tasks from another app into the vault, in three steps; nothing is written before Apply.
//   read     Apple Reminders or Things 3 on this Mac, Todoist with its API token (used for this one read, never kept) — all
//            through scripts/import-tasks.mjs, read only — or any app's export / a pasted list, which the model turns into
//            the same shape ({lists: [{name, kind, area?, items: [{title, notes?, due?, time?, deadline?, priority?, …}]}]})
//   propose  each list → the project of the same name if there is one, else a new project (its category guessed by the
//            model from the list names; the owner can change it), or no project (an inbox); done items and tasks already
//            open in the vault are left out; past due dates are cleared, so Today doesn't fill up with old dates
//   apply    the lists the owner kept: new projects, then the tasks, `source: import`
// AICODE-NOTE: the model never writes here (the app's agent has no shell to run the importer); it only reads text and
// names categories, and a failed category guess falls back to a default the owner sees before Apply.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { profile } from './config.js';
import { ask, ready, current } from './llm.js';
import { toRecurrence } from '../public/recur.js';
import { createProject, createTask, httpError, listProjects, listTasks, localDate, slugify } from './vault.js';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const THINGS = process.env.GUBERNOS_THINGS_APP || '/Applications/Things3.app';
const mac = process.platform === 'darwin';
let pending = null; // the one import being looked at: {id, lists}

export function sources() {
  return [
    ...(mac ? [{ id: 'reminders', name: 'Apple Reminders', hint: 'on this Mac; macOS asks once' }] : []),
    ...(mac && fs.existsSync(THINGS) ? [{ id: 'things', name: 'Things 3', hint: 'on this Mac; macOS asks once' }] : []),
    { id: 'todoist', name: 'Todoist', hint: 'its API token: Todoist → Settings → Integrations → Developer → Copy API token. Used once, not kept', token: true },
    { id: 'file', name: 'A file or a list', hint: 'any app’s export (CSV, JSON, text), or a list pasted here', text: true },
  ];
}

const importer = (source, token) => new Promise((resolve, reject) => {
  const env = { ...process.env, ...(token ? { TODOIST_TOKEN: token } : {}) };
  execFile(process.execPath, [path.join(ROOT, 'scripts/import-tasks.mjs'), source, '--stdout'], { env, timeout: 180000, maxBuffer: 64 << 20 }, (e, out, err) => {
    if (e) return reject(httpError(400, String(err || e.message).split('\n').find((l) => l.startsWith('✗'))?.slice(2) || `couldn’t read ${source}`));
    try { resolve(JSON.parse(out).lists || []); } catch { reject(httpError(502, `couldn’t read what ${source} gave`)); }
  });
});

const ITEM = { type: 'object', required: ['title'], properties: {
  title: { type: 'string' }, notes: { type: 'string' }, due: { type: 'string', description: 'YYYY-MM-DD' }, time: { type: 'string', description: 'HH:MM' },
  deadline: { type: 'string', description: 'YYYY-MM-DD' }, priority: { enum: ['urgent', 'planned', 'someday'] },
  repeat: { type: 'string', description: 'the repeat in plain English words, e.g. "every monday", "every 2 weeks", "monthly on the 1st"' },
  subtasks: { type: 'array', items: { type: 'string' } } } };
const LISTS = { type: 'object', required: ['lists'], properties: { lists: { type: 'array', items: { type: 'object', required: ['name', 'kind', 'items'], properties: {
  name: { type: 'string' }, kind: { enum: ['inbox', 'project', 'someday'] }, items: { type: 'array', items: ITEM } } } } } };

async function fromText(text) {
  if (!ready(current())) throw httpError(409, 'Reading a file needs the model: Settings → Your Mac → Model');
  const { output } = await ask({ deep: true, timeoutMs: 240000, schema: LISTS,
    system: `You turn an export or a list from a task app (any format: CSV, JSON, markdown, plain lines) into task lists. Today is ${localDate()}.
- One list per project / list / folder in the export; items with none go to one list "Inbox" (kind inbox); a someday / maybe list is kind someday.
- Leave out items that are completed, and headers or rows that aren't tasks. Keep titles as they are (don't translate or shorten).
- Dates as YYYY-MM-DD, times as HH:MM; a repeat in plain English words; sub-items as subtasks of their task.`,
    prompt: String(text).slice(0, 150000) });
  return output.lists;
}

// the category of each new project, from the list names (a guess the owner sees; the default when the model can't)
async function guessCategories(lists, cats) {
  const fallback = cats.includes('work') ? 'work' : cats[0];
  if (!lists.length || !ready(current())) return lists.map(() => fallback);
  try {
    const { output } = await ask({ schema: { type: 'object', required: ['categories'], properties: { categories: { type: 'array', items: { enum: cats } } } },
      system: `Each line is a task list from someone's old task app. Give each one life area from: ${cats.join(', ')} (energy = health and sport; love = partner, family and friends; home = household and kids; finance = money). Answer one category per line, in order.`,
      prompt: lists.map((l, i) => `${i + 1}. ${l.name}${l.area ? ` (in ${l.area})` : ''}: ${l.items.slice(0, 4).map((t) => t.title).join('; ')}`).join('\n') });
    return lists.map((_, i) => (cats.includes(output.categories[i]) ? output.categories[i] : fallback));
  } catch { return lists.map(() => fallback); }
}

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

export async function read({ source, token, text } = {}) {
  if (!sources().some((s) => s.id === source)) throw httpError(400, 'unknown source');
  if (source === 'todoist' && !String(token || '').trim()) throw httpError(400, 'paste the Todoist API token');
  if (source === 'file' && !String(text || '').trim()) throw httpError(400, 'nothing to read');
  const raw = source === 'file' ? await fromText(text) : await importer(source, String(token || '').trim());
  const today = localDate(), open = new Set(listTasks().filter((t) => t.status !== 'done').map((t) => norm(t.title))), seen = new Set();
  const projects = listProjects(), cats = profile().categories;
  let cleared = 0, done = 0, dup = 0;
  const lists = raw.map((l, i) => {
    const items = [];
    for (const it of l.items || []) {
      const key = norm(it.title);
      if (!key) continue;
      if (it.done) { done++; continue; }
      if (open.has(key) || seen.has(key)) { dup++; continue; }
      seen.add(key);
      const recurrence = it.recurrence || (it.repeat ? toRecurrence(it.repeat, today) : null) || null, recurring = !!recurrence;
      let due = /^\d{4}-\d{2}-\d{2}$/.test(it.due || '') ? it.due : null;
      if (due && due < today) { cleared++; due = recurring ? today : null; }
      items.push({ ...it, due, recurrence });
    }
    const match = projects.find((p) => p.slug === slugify(l.name) || norm(p.title) === norm(l.name));
    const target = l.kind === 'inbox' || l.kind === 'someday' ? 'none' : match ? `project:${match.slug}` : 'new';
    return { key: String(i), name: l.name || 'Untitled', kind: l.kind, area: l.area || null, target, existing: match?.slug || null, items };
  }).filter((l) => l.items.length);
  const fresh = lists.filter((l) => l.target === 'new');
  (await guessCategories(fresh, cats)).forEach((c, i) => { fresh[i].category = c; });
  for (const l of lists) l.category ||= cats.includes('work') ? 'work' : cats[0];
  pending = { id: crypto.randomUUID(), lists };
  return { id: pending.id, source, categories: cats, skipped: { done, dup, cleared },
    lists: lists.map(({ items, ...l }) => ({ ...l, count: items.length, sample: items.slice(0, 3).map((t) => t.title) })) };
}

// choices: [{key, target: 'new' | 'none' | 'project:<slug>' | 'skip', category}]
export function apply({ id, lists: choices = [] } = {}) {
  if (!pending || pending.id !== id) throw httpError(409, 'This import has expired — read it again');
  const by = new Map(choices.map((c) => [String(c.key), c]));
  let tasks = 0;
  const made = [];
  for (const l of pending.lists) {
    const c = by.get(l.key) || {};
    const target = c.target || l.target;
    if (target === 'skip') continue;
    let project = null;
    if (target === 'new') {
      const p = createProject({ title: l.name, category: c.category || l.category, outcome: `No end: ${l.name} (imported)` });
      project = p.slug; made.push(p.title);
    } else if (target.startsWith('project:')) project = target.slice(8);
    for (const it of l.items) {
      const notes = [it.notes, it.url, it.tags?.length ? `Tags: ${it.tags.join(', ')}` : '', it.section ? `Section: ${it.section}` : '', it.repeat && !it.recurrence ? `Repeats: ${it.repeat}` : ''].filter(Boolean).join('\n\n');
      createTask({ title: it.title, project, source: 'import', notes, subtasks: it.subtasks || [],
        priority: it.priority || (l.kind === 'someday' ? 'someday' : 'planned'), due: it.due || null,
        deadline: /^\d{4}-\d{2}-\d{2}$/.test(it.deadline || '') ? it.deadline : null,
        reminder: it.due && /^\d{2}:\d{2}$/.test(it.time || '') ? `${it.due}T${it.time}` : null,
        recurrence: it.recurrence || null });
      tasks++;
    }
  }
  pending = null;
  return { tasks, projects: made };
}
