// Read/write layer over the Obsidian vault. Markdown files are the only store.
// AICODE-NOTE: frontmatter is edited through yaml's Document API so untouched keys keep
// their original formatting (flow vs block lists, quoting) — Obsidian and other agents
// read these files too, so minimal diffs matter.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';
import { nextCronDate } from './cron.js';
import { now as clockNow } from './clock.js';
import { VAULT, OBSIDIAN, profile } from './config.js';
import { agentList } from './settings.js';

export { VAULT };

export const DIRS = {
  tasks: path.join(VAULT, '10_tasks'),
  projects: path.join(VAULT, '20_projects'),
  goals: path.join(VAULT, '30_goals'),
  inbox: path.join(VAULT, '01_inbox'),
  archive: path.join(VAULT, '80_archive'),
  checklists: path.join(VAULT, '91_templates', 'checklists'),
};

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const CHECK_RE = /^(\s*[-*+] \[)([ xX])(\]\s?)(.*)$/;
// "- ⏱ 2026-09-25 10:00–10:50 · label <!-- gcal:EVENT_ID -->" lines under "## Time blocks"
const TB_RE = /^- ⏱ (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})–(\d{2}:\d{2})(?: · (.*?))? <!-- gcal:([^\s<>]+) -->$/gm;
const TASK_FIELDS = ['title', 'status', 'priority', 'assigned', 'project', 'due', 'deadline',
  'reminder', 'recurrence', 'labels', 'agent_state', 'agent', 'estimate'];

// ---------- low-level file helpers ----------

// AICODE-NOTE: iCloud may leave a file "dataless" (a placeholder, e.g. one the assistant just wrote on another Mac). Reading it
// from the launchd-started server fails with errno -11 (EDEADLK) instead of downloading it — ask iCloud to download, retry.
const isDataless = (e) => e?.errno === -11 || e?.code === 'EDEADLK' || /system error -11/.test(e?.message || '');
const downloading = new Map(); // file → time the download was requested (don't wait on it again for a while)
function readText(file) {
  try { const t = fs.readFileSync(file, 'utf8'); downloading.delete(file); return t; } catch (e) {
    if (!isDataless(e)) throw e;
    const asked = downloading.get(file);
    if (!asked || Date.now() - asked > 60000) {
      downloading.set(file, Date.now());
      try { execFileSync('/usr/bin/brctl', ['download', file], { timeout: 10000, stdio: 'ignore' }); } catch { /* fall through */ }
    }
    for (let i = 0; i < (asked ? 0 : 6); i++) {
      try { return fs.readFileSync(file, 'utf8'); } catch (e2) { if (!isDataless(e2)) throw e2; }
      execFileSync('/bin/sleep', ['0.25']);
    }
    console.error(`[vault] ${path.basename(file)} is an iCloud placeholder; download requested`);
    throw Object.assign(new Error(`iCloud hasn't downloaded ${path.basename(file)} yet`), { status: 503, dataless: true });
  }
}

// One unreadable file must not take a whole list down: skip it (logged) and show the rest.
function safeMap(files, fn) {
  return files.map((f) => {
    try { return fn(f); } catch (e) {
      if (!e.dataless && !isDataless(e)) throw e;
      // logged in readText
      return null;
    }
  }).filter(Boolean);
}

export function readDoc(file) {
  const text = readText(file);
  const m = text.match(FM_RE);
  if (!m) return { doc: new YAML.Document({}), fm: {}, body: text };
  const doc = YAML.parseDocument(m[1]);
  return { doc, fm: doc.toJS() || {}, body: text.slice(m[0].length) };
}

export function writeDoc(file, doc, body) {
  const fm = doc.toString({ lineWidth: 0, flowCollectionPadding: false }).replace(/\n+$/, '');
  fs.writeFileSync(file, `---\n${fm}\n---\n${body}`);
}

function setField(doc, key, value) {
  if (value === undefined) return;
  // AICODE-NOTE: ids must stay strings — an unquoted id like 6e123… would parse as a YAML float.
  if (key === 'todoist_id' && typeof value === 'string' && value) {
    const node = doc.createNode(value);
    node.type = 'QUOTE_DOUBLE';
    doc.set(key, node);
    return;
  }
  if (Array.isArray(value)) {
    const node = doc.createNode(value);
    node.flow = true;
    doc.set(key, node);
  } else {
    doc.set(key, value === '' ? null : value);
  }
}

const str = (v) => (v === null || v === undefined || v === '' ? null : String(v));
const linkSlug = (v) => { const s = str(v); return s ? s.replace(/^\[\[|\]\]$/g, '').split('|')[0].trim() : null; };
const asList = (v) => (Array.isArray(v) ? v.map(String) : v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : []);

function h1(body) {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim().replace(/^(\*\*|__)(.+)\1$/, '$2').trim() : null; // a bold first line (Telegram forwards) is still the title
}

export function pad(n) { return String(n).padStart(2, '0'); }
export function localDate(d = clockNow()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function localStamp(d = clockNow()) { return `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }

const TRANSLIT = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ы:'y',э:'e',ю:'yu',я:'ya' };
export function slugify(s) {
  const t = s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[а-яё]/g, (c) => TRANSLIT[c] ?? '');
  return t.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).replace(/-$/, '') || 'task';
}

function listMd(dir) {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.md') && !f.startsWith('.')); } catch { return []; }
}

// ---------- body helpers ----------

// Checkbox lines outside code fences, in document order. Index is the public handle.
export function checkboxLines(body) {
  const out = [];
  let fence = false;
  body.split('\n').forEach((line, i) => {
    if (/^\s*```/.test(line)) fence = !fence;
    if (fence) return;
    const m = line.match(CHECK_RE);
    if (m) out.push({ line: i, done: m[2] !== ' ', text: m[4].replace(/<!--.*?-->/g, '').trim() });
  });
  return out;
}

function sectionRange(lines, re) {
  const start = lines.findIndex((l) => re.test(l));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^#{1,2}\s/.test(lines[i])) { end = i; break; }
  while (end > start + 1 && lines[end - 1].trim() === '') end--;
  return { start, end };
}

// Append lines at the end of a `## heading` section, creating it (at file end) if missing.
export function appendToSection(body, heading, newLines) {
  const lines = body.replace(/\s+$/, '').split('\n');
  const r = sectionRange(lines, new RegExp(`^##\\s+${heading}\\s*$`, 'i'));
  if (!r) return `${lines.join('\n')}\n\n## ${heading}\n\n${newLines.join('\n')}\n`;
  // drop the empty template placeholder `- [ ]` if present
  const sec = lines.slice(r.start + 1, r.end).filter((l) => !/^\s*[-*+] \[ \]\s*$/.test(l));
  const head = lines.slice(0, r.start + 1);
  const tail = lines.slice(r.end);
  while (tail.length && !tail[0].trim()) tail.shift();
  const secTrim = sec.join('\n').replace(/^\n+/, '').replace(/\n+$/, ''); // no blank lines piling up at the section end
  const merged = [...head, '', ...(secTrim ? [secTrim] : []), ...newLines];
  return `${merged.join('\n')}${tail.length ? '\n\n' + tail.join('\n') : ''}\n`;
}

// ---------- tasks ----------

// "## WOOP" (Gabriele Oettingen): Wish · Outcome · Obstacle · Plan ("If … → then …"), one "- Key: text" line each.
// Other lines in the section (the owner's own notes) stay below them.
export const WOOP_KEYS = ['wish', 'outcome', 'obstacle', 'plan'];
const WOOP_SECTION = /^##\s+WOOP\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m;
const WOOP_LINE = /^\s*[-*]\s*(Wish|Outcome|Obstacle|Plan)\s*:\s*(.*)$/i;
export function parseWoop(body) {
  const m = body.match(WOOP_SECTION);
  if (!m) return null;
  const w = {};
  for (const l of m[1].split('\n')) { const x = l.match(WOOP_LINE); if (x && x[2].trim()) w[x[1].toLowerCase()] = x[2].trim(); }
  return Object.keys(w).length ? w : null;
}
function setWoop(body, patch) {
  const m = body.match(WOOP_SECTION);
  const w = { ...(parseWoop(body) || {}) };
  for (const k of WOOP_KEYS) {
    if (patch[k] === undefined || patch[k] === null) continue;
    const v = String(patch[k]).replace(/\s+/g, ' ').trim();
    if (v) w[k] = v; else delete w[k];
  }
  const extra = m ? m[1].split('\n').filter((l) => l.trim() && !WOOP_LINE.test(l)) : [];
  const lines = [...WOOP_KEYS.filter((k) => w[k]).map((k) => `- ${k[0].toUpperCase()}${k.slice(1)}: ${w[k]}`), ...extra];
  if (m) return lines.length ? body.replace(WOOP_SECTION, `## WOOP\n\n${lines.join('\n')}\n\n`) : body.replace(WOOP_SECTION, '').replace(/\n{3,}/g, '\n\n');
  if (!lines.length) return body;
  // a new section goes above the task's other sections (Subtasks, Notes, Chat…), under any intro text
  const block = `## WOOP\n\n${lines.join('\n')}\n\n`, i = body.search(/^## /m);
  return i < 0 ? `${body.replace(/\s*$/, '')}\n\n${block.trimEnd()}\n` : `${body.slice(0, i)}${block}${body.slice(i)}`;
}

function taskFromFile(file, folder) {
  const { fm, body } = readDoc(file);
  if (fm.type !== 'task') return null;
  const id = path.basename(file, '.md');
  // Index `i` is the position among all checkbox lines — the same handle PATCH {toggleCheck} uses.
  const subtasks = checkboxLines(body).map((c, i) => ({ i, done: c.done, text: c.text })).filter((c) => c.text);
  const timeblocks = [...body.matchAll(TB_RE)].map((m) => ({ start: `${m[1]}T${m[2]}`, end: `${m[1]}T${m[3]}`, label: m[4] || '', event: m[5] }));
  const checks = subtasks;
  const stat = fs.statSync(file);
  return {
    id, folder, file: path.relative(VAULT, file), abs: file,
    title: str(fm.title) || h1(body) || id.replace(/^\d{8}-\d{6}-/, '').replace(/-/g, ' '),
    status: str(fm.status) || 'new',
    priority: str(fm.priority) || 'planned',
    assigned: str(fm.assigned) || 'me',
    project: linkSlug(fm.project),
    due: str(fm.due), deadline: str(fm.deadline), reminder: str(fm.reminder),
    recurrence: str(fm.recurrence),
    labels: asList(fm.labels),
    source: str(fm.source),
    checklist: fm.checklist === true || fm.checklist === 'true',
    todoist_id: str(fm.todoist_id),
    agent_state: str(fm.agent_state),
    agent: str(fm.agent), // which agent: claude | codex | the profile's assistant; null = any
    completed: str(fm.completed),
    dropped: fm.dropped === true || fm.dropped === 'true',
    created: /^\d{8}-\d{6}/.test(id) ? `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}` : null,
    body: body.replace(/^\s*#\s+.+\n?/, '').replace(/^\n+/, ''),
    checks: { done: checks.filter((c) => c.done).length, total: checks.length },
    subtasks,
    timeblocks,
    woop: parseWoop(body),
    moved: Number(fm.moved) || 0, // times the due date was pushed later once it had come (updateTask)
    estimate: Number(fm.estimate) || null, // minutes it takes, set by the owner; Plan the day uses it over the agent's estimate
    mtime: stat.mtimeMs,
  };
}

export function listTasks() {
  return safeMap(listMd(DIRS.tasks), (f) => taskFromFile(path.join(DIRS.tasks, f), 'tasks'));
}

export function listLogbook(limit = 300) {
  const done = listMd(DIRS.archive)
    .map((f) => { try { return taskFromFile(path.join(DIRS.archive, f), 'archive'); } catch { return null; } })
    .filter(Boolean);
  const live = listTasks().filter((t) => t.status === 'done');
  return [...live, ...done]
    .sort((a, b) => (b.completed || new Date(b.mtime).toISOString()).localeCompare(a.completed || new Date(a.mtime).toISOString()))
    .slice(0, limit);
}

// A task id is its file name: usually a slug, but an iCloud conflict copy is "… 2", so any name goes except a path.
export function findTaskFile(id) {
  if (!id || /[/\\\0]/.test(id) || id.startsWith('.')) throw httpError(400, 'bad id');
  for (const [folder, dir] of [['tasks', DIRS.tasks], ['archive', DIRS.archive]]) {
    const f = path.join(dir, `${id}.md`);
    if (fs.existsSync(f)) return { file: f, folder };
  }
  throw httpError(404, `task ${id} not found`);
}

export function getTask(id) {
  const { file, folder } = findTaskFile(id);
  return taskFromFile(file, folder);
}

export function httpError(status, message) { return Object.assign(new Error(message), { status }); }

function validate(p) {
  const enums = { status: ['new', 'done', 'wait'], priority: ['urgent', 'planned', 'someday'], assigned: ['me', 'agent', 'someone'],
    agent_state: [null, 'queued', 'running', 'review', 'blocked'], agent: agentIds() };
  for (const [k, allowed] of Object.entries(enums)) {
    if (p[k] !== undefined && !allowed.includes(p[k])) throw httpError(400, `${k} must be one of ${allowed.join(', ')}`);
  }
  for (const k of ['due', 'deadline']) {
    if (p[k] && !/^\d{4}-\d{2}-\d{2}$/.test(p[k])) throw httpError(400, `${k} must be YYYY-MM-DD`);
  }
  if (p.estimate !== undefined && p.estimate !== null) {
    p.estimate = Math.round(Number(p.estimate));
    if (!(p.estimate >= 5 && p.estimate <= 600)) throw httpError(400, 'estimate must be 5–600 minutes');
  }
  if (p.project) {
    if (!fs.existsSync(path.join(DIRS.projects, `${p.project}.md`)) &&
        !fs.existsSync(path.join(DIRS.archive, 'projects', `${p.project}.md`)) && !isContainer(p.project)) throw httpError(400, `unknown project ${p.project}`);
  }
}

// A task's `project:` may also be a model container (commitment / want / decision / issue in 05_model/, or archived).
const MODEL_CONTAINERS = ['commitments', 'wants', 'decisions', 'issues'].map((d) => path.join(VAULT, '05_model', d));
export const isContainer = (slug) => [...MODEL_CONTAINERS, path.join(DIRS.archive, 'model')].some((d) => fs.existsSync(path.join(d, `${slug}.md`)));

export function createTask(input) {
  const title = String(input.title || '').trim();
  if (!title) throw httpError(400, 'title required');
  const p = {
    status: input.status || 'new', priority: input.priority || 'planned', assigned: input.assigned || 'me',
    project: input.project || null, due: input.due || null, deadline: input.deadline || null, agent: input.agent || null,
  };
  validate(p);
  const now = clockNow();
  const stamp = `${localDate(now).replace(/-/g, '')}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  let id = `${stamp}-${slugify(title)}`;
  let n = 2;
  while (fs.existsSync(path.join(DIRS.tasks, `${id}.md`))) id = `${stamp}-${slugify(title)}-${n++}`;

  // Mirrors 91_templates/task.md field order.
  const doc = new YAML.Document({});
  const fields = {
    type: 'task', aliases: [title], title, status: p.status, priority: p.priority, assigned: p.assigned,
    project: p.project ? `[[${p.project}]]` : null, due: p.due, deadline: p.deadline,
    reminder: input.reminder || null, recurrence: input.recurrence || null, labels: asList(input.labels),
    source: input.source || 'manual',
    ...(input.todoist_id ? { todoist_id: input.todoist_id, todoist_synced_at: new Date().toISOString() } : {}), // legacy imports only
  };
  if (p.assigned === 'agent') fields.agent_state = 'queued';
  if (p.assigned === 'agent' && input.agent) fields.agent = input.agent;
  const tpl = input.template ? listChecklistTemplates().find((x) => x.slug === input.template) : null;
  if (input.template && !tpl) throw httpError(400, `unknown checklist template ${input.template}`);
  if (tpl || input.checklist) fields.checklist = true;
  for (const [k, v] of Object.entries(fields)) setField(doc, k, v);

  // Subtasks: strings, or {text, tid} for Todoist-linked ones (`<!-- tid:X -->` joins them for sync).
  const subtasks = (Array.isArray(input.subtasks) ? input.subtasks : asList(input.subtasks))
    .map((x) => (typeof x === 'object' ? `${x.text}${x.tid ? ` <!-- tid:${x.tid} -->` : ''}` : String(x)));
  let notes = input.notes?.trim() || '';
  if (tpl) subtasks.push(...tpl.items);
  const lines = subtasks.map((x) => `- [ ] ${x}`);
  if (fields.checklist && notes) { const n = notesListToItems(notes); notes = n.body.trim(); lines.push(...n.items); } // a pasted list → items
  let body = `\n# ${title}\n\n`;
  if (notes) body += `${notes}\n\n`;
  body += `## Subtasks\n\n${lines.length ? lines.join('\n') : '- [ ]'}\n`;
  const file = path.join(DIRS.tasks, `${id}.md`);
  writeDoc(file, doc, body);
  return taskFromFile(file, 'tasks');
}

// ---------- checklists ----------
// AICODE-NOTE: a task with `checklist: true` is a list to tick off (shopping, packing): its ## Subtasks are the items.
// Templates live in 91_templates/checklists/<slug>.md (type: checklist-template, items as `- [ ]` lines); a new
// checklist can start from one. Format mirrored in the vault's CLAUDE.md.

const LIST_LINE = /^\s*(?:[-*+•]\s+(?:\[[ xX]\]\s*)?|\d+[.)](?!\d)\s*)(\S.*)$/;
// A typed or pasted list → item texts: "1. Milk", "19.лосось", "- [ ] Eggs", "• Bread" and plain lines.
export function listItems(text) {
  return String(text || '').split(/\r?\n/).map((l) => (l.match(LIST_LINE)?.[1] ?? l).trim()).filter((l) => l && !/^#{1,6}\s/.test(l));
}

// The notes part (before the first ## section): its numbered / bulleted / checkbox lines → item lines (`- [ ] x`,
// ticked ones stay ticked); other text stays.
function notesListToItems(body) {
  const lines = body.split('\n');
  const end = lines.findIndex((l) => /^##\s/.test(l));
  const stop = end < 0 ? lines.length : end;
  const items = [], keep = [];
  lines.forEach((l, i) => {
    const c = i < stop && l.match(CHECK_RE), m = i < stop && l.match(LIST_LINE);
    if (c && c[4].trim()) items.push(`- [${c[2] === ' ' ? ' ' : 'x'}] ${c[4].trim()}`);
    else if (m && !c) items.push(`- [ ] ${m[1].trim()}`);
    else if (!c) keep.push(l);
  });
  return { body: keep.join('\n').replace(/\n{3,}/g, '\n\n'), items };
}

export function listChecklistTemplates() {
  return safeMap(listMd(DIRS.checklists), (f) => {
    const { fm, body } = readDoc(path.join(DIRS.checklists, f));
    if (fm.type !== 'checklist-template') return null;
    const slug = path.basename(f, '.md');
    return { slug, title: str(fm.title) || h1(body) || slug, items: checkboxLines(body).map((c) => c.text).filter(Boolean) };
  }).sort((a, b) => a.title.localeCompare(b.title));
}

// From a task's items (taskId) or given ones; saving under an existing name updates that template.
export function saveChecklistTemplate({ title, items, taskId } = {}) {
  if (taskId) { const t = getTask(taskId); title = title || t.title; items = t.subtasks.map((s) => s.text); }
  title = String(title || '').trim();
  if (!title) throw httpError(400, 'title required');
  items = [...new Set((Array.isArray(items) ? items.map(String) : listItems(items)).map((x) => x.trim()).filter(Boolean))];
  if (!items.length) throw httpError(400, 'no items');
  const slug = slugify(title);
  fs.mkdirSync(DIRS.checklists, { recursive: true });
  const doc = new YAML.Document({});
  setField(doc, 'type', 'checklist-template');
  setField(doc, 'title', title);
  writeDoc(path.join(DIRS.checklists, `${slug}.md`), doc, `\n# ${title}\n\n${items.map((x) => `- [ ] ${x}`).join('\n')}\n`);
  return listChecklistTemplates().find((x) => x.slug === slug);
}

export function updateTask(id, patch) {
  const { file, folder } = findTaskFile(id);
  const { doc, fm, body: origBody } = readDoc(file);
  let body = origBody;
  const p = { ...patch };
  if (p.project !== undefined) p.project = p.project || null;
  if (p.due === '') p.due = null;
  if (p.deadline === '') p.deadline = null;
  if (p.estimate === '' || p.estimate === 0) p.estimate = null;
  if (p.agent === '') p.agent = null;
  validate(p);
  // Pushed later once it had come (due today or overdue): counted in `moved`; at 3 the app offers a WOOP.
  const was = str(fm.due);
  if (p.due && was && was <= localDate() && p.due > was) setField(doc, 'moved', (Number(fm.moved) || 0) + 1);

  for (const k of TASK_FIELDS) {
    if (p[k] === undefined) continue;
    let v = p[k];
    if (k === 'project') v = v ? `[[${v}]]` : null;
    if (k === 'labels') v = asList(v);
    if (k === 'estimate' && !v) { doc.delete('estimate'); continue; } // back to the agent's estimate
    if (k === 'title') {
      v = String(v).trim();
      if (!v) continue;
      const old = str(fm.title) || h1(body);
      const aliases = fm.aliases;
      if (!aliases || (Array.isArray(aliases) && (aliases.length === 0 || aliases[0] === old))) setField(doc, 'aliases', [v]);
      if (/^\s*#\s+.+/.test(body)) body = body.replace(/^(\s*)#\s+.+/, `$1# ${v}`);
    }
    setField(doc, k, v);
  }
  // Assigning to an agent enqueues; taking it back clears agent state.
  if (p.assigned === 'agent' && !fm.agent_state && p.agent_state === undefined) setField(doc, 'agent_state', 'queued');
  if (p.assigned && p.assigned !== 'agent' && fm.agent_state) doc.delete('agent_state');

  if (p.body !== undefined) {
    // The leading `# Title` heading is owned by `title`; the editor sees the rest.
    const head = body.match(/^\s*(#\s+.+)/);
    body = `${head ? `\n${head[1]}\n\n` : ''}${String(p.body).replace(/^\n+/, '')}`;
    if (!body.endsWith('\n')) body += '\n';
  }
  if (p.toggleCheck !== undefined) {
    const lines = body.split('\n');
    const c = checkboxLines(body)[p.toggleCheck];
    if (!c) throw httpError(400, 'no such checkbox');
    lines[c.line] = lines[c.line].replace(CHECK_RE, (_, a, x, b, rest) => `${a}${x === ' ' ? 'x' : ' '}${b}${rest}`);
    body = lines.join('\n');
  }
  if (p.checklist === true || p.checklist === false) {
    if (p.checklist) {
      setField(doc, 'checklist', true);
      const n = notesListToItems(body); // turning a task with a list in its notes into a checklist: the list becomes the items
      if (n.items.length) body = appendToSection(n.body, 'Subtasks', n.items);
    } else doc.delete('checklist');
  }
  if (p.removeCheck !== undefined) {
    const c = checkboxLines(body)[p.removeCheck];
    if (!c) throw httpError(400, 'no such checkbox');
    const lines = body.split('\n');
    lines.splice(c.line, 1);
    body = lines.join('\n');
    if (!checkboxLines(body).length) body = appendToSection(body, 'Subtasks', ['- [ ]']); // keep the template's empty item
  }
  if (p.uncheckAll) body = body.split('\n').map((l) => l.replace(CHECK_RE, (_, a, x, b, rest) => `${a} ${b}${rest}`)).join('\n');
  if (p.addLines) { const items = listItems(p.addLines); if (items.length) body = appendToSection(body, 'Subtasks', items.map((x) => `- [ ] ${x}`)); }
  if (p.addSubtask) body = appendToSection(body, 'Subtasks', [`- [ ] ${String(p.addSubtask).trim()}`]);
  if (Array.isArray(p.addSubtasks) && p.addSubtasks.length) {
    body = appendToSection(body, 'Subtasks', p.addSubtasks.map((x) => String(x).trim()).filter(Boolean).map((x) => `- [ ] ${x}`));
  }
  if (p.addNote) body = appendToSection(body, 'Notes', [`- ${localStamp()} · ${String(p.addNote).trim()}`]);
  if (p.woop && typeof p.woop === 'object') body = setWoop(body, p.woop);

  writeDoc(file, doc, body);
  return taskFromFile(file, folder);
}

export function addTimeblock(id, { start, end, label, event }) {
  const { file, folder } = findTaskFile(id);
  const { doc, fm, body } = readDoc(file);
  const day = start.slice(0, 10);
  const line = `- ⏱ ${day} ${start.slice(11, 16)}–${end.slice(11, 16)}${label ? ` · ${label.replace(/<!--|-->/g, '')}` : ''} <!-- gcal:${event} -->`;
  // A blocked task is due that day at the latest.
  if (!str(fm.due) || str(fm.due) > day) setField(doc, 'due', day);
  writeDoc(file, doc, appendToSection(body, 'Time blocks', [line]));
  return taskFromFile(file, folder);
}

// "## Mail": links to Gmail threads the task depends on (and emails sent from the app).
export function addMail(id, { threadId, subject, note = '' }) {
  const { file, folder } = findTaskFile(id);
  const { doc, body } = readDoc(file);
  const clean = (x) => String(x || '').replace(/<!--|-->|[\[\]\n]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!note && body.includes(`<!-- gmail:${threadId} -->`)) return taskFromFile(file, folder);
  const line = `- ✉ [${clean(subject) || 'Email'}](https://mail.google.com/mail/u/0/#all/${threadId})${note ? ` · ${clean(note)}` : ''} · ${localDate()} <!-- gmail:${threadId} -->`;
  writeDoc(file, doc, appendToSection(body, 'Mail', [line]));
  return taskFromFile(file, folder);
}

// A block moved (Plan the day re-planned it): the same line, the new day and times.
export function moveTimeblock(id, event, { start, end }) {
  const { file, folder } = findTaskFile(id);
  const { doc, body } = readDoc(file);
  const re = /^- ⏱ \d{4}-\d{2}-\d{2} \d{2}:\d{2}–\d{2}:\d{2}/;
  const next = body.split('\n').map((l) => (l.includes(`<!-- gcal:${event} -->`) ? l.replace(re, `- ⏱ ${start.slice(0, 10)} ${start.slice(11, 16)}–${end.slice(11, 16)}`) : l)).join('\n');
  writeDoc(file, doc, next);
  return taskFromFile(file, folder);
}

export function removeTimeblock(id, event) {
  const { file, folder } = findTaskFile(id);
  const { doc, body } = readDoc(file);
  const next = body.split('\n').filter((l) => !l.includes(`<!-- gcal:${event} -->`)).join('\n');
  writeDoc(file, doc, next.replace(/\n## Time blocks\n+(?=## |$(?![\s\S]))/m, '\n'));
  return taskFromFile(file, folder);
}

export function appendLog(id, author, text, section = 'Agent log') {
  const { file, folder } = findTaskFile(id);
  const { doc, body } = readDoc(file);
  const [first, ...rest] = String(text).trim().split('\n');
  const entry = [`- ${localStamp()} · ${author} · ${first}`, ...rest.map((l) => `  ${l}`)];
  writeDoc(file, doc, appendToSection(body, section, entry));
  return taskFromFile(file, folder);
}

// Completing: recurring → roll `due` forward; otherwise mark done and archive.
// AICODE-NOTE: until 2026-09-28 Todoist-linked tasks waited in 10_tasks/ for the sync to close them; the sync is off now,
// so every done task is archived at once (sweepArchive() catches any left behind).
// carry: a checklist done with items left (not everything was in the shop) → those items go on in a new list.
export function completeTask(id, { carry = false } = {}) {
  const { file, folder } = findTaskFile(id);
  const { doc, fm, body } = readDoc(file);
  let carried = null;
  if (carry && !fm.recurrence) {
    const left = checkboxLines(body).filter((c) => !c.done && c.text).map((c) => c.text);
    const t = taskFromFile(file, folder);
    if (left.length) carried = createTask({ title: t.title, project: t.project, priority: t.priority, checklist: true, subtasks: left, source: 'manual' });
  }
  if (fm.recurrence) {
    const base = [str(fm.due), localDate()].filter(Boolean).sort().pop();
    const next = nextCronDate(String(fm.recurrence), base);
    if (next) {
      setField(doc, 'due', next);
      setField(doc, 'status', 'new');
      if (fm.agent_state) doc.delete('agent_state'); // this occurrence's agent work is over (accepted & closed); the next one starts fresh
      if (fm.moved) doc.delete('moved'); // the next occurrence starts with no moves
      const rem = str(fm.reminder);
      if (rem && rem.length >= 16) setField(doc, 'reminder', `${next}T${rem.slice(11, 16)}`); // the reminder moves with the next occurrence
      const reset = body.split('\n').map((l) => l.replace(CHECK_RE, (_, a, x, b, rest) => `${a} ${b}${rest}`)).join('\n');
      writeDoc(file, doc, reset);
      return { task: taskFromFile(file, folder), recurred: next };
    }
  }
  setField(doc, 'status', 'done');
  setField(doc, 'completed', clockNow().toISOString());
  if (fm.agent_state) doc.delete('agent_state');
  writeDoc(file, doc, body);
  const moved = folder === 'tasks' ? moveTo(file, DIRS.archive) : file;
  return { task: taskFromFile(moved, moved === file ? folder : 'archive'), ...(carried ? { carried } : {}) };
}

// Drop = abandon: not done, no longer relevant. Stored as status done + dropped: true so every existing
// consumer (archive, dataview "not done" filters) treats it as closed; Completed shows it apart.
export function dropTask(id) {
  const { file, folder } = findTaskFile(id);
  const { doc, fm, body } = readDoc(file);
  setField(doc, 'status', 'done');
  setField(doc, 'dropped', true);
  setField(doc, 'completed', clockNow().toISOString());
  if (fm.agent_state) doc.delete('agent_state');
  writeDoc(file, doc, body);
  const moved = folder === 'tasks' ? moveTo(file, DIRS.archive) : file;
  return { task: taskFromFile(moved, moved === file ? folder : 'archive') };
}

export function reopenTask(id) {
  let { file } = findTaskFile(id);
  if (path.dirname(file) === DIRS.archive) file = moveTo(file, DIRS.tasks);
  const { doc, body } = readDoc(file);
  setField(doc, 'status', 'new');
  doc.delete('completed');
  doc.delete('dropped');
  writeDoc(file, doc, body);
  return taskFromFile(file, 'tasks');
}

function moveTo(file, dir) {
  let dest = path.join(dir, path.basename(file));
  if (fs.existsSync(dest)) dest = path.join(dir, `${path.basename(file, '.md')}-${Date.now()}.md`);
  fs.renameSync(file, dest);
  return dest;
}

export function sweepArchive() {
  const moved = [];
  for (const t of listTasks()) {
    if (t.status !== 'done') continue;
    moveTo(t.abs, DIRS.archive);
    moved.push(t.id);
  }
  return moved;
}

// ---------- projects / goals / inbox ----------

// "## Outcome" section of a project: read it, or replace its text (adding the section after the title if missing).
const OUTCOME_RE = /^##\s+Outcome\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/m;
const PLACEHOLDER = 'What does done look like?';
function outcomeOf(body) {
  const t = ((body.match(OUTCOME_RE) || [])[1] || '').trim();
  return t === PLACEHOLDER ? '' : t;
}
function withOutcome(body, text) {
  const sec = `## Outcome\n\n${String(text || '').trim() || PLACEHOLDER}\n\n`;
  if (OUTCOME_RE.test(body)) return body.replace(OUTCOME_RE, sec);
  const m = body.match(/^\s*#\s+.+\n/);
  return m ? `${m[0]}\n${sec}${body.slice(m[0].length).replace(/^\n+/, '')}` : `${sec}${body}`;
}

export function listProjects() {
  return safeMap(listMd(DIRS.projects), (f) => {
    const file = path.join(DIRS.projects, f);
    const { fm, body } = readDoc(file);
    if (fm.type !== 'project') return null;
    const slug = path.basename(f, '.md');
    return { slug, title: h1(body) || slug, status: str(fm.status) || 'active', category: str(fm.category),
      goal: linkSlug(fm.goal), due: str(fm.due), deadline: str(fm.deadline), shared: !!fm.shared, outcome: outcomeOf(body), file: path.relative(VAULT, file) };
  }).filter(Boolean).sort((a, b) => a.title.localeCompare(b.title));
}

// categories come from profile.md (default: energy, work, love, home, finance)
const categories = () => profile().categories;
// claude / codex run from the app; the profile's assistant (if any) picks up its own queue
// every agent in Settings → Your Mac → Agents, hidden ones too (a task may still point at one)
export const agentIds = () => [null, ...agentList().map((a) => a.id)];

export function listGoals() {
  return safeMap(listMd(DIRS.goals), (f) => {
    const { fm, body } = readDoc(path.join(DIRS.goals, f));
    if (fm.type !== 'goal' || (fm.status && fm.status !== 'active')) return null;
    const slug = path.basename(f, '.md');
    return { slug, title: h1(body) || slug };
  }).filter(Boolean);
}

function projectFile(slug) {
  if (!/^[\w .-]+$/.test(slug)) throw httpError(400, 'bad project slug');
  for (const dir of [DIRS.projects, path.join(DIRS.archive, 'projects')]) {
    const f = path.join(dir, `${slug}.md`);
    if (fs.existsSync(f)) return f;
  }
  throw httpError(404, `project ${slug} not found`);
}

// Mirrors 91_templates/project.md (frontmatter order + Outcome + dataview task list).
export function createProject(input) {
  const title = String(input.title || '').trim();
  if (!title) throw httpError(400, 'title required');
  if (!categories().includes(input.category)) throw httpError(400, `category must be one of ${categories().join(', ')}`);
  let slug = slugify(title).replace(/^task$/, 'project');
  let n = 2;
  while (fs.existsSync(path.join(DIRS.projects, `${slug}.md`)) || fs.existsSync(path.join(DIRS.archive, 'projects', `${slug}.md`))) slug = `${slugify(title)}-${n++}`;
  const doc = new YAML.Document({});
  const fields = {
    type: 'project', status: 'active', goal: input.goal ? `[[${input.goal}]]` : null, category: input.category,
    due: input.due || null, deadline: input.deadline || null,
    ...(input.shared ? { shared: true } : {}), ...(input.todoist_id ? { todoist_id: input.todoist_id, todoist_synced_at: new Date().toISOString() } : {}),
  };
  for (const [k, v] of Object.entries(fields)) setField(doc, k, v);
  const body = `\n# ${title}\n\n${String(input.description || '').trim() ? `${String(input.description).trim()}\n\n` : ''}## Outcome\n\n${String(input.outcome || '').trim() || 'What does done look like?'}\n\n## Tasks\n\n\`\`\`dataview\nLIST\nFROM "${OBSIDIAN?.path ? `${OBSIDIAN.path}/` : ''}10_tasks"\nWHERE project = this.file.link AND status = "new"\nSORT priority ASC\n\`\`\`\n`;
  const file = path.join(DIRS.projects, `${slug}.md`);
  writeDoc(file, doc, body);
  return listProjects().find((p) => p.slug === slug);
}

export function updateProject(slug, patch) {
  let file = projectFile(slug);
  const { doc, body: orig } = readDoc(file);
  let body = orig;
  if (patch.category !== undefined && !categories().includes(patch.category)) throw httpError(400, 'bad category');
  if (patch.status !== undefined && !['active', 'done'].includes(patch.status)) throw httpError(400, 'bad status');
  for (const k of ['category', 'due', 'deadline', 'status']) if (patch[k] !== undefined) setField(doc, k, patch[k] || null);
  if (patch.goal !== undefined) setField(doc, 'goal', patch.goal ? `[[${patch.goal}]]` : null);
  if (patch.outcome !== undefined) body = withOutcome(body, patch.outcome);
  if (patch.title?.trim()) body = /^\s*#\s+.+/.test(body) ? body.replace(/^(\s*)#\s+.+/, `$1# ${patch.title.trim()}`) : `\n# ${patch.title.trim()}\n${body}`;
  writeDoc(file, doc, body);
  // Rule 7: done projects live in 80_archive/projects/; reopening brings them back.
  if (patch.status === 'done' && path.dirname(file) === DIRS.projects) file = moveTo(file, path.join(DIRS.archive, 'projects'));
  if (patch.status === 'active' && path.dirname(file) !== DIRS.projects) file = moveTo(file, DIRS.projects);
  return { slug: path.basename(file, '.md'), status: patch.status || null };
}

export function addProjectNote(slug, text) {
  const file = projectFile(slug);
  const { doc, body } = readDoc(file);
  writeDoc(file, doc, appendToSection(body, 'Notes', [`- ${localStamp()} · ${String(text).trim().replace(/\n+/g, ' ')}`]));
  return { ok: true };
}

export function listInbox() {
  return safeMap(listMd(DIRS.inbox), (f) => {
    const file = path.join(DIRS.inbox, f);
    const { fm, body } = readDoc(file);
    if (fm.type !== 'item' || (fm.status && fm.status !== 'inbox')) return null;
    const id = path.basename(f, '.md');
    return { id, title: h1(body) || id, source: str(fm.source), sender: str(fm.sender), date: str(fm.date), url: str(fm.url), fetched: str(fm.fetched),
      suggestion: str(fm.suggestion), triage: fm.triage && typeof fm.triage === 'object' ? fm.triage : null, // lib/triage.js
      body: body.replace(/^\s*#\s+.+\n?/, '').trim(), file: path.relative(VAULT, file) };
  }).filter(Boolean).sort((a, b) => b.id.localeCompare(a.id));
}

// Capture a raw note into 01_inbox (capture now, clarify later). Title = first sentence unless given.
// A shared link (the iPhone's Share → Gubernos): url, the page's title, what was selected (text) and the owner's note; the Mac
// adds the page's text later (lib/triage.js → lib/article.js).
export function createItem({ text, title, source = 'manual', suggestion = null, url = null, note = null }) {
  const link = /^https?:\/\/\S+$/i.test(String(url || '').trim()) ? String(url).trim() : null;
  if (link && !String(title || '').trim()) title = (() => { try { return new URL(link).hostname.replace(/^www\./, ''); } catch { return link; } })();
  if (link) text = [String(note || '').trim(), link, String(text || '').trim() ? String(text).trim().split('\n').map((l) => `> ${l}`).join('\n') : ''].filter(Boolean).join('\n\n');
  const body = String(text || '').trim();
  if (!body && !String(title || '').trim()) throw httpError(400, 'text required');
  const first = (title || body.split(/(?<=[.!?…])\s|\n/)[0] || body).trim().replace(/\s+/g, ' ');
  const head = first.length > 80 ? `${first.slice(0, 79).replace(/\s+\S*$/, '')}…` : first.replace(/\.$/, '');
  const now = clockNow();
  const stamp = `${localDate(now).replace(/-/g, '')}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  let id = `${stamp}-${slugify(head)}`, n = 2;
  while (fs.existsSync(path.join(DIRS.inbox, `${id}.md`))) id = `${stamp}-${slugify(head)}-${n++}`;
  const doc = new YAML.Document({ type: 'item', source, status: 'inbox', date: localDate(now), sender: null,
    suggestion: ['task', 'reference', 'note', 'trash'].includes(suggestion) ? suggestion : null, ...(link ? { url: link } : {}) });
  fs.mkdirSync(DIRS.inbox, { recursive: true });
  writeDoc(path.join(DIRS.inbox, `${id}.md`), doc, `\n# ${head}\n\n${body && body !== head ? `${body}\n` : ''}`);
  return listInbox().find((x) => x.id === id);
}

// A shared link's page (lib/article.js), once: the site as the sender, its title if the item had only the address,
// the text under ## Article. fetched: when (or "failed: …"), so it isn't fetched again.
export function setItemArticle(id, a, error = null) {
  const file = path.join(DIRS.inbox, `${id}.md`);
  if (!fs.existsSync(file)) return;
  const { doc, fm, body } = readDoc(file);
  let b = body;
  if (a) {
    if (a.site && !fm.sender) doc.set('sender', a.site);
    if (a.title) { const host = (() => { try { return new URL(fm.url).hostname.replace(/^www\./, ''); } catch { return ''; } })(); if (h1(b) === host) b = b.replace(/^(\s*)#\s+.+$/m, `$1# ${a.title.replace(/\n/g, ' ')}`); }
    if (a.text && !/^##\s+Article\b/m.test(b)) b = `${b.replace(/\s+$/, '')}\n\n## Article\n\n${a.text}\n`;
  }
  doc.set('fetched', error ? `failed: ${String(error).slice(0, 80)}` : localStamp().replace(' ', 'T'));
  writeDoc(file, doc, b);
}

// The triage agent's proposal for a capture (lib/triage.js): its kind becomes the suggestion.
export function setItemTriage(id, t) {
  const file = path.join(DIRS.inbox, `${id}.md`);
  if (!fs.existsSync(file)) return;
  const { doc, body } = readDoc(file);
  doc.set('suggestion', t.kind);
  doc.set('triage', doc.createNode(Object.fromEntries(Object.entries(t).filter(([, v]) => v != null && v !== ''))));
  writeDoc(file, doc, body);
}

// Process an inbox capture: archive it (processed | trash), optionally recording what it became (task / project).
// An item id is its file name: captures from Web Clipper are named after the page title (spaces, quotes), so any name
// goes except a path.
export function processItem(id, { outcome, taskId, project, goal }) {
  if (!id || /[/\\\0]/.test(id) || id.startsWith('.')) throw httpError(400, 'bad id');
  const file = path.join(DIRS.inbox, `${id}.md`);
  if (!fs.existsSync(file)) throw httpError(404, 'item not found');
  const { doc, body } = readDoc(file);
  setField(doc, 'status', outcome === 'trash' ? 'trash' : 'processed');
  let b = body;
  if (taskId) b = `${body.replace(/\s+$/, '')}\n\nProcessed → task [[${taskId}]] on ${localStamp()}.\n`;
  else if (project) b = `${body.replace(/\s+$/, '')}\n\nProcessed → project [[${project}]] on ${localStamp()}.\n`;
  else if (goal) b = `${body.replace(/\s+$/, '')}\n\nProcessed → goal [[${goal}]] on ${localStamp()}.\n`;
  writeDoc(file, doc, b);
  moveTo(file, DIRS.archive);
}
