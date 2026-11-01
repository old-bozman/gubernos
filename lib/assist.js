// Small agent helpers for the UI: break a task into steps, explain/second-guess the focus pick.
import fs from 'node:fs';
import path from 'node:path';
import { ask } from './llm.js';
import { getTask, listTasks, listProjects, DIRS, readDoc, localDate, httpError } from './vault.js';
import { profile } from './config.js';

function projectContext(slug) {
  if (!slug) return '';
  const f = path.join(DIRS.projects, `${slug}.md`);
  if (!fs.existsSync(f)) return '';
  const { body } = readDoc(f);
  return body.replace(/<!--[\s\S]*?-->/g, '').trim().slice(0, 1500);
}

const BREAKDOWN_SYSTEM = `You split one task into its next concrete steps.
- 3 to 7 steps, in order; each a physical, visible next action doable in one sitting (15–60 min), verb first.
- Same language as the task title. Short (under 12 words each).
- Use only what the task and project context say or clearly imply; do not invent people, numbers or facts.
- Do not repeat steps that already exist.`;

export async function breakdown(taskId) {
  const t = getTask(taskId);
  const existing = t.subtasks.map((s) => `- [${s.done ? 'x' : ' '}] ${s.text}`).join('\n');
  const prompt = `Task: ${t.title}
Notes:
${t.body.replace(/<!--[\s\S]*?-->/g, '').slice(0, 3000) || '(none)'}
${existing ? `Existing steps:\n${existing}\n` : ''}${t.project ? `Project context (${t.project}):\n${projectContext(t.project)}\n` : ''}`;
  const { output, cost } = await ask({
    system: BREAKDOWN_SYSTEM, prompt,
    schema: { type: 'object', required: ['steps'], properties: { steps: { type: 'array', items: { type: 'string' } } } },
  });
  const have = new Set(t.subtasks.map((s) => s.text.toLowerCase()));
  return { steps: output.steps.map((s) => s.trim()).filter((s) => s && !have.has(s.toLowerCase())).slice(0, 7), cost };
}

const whySystem = (N = profile().name) => `You help ${N} pick the ONE task to focus on right now.
You get the app's rule-based pick and the other candidates with their dates (days are already computed for you — do not recompute).
Reply in at most 2 short sentences (max 40 words total), addressed to ${N} ("you"), in English: why the pick matters now (deadline, consequences, what it unblocks).
Refer to tasks by a short name (e.g. "the Douglas invoice"), NEVER by number.
If another candidate is clearly more important right now, set better = its number and name it in the reason; otherwise better = null.
Never invent facts not present in the input.`;

function rel(d, today) {
  if (!d) return null;
  const n = Math.round((new Date(`${d}T12:00:00`) - new Date(`${today}T12:00:00`)) / 864e5);
  return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n < 0 ? `${-n} days ago` : `in ${n} days`;
}

export async function why(taskId, candidateIds = []) {
  const today = localDate();
  const all = listTasks();
  const projects = Object.fromEntries(listProjects().map((p) => [p.slug, p]));
  const ids = [taskId, ...candidateIds.filter((id) => id !== taskId)].slice(0, 12);
  const cands = ids.map((id) => all.find((t) => t.id === id)).filter(Boolean);
  if (!cands.length) throw httpError(404, 'task not found');
  const line = (t, i) => {
    const bits = [`${i + 1}. ${t.title}`, `priority ${t.priority}`];
    if (t.due) bits.push(`due ${rel(t.due, today)}`);
    if (t.deadline) bits.push(`HARD DEADLINE ${rel(t.deadline, today)}`);
    if (t.project) bits.push(`project: ${projects[t.project]?.title || t.project}${projects[t.project]?.goal ? ` (goal: ${projects[t.project].goal})` : ''}`);
    if (t.checks.total) bits.push(`steps ${t.checks.done}/${t.checks.total}`);
    const note = t.body.replace(/<!--[\s\S]*?-->/g, '').split('\n').find((l) => l.trim() && !/^#|^\s*[-*] \[/.test(l));
    if (note) bits.push(`note: ${note.trim().slice(0, 160)}`);
    return bits.join(' · ');
  };
  const prompt = `App pick = #1.\nCandidates:\n${cands.map(line).join('\n')}`;
  const { output, cost } = await ask({
    system: whySystem(), prompt,
    schema: { type: 'object', required: ['reason', 'better'], properties: { reason: { type: 'string' }, better: { type: ['integer', 'null'] } } },
  });
  const better = Number.isInteger(output.better) && output.better > 1 ? cands[output.better - 1] : null;
  return { reason: output.reason, suggestId: better?.id || null, suggestTitle: better?.title || null, cost };
}


// Search by meaning (any language): "страховка" finds "choose insurance…". Returns ids of open tasks / project slugs.
export async function semanticSearch(q) {
  const tasks = listTasks().filter((t) => t.status !== 'done');
  const projects = listProjects().filter((p) => p.status === 'active');
  const prompt = `Query: "${String(q).slice(0, 200)}"

Projects:
${projects.map((p, i) => `P${i + 1}. ${p.title}`).join('\n')}

Open tasks:
${tasks.map((t, i) => `T${i + 1}. ${t.title}${t.project ? ` [${t.project}]` : ''} — ${t.body.replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').slice(0, 120)}`).join('\n')}`;
  const { output } = await ask({
    system: 'Find the projects and open tasks that match the query by meaning, across languages (RU/EN/NL) and synonyms. Return only real matches, best first, at most 10 tasks and 3 projects; empty lists if nothing fits.',
    prompt,
    schema: { type: 'object', required: ['projects', 'tasks'], properties: { projects: { type: 'array', items: { type: 'integer' } }, tasks: { type: 'array', items: { type: 'integer' } } } },
  });
  return {
    projects: output.projects.map((n) => projects[n - 1]?.slug).filter(Boolean),
    tasks: output.tasks.map((n) => tasks[n - 1]?.id).filter(Boolean),
  };
}
