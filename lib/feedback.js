// Bug reports and ideas about the app itself, sent from any screen (menu → Report, ⌘K, voice "баг: …").
// Each report becomes a task in the vault under the list project "Gubernos feedback" (status wait: waiting on the
// developer) and one line in data/feedback.jsonl, which a developer session watches. The screen snapshot (the page's
// HTML, rendered again with app.css) and screenshots stay in data/feedback/ — app data, not canon.
// When a report is handled, the developer logs it in the task and hands it over for review (assigned: agent,
// agent_state: review), so the owner gets the usual "Agent finished" push and accepts or sends back.
//
// Someone else's install (config feedbackRelay, set by setup.sh) also sends it to the developer through the relay
// (relay/worker.js, relay.gubernos.app): no GitHub account needed. The relay opens an issue in the developer's private
// repo with the text, screen name, device and errors (task ids masked). Screenshots, the screen snapshot and the open
// task's title go with the form's "Send screenshots" tick (on by default, the reporter can untick it), as one HTML file
// stored next to the issue. Not public: the developer's private repo (GitHub), carried by Cloudflare, and the developer's
// dev session (Claude Code) reads it to work on it. A voice report opens the form first.
// The developer answers in the issue; syncRemote() asks the relay and brings comments back into the task's log, and a
// closed issue hands the task over for review (push) — a comment on an open issue marks it "blocked" (a question, push too).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { createTask, createProject, listProjects, listTasks, appendLog, updateTask, httpError, localDate } from './vault.js';
import { profile, PORT, FEEDBACK_RELAY, DEV_AGENT } from './config.js';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = process.env.GUBERNOS_DATA_DIR || path.join(ROOT, 'data');
const DIR = path.join(DATA, 'feedback');
export const FEED = path.join(DATA, 'feedback.jsonl');
const SYNC = path.join(DATA, 'feedback-sync.json');
const PROJECT = 'gubernos-feedback';
const RELAY_RE = /<!-- relay:(\d+):([\w-]+) -->/;
const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s);
// the app's version: an install without git keeps it in .gubernos-version ("owner/repo sha", install.sh); a checkout asks git
const version = (() => {
  try { return fs.readFileSync(path.join(ROOT, '.gubernos-version'), 'utf8').split(/\s+/)[1].slice(0, 7); } catch { /* a git checkout */ }
  try { return execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return '?'; }
})();
// this install's random id: the relay's issues say which install sent them (no name, no account)
const installId = () => {
  const f = path.join(DATA, 'install-id');
  try { return fs.readFileSync(f, 'utf8').trim(); } catch { /* first report */ }
  const id = crypto.randomBytes(9).toString('base64url');
  fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(f, `${id}\n`);
  return id;
};
async function relay(method, p, body) {
  const r = await fetch(`${FEEDBACK_RELAY.replace(/\/$/, '')}${p}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `relay ${r.status}`);
  return j;
}

function project() {
  const p = listProjects().find((x) => x.slug === PROJECT || x.title === 'Gubernos feedback');
  if (p) return p.slug;
  const cats = profile().categories;
  return createProject({ title: 'Gubernos feedback', category: cats.includes('work') ? 'work' : cats[0],
    outcome: 'No end: bugs and ideas about Gubernos, sent from the app itself (menu → Report, ⌘K, or voice "bug: …"). Each one waits on the developer, then comes back for review.' }).slug;
}

const pageHtml = (snapshot, c, title) => {
  const vw = Number(String(c.viewport || '').split('x')[0]) || 1280;
  return `<!doctype html><html${c.theme && c.theme !== 'auto' ? ` data-theme="${c.theme}"` : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=${vw}">
<base href="http://127.0.0.1:${PORT}/"><link rel="stylesheet" href="app.css"><title>${title}</title></head>
<body class="${String(c.bodyClass || '').replace(/"/g, '')}" style="width:${vw}px" data-scroll="${(Array.isArray(c.scroll) ? c.scroll : []).map(Number).join(',')}">${String(snapshot).slice(0, 4e6)}</body></html>`;
};

// {kind: bug|idea, text, context: {...}, snapshot: html, errors: [..], images: [dataURL], share: bool (send the snapshot to the developer)}
export function report({ kind = 'bug', text = '', context = {}, snapshot = '', errors = [], images = [], share = false } = {}) {
  kind = kind === 'idea' ? 'idea' : 'bug';
  text = String(text || '').trim();
  const imgs = (Array.isArray(images) ? images : []).filter((x) => typeof x === 'string' && x.startsWith('data:image/')).slice(0, 3);
  if (!text && !imgs.length) throw httpError(400, 'say what happened, or attach a screenshot');
  const now = new Date();
  const id = `${localDate(now).replace(/-/g, '')}-${now.toTimeString().slice(0, 8).replace(/:/g, '')}-${kind}`;
  fs.mkdirSync(DIR, { recursive: true });
  const files = [];
  const c = context && typeof context === 'object' ? context : {};
  if (snapshot) {
    fs.writeFileSync(path.join(DIR, `${id}.html`), pageHtml(snapshot, c, `${kind} ${id}`));
    files.push(`data/feedback/${id}.html`);
  }
  imgs.forEach((d, i) => {
    const m = d.match(/^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/);
    if (!m) return;
    const f = `${id}-${i + 1}.${m[1].replace('jpeg', 'jpg')}`;
    fs.writeFileSync(path.join(DIR, f), Buffer.from(m[2], 'base64'));
    files.push(`data/feedback/${f}`);
  });
  const where = [c.screen || c.view, c.openTitle ? `task “${c.openTitle}”` : '', c.focus ? `${c.focus} mode` : ''].filter(Boolean).join(' · ');
  const errs = (Array.isArray(errors) ? errors : []).slice(-10).map(String);
  const notes = [text || '(screenshot only)', '',
    '## Context', '',
    `- Screen: ${where || '?'} (\`${c.url || ''}\`)`,
    `- Device: ${c.device || '?'} · ${c.viewport || '?'}${c.standalone ? ' · home-screen app' : ''} · theme ${c.theme || 'auto'}`,
    `- App version: ${version} · ${now.toISOString()}`,
    ...(c.openId ? [`- Open task: [[${c.openId}]]`] : []),
    ...(errs.length ? ['- Recent errors:', ...errs.map((e) => `  - ${e}`)] : []),
    '', '## Snapshot', '', ...(files.length ? files.map((f) => `- \`${f}\` (in the app folder)`) : ['- none']),
  ].join('\n');
  const title = `${kind === 'bug' ? 'Bug' : 'Idea'}: ${short(text || 'see the screenshot', 80)}`;
  // the developer's own install: a bug goes straight to the dev session's queue (ideas wait for the owner to send them)
  const toDev = DEV_AGENT && kind === 'bug';
  let task = createTask({ title, project: project(), status: toDev ? 'new' : 'wait', assigned: toDev ? 'agent' : 'someone', ...(toDev ? { agent: 'dev' } : {}), labels: ['feedback', kind], source: 'manual', notes });
  if (toDev) task = updateTask(task.id, { agent_state: 'queued' });
  fs.appendFileSync(FEED, `${JSON.stringify({ id, taskId: task.id, kind, text, context: c, files, errors: errs, at: now.toISOString() })}\n`);
  if (FEEDBACK_RELAY) {
    // after the reply: the outcome lands in the task's log
    sendRemote({ id, kind, title, text, c, errs, share: !!share, snapshot, imgs, now })
      .then(({ issue, key }) => appendLog(task.id, 'app', `Sent to the developer (report #${issue}) — answers come back here <!-- relay:${issue}:${key} -->`))
      .catch((e) => appendLog(task.id, 'app', `Couldn't send it to the developer (${e.message}). It stays here.`));
  }
  return { task, files, remote: !!FEEDBACK_RELAY };
}

async function sendRemote({ id, kind, title, text, c, errs, share, snapshot, imgs, now }) {
  const mask = (s) => String(s).replace(/(\/api\/tasks\/)[^\s/?]+/g, '$1…'); // task ids carry their titles
  let attachment = '';
  if (!share) imgs = []; // unticked: nothing visual leaves the Mac
  if ((share && snapshot) || imgs.length) {
    const shots = imgs.map((d) => `<p><img src="${d}" style="max-width:100%"></p>`).join('');
    attachment = pageHtml(`${share ? snapshot : ''}${shots ? `<section id="fb-shots" style="padding:16px">${shots}</section>` : ''}`, c, `${kind} ${id}`);
  }
  const body = [text || '(screenshot only)', '',
    '| | |', '|---|---|',
    `| Screen | ${share && c.openTitle ? `${c.screen} · task “${c.openTitle}”` : c.screen || c.view || '?'} |`,
    `| Device | ${c.device || '?'} · ${c.viewport || '?'}${c.standalone ? ' · home-screen app' : ''} · theme ${c.theme || 'auto'} |`,
    `| Version | ${version} · ${now.toISOString().slice(0, 16)}Z |`,
    `| Snapshot | ${attachment ? `${share ? 'screen' : ''}${share && imgs.length ? ' + ' : ''}${imgs.length ? `${imgs.length} screenshot${imgs.length > 1 ? 's' : ''}` : ''} (below)` : 'not shared'} |`,
    ...(errs.length ? ['', 'Recent errors:', '```', ...errs.map(mask), '```'] : []),
    '', `<sub>Sent from Gubernos · local task ${id}</sub>`].join('\n');
  // the relay takes 2 MB: a big snapshot goes without its screen, keeping the screenshots
  if (attachment.length > 1.8e6) attachment = imgs.length ? pageHtml(`<section id="fb-shots" style="padding:16px">${imgs.map((d) => `<p><img src="${d}" style="max-width:100%"></p>`).join('')}</section>`, c, `${kind} ${id}`) : '';
  if (attachment.length > 1.8e6) attachment = '';
  return relay('POST', '/feedback', { install: installId(), kind, title, body, ...(attachment ? { attachment } : {}) });
}

// Answers from the developer: new issue comments → the task's log; closed → review (push); a comment on an open
// issue → blocked (it's a question; push). Runs every 20 minutes when feedbackRelay is set.
let syncing = false;
const readSeen = () => { try { return JSON.parse(fs.readFileSync(SYNC, 'utf8')); } catch { return {}; } };
export async function syncRemote() {
  if (!FEEDBACK_RELAY || syncing) return;
  syncing = true;
  try { await syncOnce(); } finally { syncing = false; }
}
async function syncOnce() {
  const seen = readSeen();
  const open = listTasks().filter((t) => t.status !== 'done' && (t.labels || []).includes('feedback') && RELAY_RE.test(t.body));
  if (!open.length) return;
  for (const t of open) {
    const [, n, key] = t.body.match(RELAY_RE);
    let r;
    try { r = await relay('GET', `/feedback/${n}?key=${key}`); } catch { continue; }
    const s = seen[t.id] || { comments: 0, state: 'OPEN' };
    const dev = (r.comments || []).filter((x) => x.from !== 'reporter');
    const fresh = dev.slice(s.comments);
    for (const x of fresh) appendLog(t.id, 'developer', x.body.trim().slice(0, 2000));
    if (r.state !== 'OPEN' && s.state === 'OPEN') {
      appendLog(t.id, 'developer', `Done on the developer's side (report #${n}) — check it: Works now, or Still wrong (say what, in the box below).`);
      updateTask(t.id, { assigned: 'agent', agent_state: 'review', status: 'new' });
    } else if (fresh.length && r.state === 'OPEN') {
      appendLog(t.id, 'developer', `The developer asks (report #${n}): answer in the box below, then Reply.`);
      updateTask(t.id, { assigned: 'agent', agent_state: 'blocked', status: 'wait' });
    }
    seen[t.id] = { comments: dev.length, state: r.state };
  }
  fs.writeFileSync(SYNC, JSON.stringify(seen, null, 1));
}
// The reporter answers the developer, or sends a closed report back ("still wrong"): a comment through the relay, which
// reopens the issue; the task waits on the developer again. null = not a report sent through the relay.
export async function replyRemote(id, text) {
  const t = listTasks().find((x) => x.id === id);
  const m = FEEDBACK_RELAY && t?.body.match(RELAY_RE);
  if (!m) return null;
  await relay('POST', `/feedback/${m[1]}/reply?key=${m[2]}`, { body: text });
  appendLog(id, profile().id, `To the developer: ${text}`);
  const seen = readSeen(); // the reply reopened the issue: its next close counts again
  if (seen[id]) { seen[id].state = 'OPEN'; fs.writeFileSync(SYNC, JSON.stringify(seen, null, 1)); }
  return { ...updateTask(id, { assigned: 'someone', status: 'wait', agent_state: null }), relayed: true };
}

export function startSync() {
  if (!FEEDBACK_RELAY) return null;
  const run = () => syncRemote().catch((e) => console.error('[feedback]', e.message));
  setTimeout(run, 30e3);
  return setInterval(run, 20 * 60e3);
}
