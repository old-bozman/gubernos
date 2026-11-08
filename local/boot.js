// iOS offline mode: the app runs on the phone without the Mac. The native shell (gubernos-ios) hands over the vault's
// markdown files; the vault-only API (lib/core-routes.js) runs right here in the page, and every fetch('/api/…') of
// the unchanged app.js is answered locally. What needs the Mac (agents, chat, voice, Google, Plan the day's estimates)
// answers "needs the Mac". Built into a bundle by scripts/build-local.mjs.
//
// Bridge (window.webkit.messageHandlers.gubernos, WKScriptMessageHandlerWithReply), messages → reply:
//   {op: 'load'}                        → {vault: {relPath: {text, mtime}}, data: {relPath: text}, config, pending, mirror}
//                                          mirror: the files are the Mac's copy (no iCloud folder): vault writes are refused,
//                                          so every change waits in the outbox for the Mac (gubernos-ios Gubernos/Mirror.swift)
//   {op: 'refresh', since: ms}          → {files: {relPath: {text, mtime}} changed since, paths: [every vault .md now]}
//   {op: 'write', path, text, created}  → {ok: true}   path is /vault/… or /data/… (the shell maps them to disk)
//   {op: 'move', from, to}              → {ok: true}   /vault paths (completing → 80_archive/)
//   {op: 'listen', free} / 'listenMode' / 'listenStop' / 'listenCancel' → voice on the phone; text comes via window.gubernosSpeech
//   {op: 'claude', body, timeoutMs}     → a Claude API response (body and reply: JSON text): the shell sends it with the key from the iPhone's Keychain
//                                          (local/llm.js); the chat, ✦ steps and inbox triage work without the Mac
// A test page sets window.gubernosMockBridge with the same call().
const native = window.webkit?.messageHandlers?.gubernos;
const bridge = native ? { call: (m) => native.postMessage(m) } : window.gubernosMockBridge;
if (!bridge) throw new Error('no native bridge');

globalThis.process = { env: { GUBERNOS_VAULT: '/vault', GUBERNOS_DATA_DIR: '/data', HOME: '/home', GUBERNOS_NO_NOTIFY: '1' }, exit() {}, platform: 'ios', versions: {} };

const { vfs } = await import('/local/shims/fs.js');
// while the shell reads the vault: say so on the screen; on failure show the reason and a Retry (never a blank page)
const say = (html) => { const m = document.getElementById('main'); if (m) m.innerHTML = `<div class="empty" style="padding:40px 20px">${html}</div>`; };
say('Reading your system folder on the phone…');
const slow = setTimeout(() => say('Still reading your system folder — iCloud may be downloading it…'), 8000);
let boot;
try { boot = await bridge.call({ op: 'load' }); } catch (e) {
  clearTimeout(slow);
  say(`Couldn’t read the system folder: ${String(e?.message || e).replace(/</g, '&lt;')}<br><br><button class="btn" onclick="location.reload()">Retry</button> <button class="btn" onclick="window.webkit?.messageHandlers?.gubernos?.postMessage({op:'settings'})">Settings</button>`);
  throw e;
}
clearTimeout(slow);
if (!Object.keys(boot.vault || {}).length) { say(`No files found in the chosen folder${boot.pending ? ` yet — ${boot.pending} are still coming from iCloud` : ''}. Pick the folder with 10_tasks and 20_projects.<br><br><button class="btn" onclick="location.reload()">Retry</button> <button class="btn" onclick="window.webkit?.messageHandlers?.gubernos?.postMessage({op:'settings'})">Settings</button>`); throw new Error('no vault files'); }
vfs.load('/vault', boot.vault || {});
vfs.load('/data', boot.data || {});
if (boot.config) vfs.load('/home/.config/gubernos', { 'config.json': JSON.stringify(boot.config) });
// writes and moves go to the phone's iCloud copy in order; each returns its own promise (rejects if the shell couldn't)
// A refused write is tried once more a moment later (iCloud may hold the file briefly); a move that already happened counts.
let chain = Promise.resolve();
const attempt = (msg) => bridge.call(msg).catch(async (e) => { await new Promise((r) => setTimeout(r, 800)); return bridge.call(msg).catch((e2) => { throw new Error(`${msg.op} ${msg.path || msg.from}: ${e2?.message || e2 || e}`); }); });
const serial = (msg) => { const pr = chain.then(() => attempt(msg)); chain = pr.catch((e) => console.error('[local]', e.message)); return pr; };
// AICODE-NOTE: the day's file (50_reviews/daily/) is written many times a day by both devices (check-ins, Health values,
// the plan): offline, the phone never writes it to iCloud — the change stays in this copy and goes to the Mac's queue, and
// the Mac merges it into its current file. (2026-10-12: a Mac that slept through the morning kept its old copy of the day,
// wrote Health values over it at 13:58, and iCloud dropped the morning's check-ins made on the phone.) Other files are
// written only if the phone has their latest version (the shell checks; base = the version this edit was made on).
vfs.onWrite = (p, text, created, base) => (p.startsWith('/vault/50_reviews/daily/')
  ? Promise.reject(new Error('the day’s file is written by the Mac (several writers)'))
  : serial({ op: 'write', path: p, text, created, base }));
vfs.onMove = (from, to) => serial({ op: 'move', from, to });
// files changed elsewhere (the Mac, Obsidian, an agent) since the last look: before every change, and on reads older than 15 s
let lastSync = Date.now();
async function refresh() {
  if (!native) return;
  const r = await bridge.call({ op: 'refresh', since: lastSync - 5000 }).catch(() => null);
  if (!r) return;
  lastSync = Date.now();
  vfs.sync('/vault', r.files || {}, r.paths || null);
}

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), handler });
const { registerCore, routeParams } = await import('/lib/core-routes.js');
registerCore(route, { stateExtras: () => ({ local: true, ...(native && window.gubernosNative?.speech ? { voice: 'device' } : {}) }) }); // device: the shell recognizes speech (app.js deviceVoiceCapture)
// a shell that can send to the Claude API (gubernos-ios Gubernos/Claude.swift): what needs a model runs here too, on the owner's key
const claude = !native || window.gubernosNative?.claude;
let Triage = null;
if (claude) {
  const [Chat, Assist] = await Promise.all([import('/lib/chat.js'), import('/lib/assist.js')]);
  Triage = await import('/lib/triage.js');
  route('POST', '/api/chat', (_, __, b) => Chat.ask(b));
  route('POST', '/api/tasks/:id/breakdown', ({ id }) => Assist.breakdown(id));
  // the Ask chat (hidden offline without a key: app.css)
  const n = native ? await bridge.call({ op: 'native' }).catch(() => ({})) : { claudeKey: true };
  if (n.claudeKey) document.documentElement.classList.add('local-claude');
}

// Changes go straight to the phone's iCloud copy (the shim writes; this refreshes first so the change applies to the
// fresh files). If the shell can't write, the request waits in /data/outbox.json and is sent to the Mac when it is
// back (gubernos-ios Gubernos/Outbox.swift). On each start, still-waiting requests are re-applied to this in-memory copy.
const fs = (await import('/local/shims/fs.js')).default;
let outbox = [];
try { outbox = JSON.parse(boot.data?.['outbox.json'] || '[]'); } catch { outbox = []; }
const saveOutbox = () => fs.writeFileSync('/data/outbox.json', JSON.stringify(outbox));

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
async function handle(method, url, body, { replay = false } = {}) {
  const u = new URL(url, location.href);
  const r = routes.find((x) => x.method === method && x.re.test(u.pathname));
  if (!r) return json(503, { error: 'Offline on the phone — this needs the Mac' });
  const change = method !== 'GET';
  try {
    if (change && !replay) await refresh();
    else if (!change && Date.now() - lastSync > 15000) await refresh();
    vfs.mode = replay ? 'memory' : 'direct';
    const writes = vfs.capture = [];
    let out;
    const input = body ? JSON.parse(body) : {};
    try { out = r.handler(routeParams(r.re.exec(u.pathname).groups), Object.fromEntries(u.searchParams), input); } finally { vfs.mode = 'direct'; vfs.capture = null; }
    out = await out;
    if (change && !replay && writes.length) {
      const why = (await Promise.allSettled(writes)).filter((x) => x.status === 'rejected').map((x) => String(x.reason?.message || x.reason)).join('; ');
      // the reason goes with it: the Mac logs it when the queue arrives (server.log "[offline]"). The body is the one the
      // route ended with: a route that made something on the phone writes it in (#1's new task → its link), so the Mac
      // links the same task instead of making it again.
      if (why && !/^\/api\/(settings|pomodoros)/.test(u.pathname)) { outbox.push({ method, url: u.pathname + u.search, body: body ? JSON.stringify(input) : null, at: new Date().toISOString(), why: why.slice(0, 500) }); saveOutbox(); badge(); }
    }
    return json(200, out ?? { ok: true });
  } catch (e) {
    console.warn('[local]', method, u.pathname, e.message);
    return json(e.status || 500, { error: e.message });
  }
}
for (const op of outbox) await handle(op.method, op.url, op.body, { replay: true }); // the edits waiting for the Mac, back on this copy
const realFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  const path = new URL(url, location.href).pathname;
  if (!path.startsWith('/api/')) return realFetch(input, init);
  if (typeof init.body !== 'string' && init.body != null) return Promise.resolve(json(503, { error: 'Offline on the phone — this needs the Mac' })); // audio, uploads
  return handle((init.method || 'GET').toUpperCase(), url, init.body);
};
// no live stream offline: an EventSource that never connects (app.js re-reads on focus anyway)
window.EventSource = class { constructor() { this.readyState = 2; } addEventListener() {} close() {} };
window.gubernosLocal = { handle, vfs, flush: () => chain };
document.documentElement.classList.add('local-mode');
function badge() {
  if (!document.body) return addEventListener('DOMContentLoaded', badge, { once: true });
  const n = outbox.length;
  document.body.setAttribute('data-offline', `Offline · ${n ? `${n} change${n === 1 ? '' : 's'} waiting for the Mac` : boot.mirror ? 'your copy from the Mac' : 'saved to iCloud'}${boot.pending ? ` · ${boot.pending} files coming` : ''}`);
}
badge();

await import('/app.js');

// inbox triage, as the Mac does it (lib/triage.js), for captures with no proposal yet: a minute after start, then every minute.
// A shared link's page is left to the Mac (the phone can't fetch other sites). No key: one quick refusal from the shell a minute.
if (Triage && native) {
  const { listInbox } = await import('/lib/vault.js');
  const failed = new Map();
  let busy = false;
  const sweep = async () => {
    if (busy) return;
    busy = true;
    try {
      await refresh();
      for (const it of listInbox().filter((x) => !x.triage && !(x.url && !x.fetched) && (failed.get(x.id) || 0) < 2).reverse()) {
        try { await Triage.triage(it); } catch (e) { if (e.status === 503) break; failed.set(it.id, (failed.get(it.id) || 0) + 1); console.warn('[triage]', it.id, e.message); }
      }
    } finally { busy = false; }
  };
  setTimeout(sweep, 5000);
  setInterval(sweep, 60000);
}

// files iCloud is still bringing: look again every 10 s; reload once they're all here (or a good part of them)
if (boot.pending && native) {
  const timer = setInterval(async () => {
    const left = await bridge.call({ op: 'pending' }).catch(() => boot.pending);
    if (left === 0 || boot.pending - left >= 10) { clearInterval(timer); location.reload(); }
  }, 10000);
}
