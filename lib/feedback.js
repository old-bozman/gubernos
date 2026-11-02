// Bug reports and ideas about the app itself, sent from any screen (menu → Report, ⌘K, voice "баг: …").
// Each report becomes a task in the vault under the list project "Gubernos feedback" (status wait: waiting on the
// developer) and one line in data/feedback.jsonl, which a developer session watches. The screen snapshot (the page's
// HTML, rendered again with app.css) and screenshots stay in data/feedback/ — app data, not canon.
// When a report is handled, the developer logs it in the task and hands it over for review (assigned: agent,
// agent_state: review), so the owner gets the usual "Agent finished" push and accepts or sends back.
//
// Someone else's install (config feedbackRepo, set by setup.sh) also opens a GitHub issue in the app's repo through the
// `gh` CLI, under their own GitHub account. AICODE-NOTE: the repo is public, so the issue is too — the form says so.
// The issue carries the text, screen name, device and errors (task ids masked). Screenshots, the screen snapshot and the
// open task's title go with the form's "Publish screenshots" tick (on by default, the reporter can untick it), as one HTML file in a
// secret gist, which anyone with its link (in the public issue) can open. Voice reports open the form first.
// The developer answers in the issue; syncRemote() brings comments back into the task's log, and a closed issue hands
// the task over for review (push) — a comment on an open issue marks it "blocked" (a question, push too).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, execFile } from 'node:child_process';
import { createTask, createProject, listProjects, listTasks, appendLog, updateTask, httpError, localDate } from './vault.js';
import { profile, PORT, FEEDBACK_REPO, DEV_AGENT } from './config.js';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = process.env.GUBERNOS_DATA_DIR || path.join(ROOT, 'data');
const DIR = path.join(DATA, 'feedback');
export const FEED = path.join(DATA, 'feedback.jsonl');
const SYNC = path.join(DATA, 'feedback-sync.json');
const PROJECT = 'gubernos-feedback';
const ISSUE_RE = /<!-- issue:(https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+) -->/;
const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s);
// the app's version: an install without git keeps it in .gubernos-version ("owner/repo sha", install.sh); a checkout asks git
const version = (() => {
  try { return fs.readFileSync(path.join(ROOT, '.gubernos-version'), 'utf8').split(/\s+/)[1].slice(0, 7); } catch { /* a git checkout */ }
  try { return execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return '?'; }
})();
const GH = process.env.GUBERNOS_GH_BIN || ['/opt/homebrew/bin/gh', '/usr/local/bin/gh'].find((f) => fs.existsSync(f)) || 'gh';
const gh = (args, input = null) => new Promise((ok, no) => {
  const p = execFile(GH, args, { timeout: 90000, maxBuffer: 2e7 }, (e, out, err) => (e ? no(new Error(String(err || e.message).trim().slice(0, 300))) : ok(String(out).trim())));
  if (input != null) p.stdin.end(input);
});

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
  if (FEEDBACK_REPO) {
    // after the reply: gh takes a few seconds; the outcome lands in the task's log
    sendRemote({ id, kind, title, text, c, errs, share: !!share, snapshot, imgs, now })
      .then((url) => appendLog(task.id, 'app', `Sent to the developer: ${url} — answers come back here <!-- issue:${url} -->`))
      .catch((e) => appendLog(task.id, 'app', `Couldn't send it to the developer (${e.message}). It stays here; try "gh auth login" in Terminal.`));
  }
  return { task, files, remote: !!FEEDBACK_REPO };
}

async function sendRemote({ id, kind, title, text, c, errs, share, snapshot, imgs, now }) {
  const mask = (s) => String(s).replace(/(\/api\/tasks\/)[^\s/?]+/g, '$1…'); // task ids carry their titles
  let gist = '';
  if (!share) imgs = []; // unticked: nothing visual leaves the Mac
  if ((share && snapshot) || imgs.length) {
    const f = path.join(DIR, `${id}-share.html`);
    const shots = imgs.map((d) => `<p><img src="${d}" style="max-width:100%"></p>`).join('');
    fs.writeFileSync(f, pageHtml(`${share ? snapshot : ''}${shots ? `<section id="fb-shots" style="padding:16px">${shots}</section>` : ''}`, c, `${kind} ${id}`));
    gist = (await gh(['gist', 'create', '--desc', `Gubernos feedback ${id}`, f])).split('\n').pop(); // secret by default
  }
  const body = [text || '(screenshot only)', '',
    '| | |', '|---|---|',
    `| Screen | ${share && c.openTitle ? `${c.screen} · task “${c.openTitle}”` : c.screen || c.view || '?'} |`,
    `| Device | ${c.device || '?'} · ${c.viewport || '?'}${c.standalone ? ' · home-screen app' : ''} · theme ${c.theme || 'auto'} |`,
    `| Version | ${version} · ${now.toISOString().slice(0, 16)}Z |`,
    `| Snapshot | ${gist ? `${gist} — ${share ? 'screen' : ''}${share && imgs.length ? ' + ' : ''}${imgs.length ? `${imgs.length} screenshot${imgs.length > 1 ? 's' : ''}` : ''}; render: \`gh gist view ${gist.split('/').pop()} --raw --filename ${id}-share.html > s.html && node scripts/feedback-view.mjs s.html\`` : 'not shared'} |`,
    ...(errs.length ? ['', 'Recent errors:', '```', ...errs.map(mask), '```'] : []),
    '', `<sub>Sent from Gubernos · local task ${id}</sub>`].join('\n');
  const args = ['issue', 'create', '-R', FEEDBACK_REPO, '--title', title, '--body-file', '-'];
  try { return (await gh([...args, '--label', 'feedback', '--label', kind], body)).split('\n').pop(); } catch (e) {
    if (!/label/i.test(e.message)) throw e;
    return (await gh(args, body)).split('\n').pop(); // the repo has no such labels
  }
}

// Answers from the developer: new issue comments → the task's log; closed → review (push); a comment on an open
// issue → blocked (it's a question; push). Runs every 20 minutes when feedbackRepo is set.
let me = null, syncing = false;
export async function syncRemote() {
  if (!FEEDBACK_REPO || syncing) return;
  syncing = true;
  try { await syncOnce(); } finally { syncing = false; }
}
async function syncOnce() {
  const seen = (() => { try { return JSON.parse(fs.readFileSync(SYNC, 'utf8')); } catch { return {}; } })();
  const open = listTasks().filter((t) => t.status !== 'done' && (t.labels || []).includes('feedback') && ISSUE_RE.test(t.body));
  if (!open.length) return;
  me ||= process.env.GUBERNOS_FEEDBACK_ME || await gh(['api', 'user', '-q', '.login']).catch(() => null); // env: tests, where both sides are one account
  for (const t of open) {
    const url = t.body.match(ISSUE_RE)[1];
    let r;
    try { r = JSON.parse(await gh(['issue', 'view', url, '--json', 'state,comments'])); } catch { continue; }
    const s = seen[t.id] || { comments: 0, state: 'OPEN' };
    const fresh = (r.comments || []).slice(s.comments).filter((x) => x.author?.login !== me);
    for (const x of fresh) appendLog(t.id, 'developer', `${x.body.trim().slice(0, 2000)}\n  (${url})`);
    if (r.state !== 'OPEN' && s.state === 'OPEN') {
      appendLog(t.id, 'developer', `Closed on GitHub — check it and accept, or send back with what's still wrong. ${url}`);
      updateTask(t.id, { assigned: 'agent', agent_state: 'review', status: 'new' });
    } else if (fresh.length && r.state === 'OPEN') {
      appendLog(t.id, 'developer', `Answer on GitHub: ${url}`);
      updateTask(t.id, { assigned: 'agent', agent_state: 'blocked', status: 'wait' });
    }
    seen[t.id] = { comments: (r.comments || []).length, state: r.state };
  }
  fs.writeFileSync(SYNC, JSON.stringify(seen, null, 1));
}
export function startSync() {
  if (!FEEDBACK_REPO) return null;
  const run = () => syncRemote().catch((e) => console.error('[feedback]', e.message));
  setTimeout(run, 30e3);
  return setInterval(run, 20 * 60e3);
}
