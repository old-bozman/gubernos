// The developer's side of the relay (relay/worker.js): reports from other people's installs arrive as issues in the
// private feedback repo; on the developer's own install (DEV_AGENT, config.json "feedbackInbox": "owner/repo") this
// brings each open issue into the vault as a task queued for the dev session, like the owner's own bug reports.
//   new issue            → a task in "Gubernos feedback" (assigned: agent, agent: dev, agent_state: queued, label from-user)
//   the reporter answers → a log line, and the task is queued again (unless it's done)
//   the task is done     → the issue is closed with the dev session's last log line, which reaches the reporter's task
//   (Accept & close)       (dropped: closed as not planned)
//   "Still wrong"        → the reporter's comment reopened the issue: the task is reopened and queued again
// The dev session asks the reporter with `gh issue comment` (AGENTS.md → Dev session). Uses the developer's `gh`.
// State in data/feedback-inbox.json: {issue: {taskId, comments, closed}}.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createTask, listProjects, createProject, getTask, appendLog, updateTask, reopenTask } from './vault.js';
import { profile, DEV_AGENT, FEEDBACK_INBOX } from './config.js';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = process.env.GUBERNOS_DATA_DIR || path.join(ROOT, 'data');
const STATE = path.join(DATA, 'feedback-inbox.json');
const REPORTER = '<!-- reporter -->';
const GH = process.env.GUBERNOS_GH_BIN || ['/opt/homebrew/bin/gh', '/usr/local/bin/gh'].find((f) => fs.existsSync(f)) || 'gh';
const gh = (args, input = null) => new Promise((ok, no) => {
  const p = execFile(GH, args, { timeout: 60000, maxBuffer: 2e7 }, (e, out, err) => (e ? no(new Error(String(err || e.message).trim().slice(0, 300))) : ok(String(out).trim())));
  if (input != null) p.stdin.end(input);
});
const api = async (p) => JSON.parse(await gh(['api', p]));

function project() {
  const p = listProjects().find((x) => x.slug === 'gubernos-feedback' || x.title === 'Gubernos feedback');
  if (p) return p.slug;
  const cats = profile().categories;
  return createProject({ title: 'Gubernos feedback', category: cats.includes('work') ? 'work' : cats[0],
    outcome: 'No end: bugs and ideas about Gubernos, from the app itself and from other people\'s installs.' }).slug;
}

const read = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; } };
const lastWord = (t) => {
  const lines = (t.body.split(/^## Agent log\s*$/m)[1] || '').split('\n').filter((l) => /^- \d{4}-\d{2}-\d{2} \d{2}:\d{2} · (dev|agent|claude) · /.test(l));
  return lines.length ? lines.at(-1).replace(/^- [^·]+· [^·]+· /, '').trim() : '';
};

async function syncOnce() {
  const repo = FEEDBACK_INBOX, seen = read();
  const open = await api(`repos/${repo}/issues?state=open&per_page=100`);
  for (const i of open.filter((x) => !x.pull_request && !seen[x.number])) {
    const kind = (i.labels || []).some((l) => l.name === 'idea') ? 'idea' : 'bug';
    const t = createTask({ title: i.title, project: project(), status: 'new', assigned: 'agent', agent: 'dev', labels: ['feedback', kind, 'from-user'], source: 'manual',
      notes: `${i.body || ''}\n\nFrom another install, through the relay: ${i.html_url} <!-- inbox:${i.number} -->` });
    updateTask(t.id, { agent_state: 'queued' });
    seen[i.number] = { taskId: t.id, comments: 0, closed: false };
  }
  for (const i of open.filter((x) => seen[x.number]?.closed)) { // reopened by the reporter ("Still wrong")
    const s = seen[i.number];
    try { reopenTask(s.taskId); s.closed = false; } catch { /* the task is gone */ }
  }
  for (const [n, s] of Object.entries(seen)) {
    if (s.closed) continue;
    let t; try { t = getTask(s.taskId); } catch { s.closed = true; continue; } // the task is gone: stop following it
    if (t.status === 'done') {
      const word = t.dropped ? 'Not planned for now.' : lastWord(t) || 'Fixed.';
      await gh(['issue', 'close', n, '-R', repo, '-c', word, ...(t.dropped ? ['-r', 'not planned'] : [])]);
      s.closed = true; continue;
    }
    const comments = await api(`repos/${repo}/issues/${n}/comments?per_page=100`);
    const theirs = comments.filter((c) => c.body.startsWith(REPORTER));
    for (const c of theirs.slice(s.comments)) appendLog(t.id, 'reporter', c.body.slice(REPORTER.length).replace(/^\s*\*\*Reporter:\*\*\s*/, '').trim().slice(0, 2000));
    if (theirs.length > s.comments) updateTask(t.id, { assigned: 'agent', agent: 'dev', agent_state: 'queued', status: 'new' });
    s.comments = theirs.length;
  }
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(seen, null, 1));
}

let busy = false;
export async function syncInbox() {
  if (!DEV_AGENT || !FEEDBACK_INBOX || busy) return;
  busy = true;
  try { await syncOnce(); } finally { busy = false; }
}
export function startInbox() {
  if (!DEV_AGENT || !FEEDBACK_INBOX) return null;
  const run = () => syncInbox().catch((e) => console.error('[feedback-inbox]', e.message));
  setTimeout(run, 20e3);
  return setInterval(run, 5 * 60e3);
}
