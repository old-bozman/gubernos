// The personal model (vault 05_model/, schemas in the vault's CLAUDE.md → "Personal Model"): what the app shows of it.
// The assistant owns and reasons about the model; the app reads it and writes only a few agreed things (decisions recorded or
// parked from the app, the Week section of focus.md). Nothing here ever shows the ontology's words in the UI.
import fs from 'node:fs';
import path from 'node:path';
import { VAULT, DIRS, readDoc, writeDoc, appendToSection, httpError, localDate, isContainer } from './vault.js';
import { profile, OBSIDIAN } from './config.js';
import { now as clockNow } from './clock.js';
import * as Commitments from './commitments.js';
import * as Settings from './settings.js';

export const MODEL = path.join(VAULT, '05_model');
export const MODEL_ARCHIVE = path.join(DIRS.archive, 'model');
const CONTAINER_TYPES = ['commitments', 'wants', 'decisions', 'issues']; // tasks may hang under these (CLAUDE.md rule 2)
// Folders the server watches for changes the assistant makes.
export const MODEL_DIRS = [MODEL, ...[...CONTAINER_TYPES, 'responsibilities', 'people', 'habits', 'protocols'].map((d) => path.join(MODEL, d)), MODEL_ARCHIVE];

const str = (v) => (v === null || v === undefined || v === '' ? null : String(v));
const slugOf = (v) => { const s = str(v); return s ? s.replace(/^\[\[|\]\]$/g, '').split('|')[0].trim() : null; };
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(slugOf).filter(Boolean);
const title = (body, slug) => (body.match(/^\s*#\s+(.+)$/m)?.[1] || slug).trim();
const mdFiles = (dir) => { try { return fs.readdirSync(dir).filter((f) => f.endsWith('.md') && !f.startsWith('.')); } catch { return []; } };
function read(file) { try { return readDoc(file); } catch { return null; } }

// "## Heading" section text (without the heading), or ''.
export function section(body, heading) {
  const m = body.match(new RegExp(`^##\\s+${heading}\\s*$\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'mi'));
  return m ? m[1].replace(/<!--[\s\S]*?-->/g, '').trim() : '';
}
function setSection(body, heading, text) {
  const re = new RegExp(`^(##[ \\t]+${heading}[ \\t]*\\n)([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'mi');
  if (re.test(body)) return body.replace(re, (_, h) => `${h}\n${text.trim()}\n\n`);
  return `${body.replace(/\s*$/, '')}\n\n## ${heading}\n\n${text.trim()}\n`;
}

// Areas (responsibilities): slug → { title, category }.
export function listAreas() {
  const dir = path.join(MODEL, 'responsibilities');
  return mdFiles(dir).map((f) => {
    const d = read(path.join(dir, f));
    if (!d || d.fm.type !== 'responsibility') return null;
    const slug = path.basename(f, '.md');
    return { slug, title: title(d.body, slug), category: str(d.fm.category) };
  }).filter(Boolean);
}
const areaCategory = (serves, areas) => {
  for (const s of serves) { const a = areas.find((x) => x.slug === s); if (a?.category) return a.category; }
  return null;
};

// Commitments / wants / decisions / issues a task can be filed under, live and archived, with their area's category.
export function listContainers(areas = listAreas()) {
  const out = [];
  const add = (dir, archived) => {
    for (const f of mdFiles(dir)) {
      const d = read(path.join(dir, f));
      const type = d && str(d.fm.type);
      if (!d || !['commitment', 'want', 'decision', 'issue'].includes(type)) continue;
      const slug = path.basename(f, '.md');
      const serves = [...list(d.fm.serves), ...list(d.fm.about)];
      out.push({ slug, title: title(d.body, slug), type, status: str(d.fm.status), category: areaCategory(serves, areas), archived, file: path.relative(VAULT, path.join(dir, f)) });
    }
  };
  for (const t of CONTAINER_TYPES) add(path.join(MODEL, t), false);
  add(MODEL_ARCHIVE, true);
  return out;
}
export const containerExists = isContainer;

// Goals with what the Goals screen shows: success condition (or the description), horizon, area.
export function goalDetails(areas = listAreas()) {
  return mdFiles(DIRS.goals).map((f) => {
    const d = read(path.join(DIRS.goals, f));
    if (!d || d.fm.type !== 'goal' || (d.fm.status && d.fm.status !== 'active')) return null;
    const slug = path.basename(f, '.md');
    const serves = list(d.fm.serves);
    const area = areas.find((a) => serves.includes(a.slug)) || null;
    const intro = d.body.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*#\s+.+$/m, '').split(/^## /m)[0].trim();
    const h = d.fm.horizon instanceof Date ? localDate(d.fm.horizon) : str(d.fm.horizon);
    return { slug, title: title(d.body, slug), horizon: h, serves, area: area && { slug: area.slug, title: area.title, category: area.category },
      success: section(d.body, 'Success condition'), description: intro, file: path.relative(VAULT, path.join(DIRS.goals, f)) };
  }).filter(Boolean);
}

// New goal from the vault template (91_templates/goal.md): serves, horizon, ## Success condition, ## Projects.
export function createGoal({ title: t, area = null, horizon = null, success = '', description = '' }) {
  const name = String(t || '').trim();
  if (!name) throw httpError(400, 'title required');
  const base = name.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'goal';
  let slug = base, n = 2;
  while ([DIRS.goals, path.join(DIRS.archive, 'goals'), DIRS.projects].some((d) => fs.existsSync(path.join(d, `${slug}.md`)))) slug = `${base}-${n++}`;
  const fm = ['---', 'type: goal', 'status: active', `serves: [${area ? `"[[${area}]]"` : ''}]`, `horizon: ${horizon || ''}`, '---'].join('\n');
  const desc = String(description || '').trim();
  const body = `\n# ${name}\n\n${desc ? `${desc}\n\n` : ''}## Success condition\n\n${String(success || '').trim()}\n\n## Projects\n\n\`\`\`dataview\nLIST\nFROM "${OBSIDIAN?.path ? `${OBSIDIAN.path}/` : ''}20_projects"\nWHERE goal = this.file.link AND status = "active"\n\`\`\`\n`;
  fs.mkdirSync(DIRS.goals, { recursive: true });
  fs.writeFileSync(path.join(DIRS.goals, `${slug}.md`), `${fm}\n${body}`);
  return { slug, title: name };
}

// ---------- decisions (05_model/decisions/, rules: vault AGENTS.md → "Decision queue") ----------
const DEC_DIR = path.join(MODEL, 'decisions');
const OPTION_RE = /^- \*\*([A-Z])\.\s*(.+?)\*\*\s*[:.]?\s*(.*)$/;

// Where a wikilink target lives (model files, projects, goals — live or archived).
function fileOf(slug) {
  const dirs = [MODEL, ...fs.readdirSync(MODEL, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(MODEL, d.name)),
    DIRS.projects, DIRS.goals, MODEL_ARCHIVE, path.join(DIRS.archive, 'projects'), path.join(DIRS.archive, 'goals')];
  for (const d of dirs) { const f = path.join(d, `${slug}.md`); if (fs.existsSync(f)) return f; }
  return null;
}
export const titleOf = (slug) => { const f = fileOf(slug); const d = f && read(f); return d ? title(d.body, slug) : slug; };

function decisionFrom(file) {
  const d = read(file);
  if (!d || d.fm.type !== 'decision') return null;
  const slug = path.basename(file, '.md');
  const options = section(d.body, 'Options').split('\n').map((l) => l.match(OPTION_RE)).filter(Boolean)
    .map((m) => ({ letter: m[1], label: m[2].replace(/[.:]\s*$/, '').trim(), text: m[3].trim() }));
  const recommendation = section(d.body, 'Recommendation');
  const rec = recommendation.match(/^\*\*([A-Z])\*\*/)?.[1] || null;
  const about = list(d.fm.about);
  return {
    slug, question: title(d.body, slug), status: str(d.fm.status) || 'open', decide_by: str(d.fm.decide_by), review_at: str(d.fm.review_at),
    reversible: d.fm.reversible ?? null, about: about.map((s) => ({ slug: s, title: titleOf(s) })),
    options, rec, recommendation, criteria: section(d.body, 'Criteria'), missing: section(d.body, 'Missing info'),
    fallback: section(d.body, 'Default if not decided'), file: path.relative(VAULT, file),
  };
}
export function listDecisions() {
  return mdFiles(DEC_DIR).map((f) => decisionFrom(path.join(DEC_DIR, f))).filter((x) => x && ['open', 'parked'].includes(x.status));
}

// "**B**: park until January… Q4 is already full…" → "park until January…" (the why, one sentence).
function recReason(recommendation) {
  const t = recommendation.replace(/^\*\*[A-Z]\*\*\s*[,:.—-]?\s*/, '').replace(/^provisional(ly)?\s*[,.:;]?\s*/i, '').replace(/\s+/g, ' ').trim();
  const first = (t.match(/^.+?[\p{L}\d)\]]{2}[.!?](?=\s|$)/u) || [t])[0]; // "a.s.r." / "e.g." don't end it
  return first.length > 200 ? `${first.slice(0, 199).replace(/\s+\S*$/, '')}…` : first;
}

// Record a decision (AGENTS.md "Decision queue" step 4): ## Decision, status decided, a line in ## Decisions of every
// `about` target, file → 80_archive/model/. The follow-up task is offered by the app (source: decision); a recorded
// decision that no task links to is the assistant's cue to create the follow-up itself.
export function decide(slug, { letter, reason = '' }) {
  const file = path.join(DEC_DIR, `${slug}.md`);
  if (!fs.existsSync(file)) throw httpError(404, 'decision not found (already recorded?)');
  const dec = decisionFrom(file);
  const opt = dec.options.find((o) => o.letter === letter);
  if (!opt) throw httpError(400, `no option ${letter}`);
  const date = localDate();
  const why = String(reason || '').trim().replace(/\s+/g, ' ') || (letter === dec.rec ? recReason(dec.recommendation) : 'chosen in Gubernos');
  const choice = `${letter} — ${opt.label}`;
  const { doc, body } = readDoc(file);
  doc.set('status', 'decided');
  writeDoc(file, doc, setSection(body, 'Decision', `${date}: **${choice}** · ${why} (recorded in Gubernos)`));
  for (const a of dec.about) {
    const f = fileOf(a.slug);
    if (!f || f === file) continue;
    const t = readDoc(f);
    writeDoc(f, t.doc, appendToSection(t.body, 'Decisions', [`- ${date} · ${choice} · ${why} · [[${slug}]]`]));
  }
  fs.mkdirSync(MODEL_ARCHIVE, { recursive: true });
  fs.renameSync(file, path.join(MODEL_ARCHIVE, `${slug}.md`));
  // the follow-up task goes under the first `about` a task can live in (a project or a container), not under an area or a goal
  const home = dec.about.find((a) => { const f = fileOf(a.slug); return f && (f.startsWith(DIRS.projects) || /\/(commitments|wants|decisions|issues)\//.test(f)); });
  return { slug, question: dec.question, choice, reason: why, project: home?.slug || null };
}

// "Not now until <date>": status parked + review_at (the assistant reopens it on that date).
export function park(slug, { review_at }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(review_at || ''))) throw httpError(400, 'review_at must be YYYY-MM-DD');
  const file = path.join(DEC_DIR, `${slug}.md`);
  if (!fs.existsSync(file)) throw httpError(404, 'decision not found');
  const { doc, body } = readDoc(file);
  doc.set('status', 'parked');
  doc.set('review_at', review_at);
  writeDoc(file, doc, body);
  return decisionFrom(file);
}

// ---------- focus.md: the quarter (the assistant's, read-only here) and this week's wins ----------
// Week format (vault CLAUDE.md): "## Week (2026-W40, 28 Sep – 4 Oct)" then up to 3 ordered lines "- [ ] result by Sunday · [[link]]";
// the order is the rank (#1 = WIN #1). When a new week's wins are set, the old Week section becomes "## Previous week (…)"
// so the weekly review can read "Results from previous focus". The assistant's older plain bullets ("- [[x]] · why now") still show.
const FOCUS = path.join(MODEL, 'focus.md');
const pad = (n) => String(n).padStart(2, '0');
// The week (Settings → week starts on Monday or Sunday) that holds d: {iso, label, start, end}. A Sunday-start week
// Sun–Sat is named after the ISO week of the Monday inside it, so the label keeps the "YYYY-Www, D Mon – D Mon" form.
export const weekStart = () => (Settings.get().weekStart === 'sunday' ? 'sunday' : 'monday');
export function weekStartDate(d = clockNow(), start = weekStart()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - (start === 'sunday' ? d.getDay() : (d.getDay() || 7) - 1));
}
export function isoWeek(d = clockNow(), start = weekStart()) {
  const first = weekStartDate(d, start);
  const last = new Date(first.getFullYear(), first.getMonth(), first.getDate() + 6);
  const mon = start === 'sunday' ? new Date(first.getFullYear(), first.getMonth(), first.getDate() + 1) : first;
  const t = new Date(Date.UTC(mon.getFullYear(), mon.getMonth(), mon.getDate() + 3)); // Thursday of that ISO week decides the year
  const y = t.getUTCFullYear();
  const week = Math.ceil(((t - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
  const fmt = (x) => `${x.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][x.getMonth()]}`;
  const iso = `${y}-W${pad(week)}`;
  return { iso, label: `${iso}, ${fmt(first)} – ${fmt(last)}`, start: localDate(first), end: localDate(last) };
}
const HEAD = { quarter: /^##\s+Quarter\b(.*)$/m, week: /^##\s+Week\b(.*)$/m, previous: /^##\s+Previous week\b(.*)$/m, next: /^##\s+Next week\b(.*)$/m };
function focusPart(body, key) {
  const m = body.match(HEAD[key]);
  if (!m) return null;
  const rest = body.slice(m.index + m[0].length);
  const end = rest.search(/^## /m);
  const text = (end < 0 ? rest : rest.slice(0, end)).replace(/<!--[\s\S]*?-->/g, '');
  const label = m[1].trim().replace(/^\(|\)$/g, '');
  const committed = (end < 0 ? rest : rest.slice(0, end)).match(/<!-- committed (\S+) -->/)?.[1] || null; // the owner pressed Commit (Wins screen)
  const items = text.split('\n').map((l) => l.match(/^- (?:\[([ xX])\]\s+)?(.+)$/)).filter(Boolean)
    .map((x) => ({ text: x[2].trim(), done: !!x[1] && x[1] !== ' ', legacy: !x[1] }));
  return { label, iso: label.match(/\d{4}-W\d{2}/)?.[0] || null, items, committed, start: m.index, end: end < 0 ? body.length : m.index + m[0].length + end };
}
export function readFocus() {
  if (!fs.existsSync(FOCUS)) return null;
  const d = read(FOCUS);
  if (!d) return null;
  const strip = (p) => p && { label: p.label, iso: p.iso, items: p.items, committed: p.committed };
  return { quarter: strip(focusPart(d.body, 'quarter')), week: strip(focusPart(d.body, 'week')), previous: strip(focusPart(d.body, 'previous')),
    next: strip(focusPart(d.body, 'next')), current: isoWeek(), nextWeek: isoWeek(new Date(clockNow().getTime() + 7 * 864e5)), file: path.relative(VAULT, FOCUS) };
}
// This week's wins: the Week section, or a Next week section planned last week whose week has come (not rolled yet).
export function currentWins(f = readFocus()) {
  if (!f) return null;
  return [f.week, f.next].find((x) => x?.iso === f.current.iso) || null;
}

// A planned "## Next week (…)" whose week has come becomes "## Week (…)"; the old Week becomes "## Previous week (…)".
function rollNext(body) {
  const nx = focusPart(body, 'next');
  if (!nx?.iso || nx.iso > isoWeek().iso) return body;
  const planned = body.slice(nx.start, nx.end).replace(HEAD.next, `## Week (${isoWeek().label})`); // the dates as this week runs (Settings → week starts on)
  body = body.slice(0, nx.start) + body.slice(nx.end);
  const week = focusPart(body, 'week');
  if (!week) return `${body.replace(/\s*$/, '')}\n\n${planned.trim()}\n`;
  const old = body.slice(week.start, week.end).replace(HEAD.week, '## Previous week$1');
  body = body.slice(0, week.start) + planned.replace(/\s*$/, '\n\n') + body.slice(week.end);
  const prev = focusPart(body, 'previous');
  return prev ? body.slice(0, prev.start) + old.replace(/\s*$/, '\n\n') + body.slice(prev.end) : `${body.replace(/\s*$/, '')}\n\n${old.trim()}\n`;
}

// Replace this week's wins (up to 3, in order) — or, with next: true, plan next week's in "## Next week (…)".
// Only the Week / Previous week / Next week sections are touched; the file is re-read right before writing, so the
// assistant's edits elsewhere (the quarter, notes) survive.
// commit: the owner pressed "Commit to these wins" → a <!-- committed <time> --> line in the section (kept on later checks).
export function setWeek(items, { next = false, commit = false } = {}) {
  if (!fs.existsSync(FOCUS)) throw httpError(404, 'no 05_model/focus.md');
  const clean = (Array.isArray(items) ? items : []).map((x) => ({ text: String(x?.text || '').replace(/\s+/g, ' ').trim(), done: !!x?.done })).filter((x) => x.text).slice(0, 3);
  const { doc, body: orig } = readDoc(FOCUS);
  let body = rollNext(orig);
  const stamp = (old) => (commit ? `<!-- committed ${clockNow().toISOString().slice(0, 16)} -->\n` : old?.committed ? `<!-- committed ${old.committed} -->\n` : '');
  const lines = clean.map((x) => `- [${x.done ? 'x' : ' '}] ${x.text}`).join('\n');
  if (next) {
    const target = isoWeek(new Date(clockNow().getTime() + 7 * 864e5));
    const nx = focusPart(body, 'next');
    const block = `## Next week (${target.label})\n\n${stamp(nx)}${clean.map((x) => `- [ ] ${x.text}`).join('\n')}\n\n`;
    const anchor = focusPart(body, 'week') || focusPart(body, 'quarter');
    if (nx) body = body.slice(0, nx.start) + block + body.slice(nx.end);
    else body = anchor ? body.slice(0, anchor.end).replace(/\s*$/, '\n\n') + block + body.slice(anchor.end) : `${body.replace(/\s*$/, '')}\n\n${block}`;
    writeDoc(FOCUS, doc, body.replace(/\n{3,}/g, '\n\n'));
    Commitments.record(target.iso, clean, { commit });
    return { ...readFocus(), commitStats: Commitments.stats(target.iso) };
  }
  const cur = isoWeek();
  const week = focusPart(body, 'week');
  const block = `## Week (${cur.label})\n\n${stamp(week?.iso === cur.iso ? week : null)}${lines}\n\n`;
  if (week && week.iso && week.iso !== cur.iso) {
    // a new week: keep the last one as "Previous week" (replacing the older one)
    const old = body.slice(week.start, week.end).replace(HEAD.week, `## Previous week$1`);
    body = body.slice(0, week.start) + block + body.slice(week.end);
    const prev = focusPart(body, 'previous');
    body = prev ? body.slice(0, prev.start) + old.replace(/\s*$/, '\n\n') + body.slice(prev.end) : `${body.replace(/\s*$/, '')}\n\n${old.trim()}\n`;
  } else if (week) {
    body = body.slice(0, week.start) + block + body.slice(week.end);
  } else {
    const q = focusPart(body, 'quarter');
    body = q ? body.slice(0, q.end).replace(/\s*$/, '\n\n') + block + body.slice(q.end) : `${body.replace(/\s*$/, '')}\n\n${block}`;
  }
  writeDoc(FOCUS, doc, body.replace(/\n{3,}/g, '\n\n'));
  Commitments.record(cur.iso, clean, { commit }); // keeps the ritual's history (and checkmarks) for the streak
  return { ...readFocus(), commitStats: Commitments.stats(cur.iso) };
}

// Edit a goal: title (the H1), area (`serves`), horizon, "## Success condition". status done → 80_archive/goals/ (CLAUDE.md rule 7).
export function updateGoal(slug, patch = {}) {
  if (!/^[\w.-]+$/.test(slug)) throw httpError(400, 'bad goal slug');
  const file = path.join(DIRS.goals, `${slug}.md`);
  if (!fs.existsSync(file)) throw httpError(404, 'goal not found');
  const { doc, body: orig } = readDoc(file);
  let body = orig;
  if (patch.title?.trim()) body = /^\s*#\s+.+/m.test(body) ? body.replace(/^(\s*)#\s+.+$/m, `$1# ${patch.title.trim()}`) : `\n# ${patch.title.trim()}\n${body}`;
  if (patch.area !== undefined) doc.set('serves', doc.createNode(patch.area ? [`[[${patch.area}]]`] : [], { flow: true }));
  if (patch.horizon !== undefined) doc.set('horizon', patch.horizon ? String(patch.horizon).trim() : null);
  if (patch.success !== undefined) {
    const text = String(patch.success || '').trim();
    // missing section goes where the template has it: before "## Projects"
    body = !/^##\s+Success condition\s*$/mi.test(body) && /^## Projects\s*$/m.test(body)
      ? body.replace(/^## Projects[ \t]*$/m, `## Success condition\n\n${text}\n\n## Projects`) : setSection(body, 'Success condition', text);
  }
  if (patch.status === 'done' || patch.status === 'active') doc.set('status', patch.status);
  writeDoc(file, doc, body);
  if (patch.status === 'done') {
    const dir = path.join(DIRS.archive, 'goals');
    fs.mkdirSync(dir, { recursive: true });
    fs.renameSync(file, path.join(dir, `${slug}.md`));
  }
  return { slug, status: patch.status || 'active' };
}

// Close a decision without choosing: "not a decision" (dismissed) or it became a task / project / goal.
// status: dropped, a dated line in ## Decision, file → 80_archive/model/. Nothing is added to the `about` targets.
export function dropDecision(slug, { reason = '', became = null } = {}) {
  const file = path.join(DEC_DIR, `${slug}.md`);
  if (!fs.existsSync(file)) throw httpError(404, 'decision not found (already closed?)');
  const date = localDate();
  const what = became?.slug ? `not a decision — became ${became.kind || 'task'} [[${became.slug}]]` : 'not a decision';
  const why = String(reason || '').trim().replace(/\s+/g, ' ');
  const { doc, body } = readDoc(file);
  doc.set('status', 'dropped');
  writeDoc(file, doc, setSection(body, 'Decision', `${date}: ${what}${why ? ` · ${why}` : ''} (closed in Gubernos)`));
  fs.mkdirSync(MODEL_ARCHIVE, { recursive: true });
  fs.renameSync(file, path.join(MODEL_ARCHIVE, `${slug}.md`));
  return { slug, status: 'dropped' };
}

// ---------- coming up: the attention pass the assistant does for the morning brief (vault AGENTS.md → "Attention pass"), for the app ----------
// commitments: attention_at ≤ today, or no attention_at and deadline within 30 days; wants: review_at ≤ today; issues: attention_at ≤ today.
// A commitment with an open task under it counts as handled (the task is the outcome) — the app passes those slugs.
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return localDate(d); };
const addMonths = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setMonth(d.getMonth() + n); return localDate(d); };
// "monthly, €4123" → 1 · "quarterly" → 3 · "yearly, by 1 Dec" → 12 · weekly → 0.25; null when it doesn't say
export function periodMonths(recurrence) {
  const r = String(recurrence || '').toLowerCase();
  if (!r) return null;
  if (/week/.test(r)) return 0.25;
  if (/quarter/.test(r)) return 3;
  if (/month/.test(r)) return 1;
  if (/year|annual/.test(r)) return 12;
  return null;
}
export function attentionItems(handled = new Set(), now = new Date()) {
  const today = localDate(now), soon = addDays(today, 30), out = [];
  const scan = (dir, type) => mdFiles(path.join(MODEL, dir)).forEach((f) => {
    const d = read(path.join(MODEL, dir, f));
    if (!d || d.fm.type !== type) return;
    const slug = path.basename(f, '.md'), fm = d.fm, st = str(fm.status);
    const att = str(fm.attention_at), dl = str(fm.deadline), rev = str(fm.review_at);
    let date = null;
    if (type === 'commitment' && st === 'active') date = att ? (att <= today ? att : null) : dl && dl <= soon ? dl : null;
    if (type === 'want' && ['latent', 'active'].includes(st) && rev && rev <= today) date = rev;
    if (type === 'issue' && st === 'open' && att && att <= today) date = att;
    if (!date || handled.has(slug)) return;
    out.push({ slug, type, title: title(d.body, slug), to: str(fm.to), deadline: dl, recurrence: str(fm.recurrence), attention_at: att, review_at: rev,
      date, overdue: !!dl && dl < today, period: type === 'commitment' ? periodMonths(fm.recurrence) : null, file: path.relative(VAULT, path.join(MODEL, dir, f)) });
  });
  scan('commitments', 'commitment'); scan('wants', 'want'); scan('issues', 'issue');
  return out.sort((a, b) => (a.deadline || a.date).localeCompare(b.deadline || b.date));
}
function modelFile(slug) {
  for (const dir of ['commitments', 'wants', 'issues']) { const f = path.join(MODEL, dir, `${slug}.md`); if (fs.existsSync(f)) return f; }
  throw httpError(404, 'not found in 05_model');
}
// "Not yet": look again in N days (attention_at, or review_at for a want).
export function snooze(slug, days = 7) {
  const file = modelFile(slug), { doc, body, fm } = readDoc(file), next = addDays(localDate(), Number(days) || 7);
  doc.set(fm.type === 'want' ? 'review_at' : 'attention_at', next);
  writeDoc(file, doc, appendToSection(body, 'Log', [`- ${localDate()} · ${profile().id} · not yet, look again ${next} (Gubernos)`]));
  return { slug, next };
}
// "Done this cycle": a recurring commitment moves its dates one period on; a one-off one is done and archived.
export function cycleDone(slug) {
  const file = modelFile(slug), { doc, body, fm } = readDoc(file), today = localDate();
  if (fm.type !== 'commitment') throw httpError(400, 'only commitments have cycles');
  const months = periodMonths(fm.recurrence);
  if (!months) {
    doc.set('status', 'done');
    writeDoc(file, doc, appendToSection(body, 'Log', [`- ${today} · ${profile().id} · done (Gubernos)`]));
    fs.mkdirSync(MODEL_ARCHIVE, { recursive: true });
    fs.renameSync(file, path.join(MODEL_ARCHIVE, path.basename(file)));
    return { slug, status: 'done' };
  }
  const step = (d) => (months < 1 ? addDays(d, 7) : addMonths(d, months));
  const dl = str(fm.deadline), att = str(fm.attention_at);
  // next deadline = one period after the current one (or after today if there was none / it's long past)
  const nextDl = dl ? step(dl > today ? dl : today) : null;
  const nextAtt = att ? (nextDl && dl ? addDays(nextDl, Math.round((new Date(`${att}T12:00:00`) - new Date(`${dl}T12:00:00`)) / 864e5)) : step(att > today ? att : today)) : null;
  if (nextDl) doc.set('deadline', nextDl);
  if (nextAtt) doc.set('attention_at', nextAtt);
  writeDoc(file, doc, appendToSection(body, 'Log', [`- ${today} · ${profile().id} · done this cycle; next ${nextDl || nextAtt || '—'} (Gubernos)`]));
  return { slug, deadline: nextDl, attention_at: nextAtt };
}
