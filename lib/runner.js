// Runs an agent headlessly on one task and streams its progress: the chosen model's CLI (lib/llm.js — Claude Code or Codex).
// The agent works directly in the vault; the task file is its brief and its report.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { VAULT, getTask, updateTask, appendLog, localStamp } from './vault.js';
import { profile } from './config.js';
import { agentList } from './settings.js';
import { agentRun, installed, ready, current, PROVIDERS, PROVIDER_IDS, logCost } from './llm.js';

const RUN_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '.runs');
fs.mkdirSync(RUN_DIR, { recursive: true });

// which model CLIs are here (Settings → Your Mac → Agents, the task's agent picker) and which one the app uses
// with the Claude API as the app's model, Claude agents run on it too: no Claude Code needed here
const onApi = (mode) => (mode === 'claude' && current() === 'api' ? 'api' : mode);
export const agentsAvailable = () => ({ ...Object.fromEntries(PROVIDER_IDS.map((id) => [id, ready(onApi(id))])), provider: current(), providerName: PROVIDERS[current()].name });
const CLI = { claude: 'Claude Code', codex: 'Codex', api: 'Claude API' };

export const runs = new Map(); // runId -> run

function prompt(task, brief, who) {
  const N = profile().name;
  return `You are an autonomous agent working one task from ${N}'s system. The current directory is the vault (markdown is canon).
Write in ${profile().language} (profile.md), unless the task says otherwise.

Task file: ${task.file}

1. Read CLAUDE.md and the "Agent Task Execution" + "Working conventions" sections of AGENTS.md.
2. Read the task file — its body is your brief. Earlier runs and ${N}'s feedback are in its "## Agent log" section; address feedback first.
   Their conversation about the task is in "## Chat"; use it for context.${brief ? `\n   THIS RUN, ${N} asked (from the task chat): ${brief}\n   Do exactly that and nothing more; put texts they asked for into the task body (e.g. under ## Notes) or a linked 40_reference/ note, not only in the log.\n   Tick only subtasks this request itself completed (finding info for a step is not doing the step).` : ''}
3. Read only the linked project (20_projects/) and reference material (40_reference/) you need.
4. Do the work. Put deliverables where CLAUDE.md says (usually 40_reference/…) and link them from the task body with [[wikilinks]].
5. Tick subtasks you completed in the task file (- [x]).
6. Append ONE concise entry to the "## Agent log" section of the task (create it at the end if missing), formatted:
   - ${localStamp()} · ${who} · <one-line summary>
     <indented details: what you did, links to outputs, open questions for ${N}>
7. Do NOT set status: done — ${N} reviews and accepts. When finished, set frontmatter \`agent_state: review\`.
   If you are blocked (need a decision, credentials, a human action), set \`agent_state: blocked\` and \`status: wait\`, and say exactly what you need in the log.
You may read ${N}'s Gmail, Google Calendar, Contacts and Drive with the gubernos-tools tools (gmail_search, gmail_thread, calendar_events, contacts_search, drive_search, drive_read) when the task needs it.
Never send emails/messages or make purchases. If an email should go out, put the full draft (to, subject, body) in your log entry — ${N} sends it from the app. Do not edit other tasks.`;
}

// brief = what the owner asked for in the task chat ("▶ Do it"); without it the task body is the brief.
// agent = the agent to run it now instead of the task's own; now = the app's model here, whatever the task's agent ("Run
// now"). How an agent starts is its run in Settings → Your Mac → Agents (lib/settings.js agentList).
export function startRun(taskId, { brief = '', agent = null, now = false } = {}) {
  for (const r of runs.values()) if (r.taskId === taskId && r.state === 'running') return r;
  brief = String(brief || '').trim().slice(0, 2000);
  if (brief) appendLog(taskId, profile().id, `▶ Do it: ${brief}`);
  const task = getTask(taskId);
  const named = agent || task.agent;
  const known = agentList().find((a) => a.id === named); // a name no longer on the list (an old task's Gemini, a removed agent) is Any
  const id0 = known ? named : null;
  const mode = onApi(now ? current() : known?.run || current()); // no agent (Any) → the app's model
  // queue: the agent takes its own queue — an assistant, a session elsewhere, a model whose CLI isn't on this Mac, and dev:
  // the developer's Claude Code session in the app's repo (AGENTS.md → Dev session). Nothing is started here.
  if (mode === 'queue' || mode === 'dev' || !installed(mode)) {
    updateTask(taskId, { assigned: 'agent', agent: id0, agent_state: 'queued', status: 'new' });
    return { id: `queued-${taskId}`, taskId, title: task.title, who: id0, state: 'queued', startedAt: Date.now() };
  }
  const who = mode;
  const id = `${Date.now().toString(36)}-${taskId.slice(0, 15)}`;
  const run = Object.assign(new EventEmitter(), {
    id, taskId, title: task.title, who, state: 'running', startedAt: Date.now(), events: [], result: null,
    agentEntries: countAgentEntries(task.body),
  });
  run.setMaxListeners(50);
  runs.set(id, run);
  updateTask(taskId, { assigned: 'agent', agent_state: 'running' }); // a run from the chat hands the task to the agent until Accept
  appendLog(taskId, 'app', `Run started (${CLI[who]})`);

  const logFile = fs.createWriteStream(path.join(RUN_DIR, `${id}.jsonl`));
  const { child, events } = agentRun({ prompt: prompt(task, brief, who), cwd: VAULT, who });
  run.child = child;
  const push = (ev) => { run.events.push(ev); run.emit('event', ev); };

  let buf = '';
  child.stdout.on('data', (chunk) => {
    logFile.write(chunk);
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try { for (const ev of events(JSON.parse(line))) { if (ev.kind === 'result') run.result = ev; push(ev); } } catch { /* partial or non-JSON */ }
    }
  });
  child.stderr.on('data', (c) => push({ kind: 'error', text: String(c).slice(0, 2000) }));
  child.on('error', (e) => push({ kind: 'error', text: `failed to start ${CLI[who]}: ${e.message}` }));
  child.on('close', (code) => {
    logFile.end();
    run.state = run.stopped ? 'stopped' : code === 0 ? 'done' : 'failed';
    run.endedAt = Date.now();
    finalize(run, code);
    push({ kind: 'end', state: run.state, code });
    run.emit('end');
  });
  return run;
}

// If the agent didn't hand the task back itself, do it for it.
function finalize(run, code) {
  try {
    const t = getTask(run.taskId);
    const secs = Math.round((run.endedAt - run.startedAt) / 1000);
    const cost = run.result?.cost != null ? `, $${run.result.cost.toFixed(2)}` : '';
    const dur = `${Math.floor(secs / 60)}m ${secs % 60}s`;
    if (t.agent_state === 'running') {
      if (run.state === 'done') updateTask(run.taskId, { agent_state: 'review' });
      else updateTask(run.taskId, { agent_state: run.stopped ? 'queued' : 'blocked', ...(run.stopped ? {} : { status: 'wait' }) });
    }
    // The agent's final message must land in canon even if it didn't write its own log entry.
    if (countAgentEntries(t.body) === run.agentEntries && run.result?.text?.trim()) {
      appendLog(run.taskId, run.who || 'claude', run.result.text.trim().slice(0, 4000));
    }
    appendLog(run.taskId, 'app', `Run ${run.state} (${dur}${cost}) — transcript .runs/${run.id}.jsonl`);
    logCost({ job: 'agent', model: run.who || 'claude', cost: run.result?.cost, ms: run.endedAt - run.startedAt });
  } catch (e) { console.error('finalize', e); }
}

const countAgentEntries = (body) => (body.match(/^- .* · (?:claude|codex|gemini) · /gm) || []).length;

export function stopRun(id) {
  const r = runs.get(id);
  if (r?.state === 'running') { r.stopped = true; r.child.kill('SIGTERM'); }
  return r;
}

export function publicRun(r) {
  return { id: r.id, taskId: r.taskId, title: r.title, who: r.who || 'claude', state: r.state, startedAt: r.startedAt, endedAt: r.endedAt ?? null };
}
