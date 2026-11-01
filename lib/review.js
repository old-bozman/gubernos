// Weekly review: what the week brought (done tasks, wins), what to clear (inbox, overdue, waiting, agent work, decisions),
// what to look at (projects without a next action, deadlines and commitments ahead), and the owner's notes, saved as a
// "## Review (Gubernos)" section in 50_reviews/<start>_to_<end>.md (the week's review file; created if there is none).
import fs from 'node:fs';
import path from 'node:path';
import { VAULT, listTasks, listLogbook, listInbox, listProjects, localDate, httpError } from './vault.js';
import { isoWeek, weekStartDate, readFocus, listDecisions, attentionItems } from './model.js';
import { reflectionsBetween } from './reflection.js';
import { weekSummary } from './habits.js';
import { now as clockNow } from './clock.js';

const DIR = path.join(VAULT, '50_reviews');
const HEAD = '## Review (Gubernos)';
const read = (file) => fs.readFileSync(file, 'utf8');
const NOTES = [['well', 'What went well'], ['didnt', "What didn't go well"], ['change', 'What to change next week']];
const plus = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return localDate(d); };

// The first two days of a week (Mon–Tue, or Sun–Mon when the week starts on Sunday) review the week that just ended;
// later days review the current one.
export function reviewWeek(now = new Date()) {
  const d = new Date(now);
  if (Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - weekStartDate(d)) / 864e5) < 2) d.setDate(d.getDate() - 7);
  return isoWeek(d);
}

// The week's review file: an existing "<start>_to_<end>.md" sharing at least 4 days with the week (other pipelines
// may cut weeks Sun–Sat), else <first day>_to_<last day>.md.
function fileFor(w) {
  let names = [];
  try { names = fs.readdirSync(DIR); } catch { /* no reviews yet */ }
  const days = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 864e5) + 1;
  const hit = names.map((n) => n.match(/^(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})\.md$/)).filter(Boolean)
    .find((m) => days(m[1] > w.start ? m[1] : w.start, m[2] < w.end ? m[2] : w.end) >= 4);
  return path.join(DIR, hit ? hit[0] : `${w.start}_to_${w.end}.md`);
}

function savedNotes(file) {
  if (!fs.existsSync(file)) return {};
  const body = read(file);
  const i = body.indexOf(HEAD);
  if (i < 0) return {};
  const part = body.slice(i).split(/\n(?=## )/)[0];
  return Object.fromEntries(NOTES.map(([k, h]) => {
    const m = part.match(new RegExp(`### ${h}\\n+([\\s\\S]*?)(?=\\n### |$)`));
    return [k, m ? m[1].trim() : ''];
  }));
}

export function weekly(now = new Date()) {
  const w = reviewWeek(now), today = localDate(now), soon = plus(today, 14);
  const day = (iso) => (iso ? localDate(new Date(iso)) : null);
  const done = listLogbook(2000).filter((t) => { const d = day(t.completed); return d && d >= w.start && d <= w.end; });
  const open = listTasks().filter((t) => t.status !== 'done');
  const mine = open.filter((t) => t.assigned !== 'agent');
  const brief = (t) => ({ id: t.id, title: t.title, project: t.project, due: t.due, deadline: t.deadline });
  const focus = (() => { try { return readFocus(); } catch { return null; } })();
  const wins = [focus?.week, focus?.previous, focus?.next].find((x) => x?.iso === w.iso)?.items || null;
  const decisions = (() => { try { return listDecisions().filter((d) => d.status === 'open'); } catch { return []; } })();
  const handled = new Set(open.filter((t) => t.project).map((t) => t.project));
  const file = fileFor(w);
  return {
    week: w, file: path.relative(VAULT, file), exists: fs.existsSync(file), notes: savedNotes(file),
    done: done.map((t) => ({ ...brief(t), dropped: t.dropped, agent: t.assigned === 'agent' })),
    wins,
    inbox: listInbox().length, unfiled: mine.filter((t) => !t.project).length,
    overdue: mine.filter((t) => t.due && t.due < today).map(brief),
    waiting: mine.filter((t) => t.status === 'wait').map(brief),
    toReview: open.filter((t) => t.assigned === 'agent' && t.agent_state === 'review').length,
    decisions: decisions.map((d) => ({ slug: d.slug, question: d.question, decide_by: d.decide_by })),
    stuck: listProjects().filter((p) => p.status === 'active' && !open.some((t) => t.project === p.slug)).map((p) => ({ slug: p.slug, title: p.title })),
    deadlines: open.filter((t) => t.deadline && t.deadline <= soon).sort((a, b) => a.deadline.localeCompare(b.deadline)).map(brief),
    comingUp: (() => { try { return attentionItems(handled, now).map((x) => ({ slug: x.slug, type: x.type, title: x.title, date: x.deadline || x.date })); } catch { return []; } })(),
    someday: open.filter((t) => t.priority === 'someday').length,
    reflections: reflectionsBetween(w.start, w.end),
    days: (() => { try { return weekSummary(w.start, w.end); } catch (e) { console.warn('[review]', e.message); return null; } })(),
  };
}

// Save the owner's notes with the week's numbers into the review file (replacing an earlier app section).
export function saveWeekly(notes = {}, now = clockNow()) {
  const r = weekly(now);
  const text = Object.fromEntries(NOTES.map(([k]) => [k, String(notes[k] || '').trim()]));
  if (!Object.values(text).some(Boolean)) throw httpError(400, 'write at least one note');
  const stamp = `${localDate(now)} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const doneN = r.done.filter((t) => !t.dropped).length, dropped = r.done.length - doneN;
  const winsLine = r.wins?.length ? `${r.wins.filter((x) => x.done).length}/${r.wins.length} — ${r.wins.map((x) => `${x.done ? '✓' : '✗'} ${x.text}`).join(' · ')}` : 'not set';
  const section = [HEAD, '', `${r.week.label} · saved ${stamp}`, '',
    `- **Done:** ${doneN} task${doneN === 1 ? '' : 's'}${dropped ? ` (+${dropped} dropped)` : ''}${r.done.some((t) => t.agent) ? ` · by agents: ${r.done.filter((t) => t.agent).length}` : ''}`,
    `- **Wins:** ${winsLine}`,
    ...(r.days ? (() => {
      const ds = r.days.days, won = ds.filter((d) => d.one).length, withOne = ds.filter((d) => d.one != null).length;
      const planned = ds.reduce((n, d) => n + d.planned, 0), doneP = ds.reduce((n, d) => n + d.done, 0);
      const mp = ds.filter((d) => d.score != null && d.score >= 9).length;
      const hs = r.days.habits, good = hs.filter((h) => h.good).length;
      return [`- **Days:** won ${won}/${withOne || 7} (#1 done) · best ${mp} · plan ${doneP}/${planned} done${hs.length ? ` · habits on track ${good}/${hs.length}` : ''}`];
    })() : []),
    `- **Still open:** inbox ${r.inbox} · overdue ${r.overdue.length} · waiting ${r.waiting.length} · decisions ${r.decisions.length} · projects without a next action ${r.stuck.length}`,
    '', ...NOTES.flatMap(([k, h]) => [`### ${h}`, '', text[k] || '—', '']),
  ].join('\n');
  const file = path.join(VAULT, r.file);
  fs.mkdirSync(DIR, { recursive: true });
  let body = fs.existsSync(file) ? read(file) : `# Weekly review ${r.week.start} – ${r.week.end}\n`;
  const i = body.indexOf(HEAD);
  if (i >= 0) {
    const rest = body.slice(i + HEAD.length), j = rest.search(/\n## /);
    body = body.slice(0, i) + section + (j >= 0 ? `\n${rest.slice(j + 1)}` : '');
  } else body = `${body.replace(/\s*$/, '')}\n\n${section}`;
  fs.writeFileSync(file, `${body.replace(/\s*$/, '')}\n`);
  return weekly(now);
}

// "## Focus Next Week" of the latest review file (written by the owner, the assistant or a review pipeline): its
// bullets, with the "### Area" they sit under — offered as suggestions when setting wins. Read-only: the file is theirs.
export function focusSuggestions() {
  let names = [];
  try { names = fs.readdirSync(DIR).filter((n) => /^\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2}\.md$/.test(n)).sort(); } catch { return null; }
  for (const name of names.reverse().slice(0, 3)) {
    const body = fs.readFileSync(path.join(DIR, name), 'utf8');
    const m = body.match(/^##\s+Focus Next Week\b.*$/m);
    if (!m) continue;
    const rest = body.slice(m.index + m[0].length);
    const end = rest.search(/^## /m);
    let area = null;
    const items = [];
    for (const line of (end < 0 ? rest : rest.slice(0, end)).split('\n')) {
      const h = line.match(/^###\s+(.+)$/);
      if (h) { area = h[1].trim(); continue; }
      const b = line.match(/^\s*[-*]\s+(?:\[[ xX]\]\s+)?(.+)$/);
      const text = b?.[1].replace(/`(\[\[[^\]]+\]\])`/g, '$1').replace(/\s+/g, ' ').trim();
      if (text && text !== '...' && !/^focus confirmed/i.test(text)) items.push({ area, text });
    }
    if (items.length) return { file: `50_reviews/${name}`, items: items.slice(0, 12) };
  }
  return null;
}

