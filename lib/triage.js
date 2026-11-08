// Inbox triage: an agent looks at every new capture in 01_inbox (a watch voice note, Telegram, Web Clipper, a typed
// note) and says what it is and what to do with it — the item's `suggestion` and a `triage:` proposal in its
// frontmatter: {kind, what, do, title, project, due, reminder, priority, assigned, agent, at}. Nothing else is
// written: the owner applies it in the Inbox (✦ Make it a task, or the Task button, which starts from the proposal).
// Runs on the Mac only (Haiku through the claude CLI, lib/llm.js), one item at a time: on an inbox change and every minute.
import { ask } from './llm.js';
import { listInbox, listProjects, listGoals, setItemTriage, setItemArticle, localDate, localStamp } from './vault.js';
import { fetchArticle } from './article.js';
import { listContainers, listAreas } from './model.js';
import { profile } from './config.js';
import { agentList } from './settings.js';

const KINDS = ['task', 'reference', 'note', 'trash'];
const failed = new Map(); // id → tries (this run of the server)
let busy = false;

const system = () => {
  const p = profile();
  return `You triage ${p.name}'s inbox: one raw capture at a time — a voice note from the Apple Watch (speech-to-text, so words may be misheard: read it for the meaning), a forwarded Telegram post, a clipped web page or a typed note. Decide what it is and the one thing to do with it.
kind:
- task: something to do (by ${p.name}, or an agent). "Remind me…", "напомни…", "надо…", "call…", a bug or wish for Gubernos (assigned agent, agent "dev").
- reference: material to keep and read or use later (articles, posts, links, facts) — not an action.
- note: an idea or a thought for the future, not actionable yet.
- trash: empty, noise, a test, or a misheard fragment with no meaning.
Fields:
- what: what it is, one short line (max 12 words), in English.
- do: the next step with it, one short line in English (e.g. "Task for today: …", "Keep as reference for <project>", "Idea for <project> — revisit at the weekly review").
- title: for a task, the task title: verb first, concrete, under 10 words, in ${p.language}; otherwise a clean title for the capture.
- project: the slug of the nearest container from the list (project, goal, commitment, want, decision, issue) or null. Only a slug from the list.
- due: YYYY-MM-DD when the capture says or clearly implies a day ("today", "tomorrow", "сегодня", "в пятницу"), else null. Today is given.
- reminder: YYYY-MM-DDTHH:MM only when it asks to be reminded at a time, else null.
- priority: urgent (must happen today/soon), planned, or someday.
- assigned: me, or agent when an agent can do it all by itself (research, drafting, a change to the app itself).
- agent: for assigned agent: an agent id from the list (dev = the app's own bugs and features), else null.
A shared link (from the iPhone's Share sheet) comes with the page's text and maybe ${p.name}'s own note on top: the note says what he wants with it (read, try, buy, send…); with no note it is usually reference.
Never invent facts, people or dates that aren't in the capture.`;
};

function context() {
  const today = localDate();
  const dow = new Date(`${today}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long' });
  const areas = listAreas();
  const projects = listProjects().filter((p) => p.status === 'active').map((p) => `${p.slug} — ${p.title}${p.category ? ` (${p.category})` : ''}`);
  const goals = listGoals().filter((g) => g.status !== 'done').map((g) => `${g.slug} — ${g.title} (goal)`);
  const model = listContainers(areas).filter((c) => !c.archived && !['done', 'dropped', 'decided', 'realized', 'abandoned', 'resolved'].includes(c.status)).map((c) => `${c.slug} — ${c.title} (${c.type})`);
  const agents = agentList().filter((a) => a.on).map((a) => `${a.id} — ${a.name}`);
  return `Today: ${today} (${dow}).
Containers (slug — title):
${[...projects, ...goals, ...model].join('\n')}
Agents: ${agents.join('; ')}`;
}

export const SCHEMA = {
  type: 'object', required: ['kind', 'what', 'do', 'title'],
  properties: {
    kind: { type: 'string', enum: KINDS }, what: { type: 'string' }, do: { type: 'string' }, title: { type: 'string' },
    project: { type: ['string', 'null'] }, due: { type: ['string', 'null'] }, reminder: { type: ['string', 'null'] },
    priority: { type: 'string', enum: ['urgent', 'planned', 'someday'] }, assigned: { type: 'string', enum: ['me', 'agent'] }, agent: { type: ['string', 'null'] },
  },
};

export async function triage(item) {
  const prompt = `${context()}

Capture (source: ${item.source || 'manual'}${item.sender ? `, from ${item.sender}` : ''}, ${item.date || ''}):
# ${item.title}
${item.body.replace(/<!--[\s\S]*?-->/g, '').slice(0, 4000)}`;
  const { output: o } = await ask({ system: system(), prompt, schema: SCHEMA });
  const slugs = new Set([...listProjects().map((p) => p.slug), ...listGoals().map((g) => g.slug), ...listContainers().map((c) => c.slug)]);
  const agents = new Set(agentList().map((a) => a.id));
  const day = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : null);
  const kind = KINDS.includes(o.kind) ? o.kind : 'note';
  const t = {
    kind, what: String(o.what || '').trim().slice(0, 120), do: String(o.do || '').trim().slice(0, 160), title: String(o.title || item.title).trim().slice(0, 120),
    project: slugs.has(o.project) ? o.project : null,
    due: kind === 'task' ? day(o.due) : null,
    reminder: kind === 'task' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(o.reminder || '') ? o.reminder : null,
    priority: kind === 'task' && ['urgent', 'planned', 'someday'].includes(o.priority) ? o.priority : null,
    assigned: kind === 'task' ? (o.assigned === 'agent' ? 'agent' : 'me') : null,
    agent: kind === 'task' && o.assigned === 'agent' && agents.has(o.agent) ? o.agent : null,
    at: localStamp().replace(' ', 'T'),
  };
  setItemTriage(item.id, t);
  return t;
}

// a shared link: its page first (the text the triage reads, kept in the item)
async function withArticle(it) {
  if (!it.url || it.fetched) return it;
  try { setItemArticle(it.id, await fetchArticle(it.url)); } catch (e) { setItemArticle(it.id, null, e.message); console.error(`[triage] ${it.id}: page ${e.message}`); }
  return listInbox().find((x) => x.id === it.id) || it;
}

// every inbox item without a triage yet, oldest first; one pass at a time
export async function sweep() {
  if (busy) return 0;
  busy = true;
  let n = 0;
  try {
    const todo = listInbox().filter((x) => !x.triage && (failed.get(x.id) || 0) < 2).reverse();
    for (const it of todo) {
      try { const t = await triage(await withArticle(it)); n++; console.log(`[triage] ${it.id} → ${t.kind}: ${t.what}`); } catch (e) {
        failed.set(it.id, (failed.get(it.id) || 0) + 1);
        console.error(`[triage] ${it.id}: ${e.message}`);
      }
    }
  } finally { busy = false; }
  return n;
}
