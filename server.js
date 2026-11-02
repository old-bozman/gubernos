// Gubernos server: JSON API over the vault + static UI + live change events.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import * as V from './lib/vault.js';
import { runs, startRun, agentsAvailable, stopRun, publicRun } from './lib/runner.js';
import { transcribe, interpret, warm, vlog, voiceAvailable, voiceStatus } from './lib/voice.js';
import { breakdown, why, semanticSearch } from './lib/assist.js';
import * as G from './lib/gcal.js'; // Google sign-in (connect / callback); calendar work goes through lib/calendar.js
import * as Cal from './lib/calendar.js';
import * as AI from './lib/llm.js';
import * as Pair from './lib/pair.js';
import * as Mail from './lib/gmail.js';
import * as Push from './lib/push.js';
import * as Apns from './lib/apns.js';
import * as Notify from './lib/notify.js';
import * as Settings from './lib/settings.js';
import * as M from './lib/model.js';
import * as Plan from './lib/planner.js';
import * as P from './lib/pomodoros.js';
import * as Daily from './lib/daily.js';
import * as Oura from './lib/oura.js';
import * as Timers from './lib/timers.js';
import { ask } from './lib/chat.js';
import * as Triage from './lib/triage.js';
import { saveAttachment, attachmentFile, attachmentByName } from './lib/attachments.js';
import { PORT, PUBLIC_URL, APP_NAME, profile, clientConfig } from './lib/config.js';
import { registerCore, routeParams } from './lib/core-routes.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { clock, validAt } from './lib/clock.js';
import { report, startSync as feedbackSync } from './lib/feedback.js';

const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.join(path.dirname(new URL(import.meta.url).pathname), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

// ---------- live events (SSE) ----------
const clients = new Set();
function broadcast(type, data = {}) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
// AICODE-NOTE: on iCloud, merely READING a file updates its extended attributes, which fs.watch reports as a change.
// Clients reload on "changed" → read files → new event → reload… a loop that reset scroll every few seconds.
// So watch events only broadcast when a file's name/size/mtime actually changed; our own writes call changed(true).
const WATCHED = [V.DIRS.tasks, V.DIRS.projects, V.DIRS.goals, V.DIRS.inbox, V.DIRS.archive, ...M.MODEL_DIRS, Daily.DIR];
function snapshot() {
  const parts = [];
  for (const dir of WATCHED) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (!n.endsWith('.md') || n.startsWith('.')) continue; // iCloud/Obsidian temp files come and go
      try { const st = fs.statSync(path.join(dir, n)); parts.push(`${dir}/${n}:${st.size}:${st.mtimeMs}`); } catch { /* vanished */ }
    }
  }
  return parts.sort().join('|');
}
let lastSnap = snapshot();
let changeTimer;
function changed(force = false) {
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => {
    const snap = snapshot();
    if (!force && snap === lastSnap) return;
    if (process.env.GUBERNOS_DEBUG_WATCH) {
      const a = new Set(lastSnap.split('|')), b = new Set(snap.split('|'));
      const fmt = (x) => x.split('/').slice(-2).join('/');
      console.log('[watch] +', [...b].filter((x) => !a.has(x)).map(fmt).join(' ; ').slice(0, 300), '| -', [...a].filter((x) => !b.has(x)).map(fmt).join(' ; ').slice(0, 300));
    }
    lastSnap = snap;
    broadcast('changed');
  }, 250);
}
// A folder that doesn't exist yet (e.g. 05_model/issues/ before Cosy's first issue) gets its watcher once it appears.
const watching = new Set();
function armWatchers() {
  for (const dir of WATCHED) {
    if (watching.has(dir) || !fs.existsSync(dir)) continue;
    try { fs.watch(dir, () => changed()); watching.add(dir); } catch (e) { console.warn('watch failed', dir, e.message); }
  }
}
armWatchers();
setInterval(() => { armWatchers(); changed(); }, 60 * 1000); // also catches edits a watcher missed (iCloud)
setInterval(() => res0(() => { if (V.sweepArchive().length) changed(true); }), 5 * 60 * 1000);
// inbox triage (lib/triage.js): new captures get the agent's "what is it, what to do" a few seconds after they land
if (process.env.GUBERNOS_TRIAGE !== '0') {
  let triageTimer;
  const triageSoon = (ms = 3000) => { clearTimeout(triageTimer); triageTimer = setTimeout(() => Triage.sweep().then((n) => { if (n) changed(true); }).catch((e) => console.error('[triage]', e.message)), ms); };
  try { fs.watch(V.DIRS.inbox, () => triageSoon()); } catch { /* no inbox yet: the minute sweep */ }
  setInterval(() => triageSoon(0), 60 * 1000);
  triageSoon(10000);
}
function res0(fn) { try { fn(); } catch (e) { console.error(e); } }

// ---------- routing ----------
const requestClock = new AsyncLocalStorage();
clock.at = () => requestClock.getStore()?.at || null;
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), handler });

// the vault-only API (shared with the iOS app), plus what only this Mac has: agent runs, voice
registerCore(route, { stateExtras: () => ({ voice: voiceAvailable(), runs: [...runs.values()].map(publicRun), agents: agentsAvailable(), timers: Timers.list() }) });

route('POST', '/api/feedback', (_, __, b) => report(b));
route('POST', '/api/tasks/:id/run', ({ id }, _, b) => publicRun(startRun(id, { brief: b.brief, agent: b.agent, now: !!b.now })));
route('POST', '/api/runs/:id/stop', ({ id }) => publicRun(stopRun(id) || { id }));
// habit countdowns (lib/timers.js): the Protocol screen and the watch (through the iPhone app)
route('GET', '/api/timers', () => ({ timers: Timers.list() }));
route('GET', '/api/timers/health', () => ({ sessions: Timers.healthSessions() })); // mindful minutes for Apple Health (the iPhone)
route('POST', '/api/habits/:slug/timer', ({ slug }, _, b) => Timers.start(slug, b));
route('POST', '/api/timers/:id/stop', ({ id }, _, b) => Timers.stop(id, b));
route('POST', '/api/timers/:id/cancel', ({ id }) => Timers.cancel(id));
route('POST', '/api/voice/warm', () => warm());
route('GET', '/api/voice/status', () => voiceStatus()); // Settings → Voice: which engine, which language, what the Mac's models hear
// Client-side voice events and errors land in server.log, so phone issues can be diagnosed later.
route('POST', '/api/log', (_, __, b) => { vlog('client', String(b.ua || '').slice(0, 40), '|', String(b.msg || '').slice(0, 300)); return { ok: true }; });
route('POST', '/api/voice/parse', (_, __, b) => interpret(String(b.text || ''), b.context || {}));
route('POST', '/api/tasks/:id/breakdown', ({ id }) => breakdown(id));
route('POST', '/api/focus/why', (_, __, b) => why(String(b.taskId || ''), Array.isArray(b.candidateIds) ? b.candidateIds : []));
// Calendar time-blocking, the Mac's calendars or Google's (lib/calendar.js; events only after the UI's confirm step).
route('GET', '/api/ai', () => AI.providers()); // the model behind the app (Settings → Agents → Model): lib/llm.js
route('GET', '/api/gcal/status', () => Cal.status());
route('POST', '/api/calendar/mac/access', async () => { const access = await Cal.requestMacAccess(); Plan.forgetFree(); return { access }; }); // the system dialog, on the Mac's screen
route('GET', '/api/gcal/calendars', () => Cal.listCalendars());
route('POST', '/api/gcal/slots', (_, __, b) => Cal.freeSlots({ minutes: Number(b.minutes) || 50, from: b.from || null }));
route('POST', '/api/tasks/:id/timeblock', async ({ id }, _, b) => {
  const t = V.getTask(id);
  const sub = Number.isInteger(b.subtask) ? t.subtasks.find((x) => x.i === b.subtask) : null;
  const plain = (x) => x.replace(/\*\*|__|`|\[\[|\]\]/g, '').replace(/\s+/g, ' ').trim();
  const short = (x, n) => (x.length > n ? `${x.slice(0, n - 1)}…` : x);
  const title = sub ? `${short(plain(sub.text), 70)} — ${short(plain(t.title), 50)}` : plain(t.title);
  const link = `${PUBLIC_URL || `http://127.0.0.1:${PORT}`}/#/task/${id}`;
  const notes = t.body.replace(/<!--[\s\S]*?-->/g, '').replace(/^## Time blocks[\s\S]*?(?=^## |(?![\s\S]))/m, '').trim().slice(0, 1500);
  const ev = await Cal.createEvent({ title, start: b.start, end: b.end, taskId: id, description: `${link}\n\n${notes}` });
  Plan.forgetFree();
  return { event: ev, task: V.addTimeblock(id, { start: b.start, end: b.end, label: sub ? sub.text : '', event: ev.id }) };
});
route('PATCH', '/api/tasks/:id/timeblock/:event', async ({ id, event }, _, b) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(b.start || '') || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(b.end || '') || b.end <= b.start) throw V.httpError(400, 'start and end as YYYY-MM-DDTHH:MM, end after start');
  const ev = await Cal.moveEvent(event, { start: b.start, end: b.end });
  Plan.forgetFree();
  return { event: ev, task: V.moveTimeblock(id, event, { start: b.start, end: b.end }) };
});
route('DELETE', '/api/tasks/:id/timeblock/:event', async ({ id, event }) => {
  await Cal.deleteEvent(event).catch((e) => { if (!/404|410|Not Found|deleted/i.test(e.message)) throw e; });
  Plan.forgetFree();
  return V.removeTimeblock(id, event);
});
// Deep work / deep love blocks of the day: a calendar event (after the Plan screen's confirm) + "Blocks" in the day's ## Plan.
route('POST', '/api/day/block', async (_, __, b) => {
  const date = Daily.checkDate(b.date || V.localDate()), kind = b.kind === 'love' ? 'love' : 'work';
  if (!/^\d{2}:\d{2}$/.test(b.start || '') || !/^\d{2}:\d{2}$/.test(b.end || '') || b.end <= b.start) throw V.httpError(400, 'start and end as HH:MM, end after start');
  const one = Daily.getPlan(date)?.one;
  const title = kind === 'love' ? 'Deep love' : `Deep work${one?.text ? `: ${one.text}` : ''}`;
  const ev = await Cal.createEvent({ title, start: `${date}T${b.start}`, end: `${date}T${b.end}`, description: `${PUBLIC_URL || `http://127.0.0.1:${PORT}`}/#/day` });
  Plan.forgetFree();
  return Daily.changePlan(date, (p) => { p.blocks.push({ kind, start: b.start, end: b.end, event: ev.id }); });
});
route('DELETE', '/api/day/block/:event', async ({ event }, q) => {
  const id = event, date = Daily.checkDate(q.date || V.localDate());
  await Cal.deleteEvent(id).catch((e) => { if (!/404|410|Not Found|deleted/i.test(e.message)) throw e; });
  Plan.forgetFree();
  return Daily.changePlan(date, (p) => { p.blocks = p.blocks.filter((x) => x.event !== id); });
});
// Oura → habits that take it (also hourly from the notifier): read only, needs ~/.config/gubernos/oura.json
route('POST', '/api/oura/sync', () => Oura.sync());
// Gmail: reading is free; send/draft only from the UI's confirmation card.
route('GET', '/api/gmail/search', (_, q) => Mail.search({ query: q.q, max: Number(q.max) || 10 }));
route('GET', '/api/gmail/thread/:id', ({ id }) => Mail.thread(id));
const mailArgs = (b) => ({ to: b.to, cc: b.cc || '', subject: b.subject || '', body: b.body, threadId: b.threadId || null });
route('POST', '/api/gmail/send', async (_, __, b) => {
  const r = await Mail.send(mailArgs(b));
  vlog('mail', 'sent', r.id, '→', String(b.to).slice(0, 80));
  if (b.taskId) V.addMail(b.taskId, { threadId: r.threadId, subject: r.subject, note: `sent to ${b.to}` });
  return r;
});
route('POST', '/api/gmail/draft', async (_, __, b) => {
  const r = await Mail.draft(mailArgs(b));
  if (b.taskId && r.threadId) V.addMail(b.taskId, { threadId: r.threadId, subject: r.subject, note: `draft to ${b.to}` });
  return r;
});
// Notifications (Web Push to the home-screen app).
route('GET', '/api/push/key', () => ({ key: Push.publicKey(), devices: Push.subscriptions().length }));
route('POST', '/api/push/subscribe', (_, __, b) => Push.subscribe(b.subscription, b.ua));
route('POST', '/api/push/apns', (_, __, b) => Apns.register(b)); // the iPhone app's device token (gubernos-ios Gubernos/Push.swift)
route('POST', '/api/push/unsubscribe', (_, __, b) => Push.unsubscribe(b.endpoint));
route('POST', '/api/push/test', () => Push.sendAll({ title: APP_NAME, body: 'Notifications work ✓', url: '/#/today', tag: 'test' }));
// Day planner: free time today, the agent's draft (estimates, keep / move), cached estimates for Today's capacity line.
route('GET', '/api/plan/free', () => Plan.dayFree());
route('POST', '/api/plan/draft', (_, __, b) => Plan.draft({ refresh: !!b.refresh }));
route('GET', '/api/plan/estimates', () => Plan.cachedEstimates());
route('POST', '/api/search/semantic', (_, __, b) => semanticSearch(String(b.q || '')));
route('POST', '/api/chat', (_, __, b) => ask(b));

function streamRun(req, res, id) {
  const run = runs.get(id);
  if (!run) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  for (const ev of run.events) res.write(`data: ${JSON.stringify(ev)}\n\n`);
  if (run.state !== 'running') { res.write(`data: ${JSON.stringify({ kind: 'end', state: run.state })}\n\n`); res.end(); return; }
  const on = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  const end = () => res.end();
  run.on('event', on); run.once('end', end);
  req.on('close', () => { run.off('event', on); run.off('end', end); });
}

async function readBody(req) {
  let s = '';
  for await (const c of req) s += c;
  return s ? JSON.parse(s) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    // pairing (lib/pair.js): other devices need the Mac's token once it is required; the Mac itself always gets in
    if (url.pathname === '/pair') return Pair.pairPage(req, res, url);
    if (!Pair.allowed(req)) return Pair.deny(req, res, url);
    if (url.pathname.startsWith('/api/pair')) {
      const json = (o) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(o));
      if (url.pathname === '/api/pair' && req.method === 'GET') return json(Pair.info(req));
      if (!Pair.isLocal(req)) throw V.httpError(403, 'only on the Mac itself');
      const body = await readBody(req);
      if (url.pathname === '/api/pair/required' && req.method === 'POST') { Pair.setRequired(body.on); return json(Pair.info(req)); }
      if (url.pathname === '/api/pair/rotate' && req.method === 'POST') { Pair.rotate(); return json(Pair.info(req)); }
    }
    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': hi\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (url.pathname === '/api/attachments' && req.method === 'POST') {
      const chunks = []; let size = 0;
      for await (const c of req) { size += c.length; if (size > 25e6) throw V.httpError(413, 'file too large (25 MB max)'); chunks.push(c); }
      const q = url.searchParams;
      const out = saveAttachment(Buffer.concat(chunks), { name: q.get('name') || 'file', taskId: q.get('task') || null, project: q.get('project') || null });
      changed(true);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(out));
      return;
    }
    if (url.pathname.startsWith('/api/attachment/')) {
      const { abs, type } = attachmentFile(url.pathname.slice('/api/attachment/'.length));
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=86400' }).end(fs.readFileSync(abs));
      return;
    }
    if (url.pathname === '/api/attachment-by-name') {
      const rel = attachmentByName(url.searchParams.get('name') || '');
      if (!rel) throw V.httpError(404, 'not found');
      res.writeHead(302, { Location: `/api/attachment/${encodeURIComponent(rel)}` }).end();
      return;
    }
    if (url.pathname === '/api/voice' && req.method === 'POST') {
      const chunks = [];
      let size = 0;
      for await (const c of req) { size += c.length; if (size > 25e6) throw V.httpError(413, 'recording too long'); chunks.push(c); }
      const out = await transcribe(Buffer.concat(chunks), req.headers['content-type'], { quick: url.searchParams.get('quick') === '1' });
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(out));
      return;
    }
    if (url.pathname === '/api/gcal/connect') {
      res.writeHead(302, { Location: G.authUrl() }).end();
      return;
    }
    if (url.pathname === '/api/gcal/callback') {
      await G.callback(Object.fromEntries(url.searchParams));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        .end('<meta name="viewport" content="width=device-width"><body style="font:16px system-ui;padding:40px">✓ Google connected (Calendar + Gmail). You can close this tab and go back to the app.</body>');
      return;
    }
    const rs = url.pathname.match(/^\/api\/runs\/([^/]+)\/stream$/);
    if (rs) return streamRun(req, res, rs[1]);

    if (url.pathname.startsWith('/api/')) {
      for (const r of routes) {
        const m = r.method === req.method && url.pathname.match(r.re);
        if (!m) continue;
        const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : {};
        // an edit from the iPhone's offline queue runs at the time it was made there (lib/clock.js)
        const at = req.method !== 'GET' ? validAt(req.headers['x-gubernos-at']) : null;
        if (req.headers['x-gubernos-at']) console.log(`[offline] ${req.method} ${url.pathname} queued on the phone at ${req.headers['x-gubernos-at']}${req.headers['x-gubernos-why'] ? ` — direct write failed: ${decodeURIComponent(String(req.headers['x-gubernos-why'])).slice(0, 500)}` : ''}`);
        const out = await requestClock.run({ at }, () => r.handler(routeParams(m.groups), Object.fromEntries(url.searchParams), body));
        if (req.method !== 'GET') changed(true);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(out));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' }).end('{"error":"not found"}');
      return;
    }
    // static
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.join(PUBLIC, path.normalize(rel));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(fs.readFileSync(path.join(PUBLIC, 'index.html')));
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' })
      .end(fs.readFileSync(file));
  } catch (e) {
    if (!e.status) console.error(e);
    res.writeHead(e.status || 500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, HOST, () => {
  Cal.prepare(); // the Mac's calendar helper: built in the background on first start (lib/maccal.js)
  res0(() => V.sweepArchive());
  // AICODE-NOTE: a second server on a vault copy (tests: GUBERNOS_VAULT=<copy>) shares data/ — push subscriptions and the
  // notifier's state — unless it has its own GUBERNOS_DATA_DIR. Both notifiers then flip each other's state every 20 s and
  // push the owner's phone again and again (2026-10-10). So: no notifier there.
  const sharedData = process.env.GUBERNOS_VAULT && !process.env.GUBERNOS_DATA_DIR;
  if (!process.env.GUBERNOS_NO_NOTIFY && !sharedData) Notify.start();
  Timers.boot(() => changed(true)); // running habit timers finish at their end, also after a restart
  feedbackSync(); // answers to bug reports sent to someone else's GitHub repo (no-op on the developer's own install)
  console.log(`${APP_NAME} → http://${HOST}:${PORT}  (vault: ${V.VAULT})`);
});
