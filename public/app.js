import { parseQuick, iso, fromIso, matchProject } from './parse.js';
import { describeRepeat, toRecurrence } from './recur.js';
import { CONCEPT_CSS, conceptHtml, wheelSvg, loopsHtml, captureHtml, TEXT } from './concept.js';

// ---------- state ----------
const S = {
  data: { tasks: [], projects: [], inbox: [], runs: [], today: iso(new Date()) },
  view: 'today', arg: null, openId: null, sel: -1, logbook: null, q: '', editingBody: false,
  runLog: {}, // runId -> events
  expanded: loadExpanded(), // task ids with subtasks shown inline
};
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const PRI = { urgent: 0, planned: 1, someday: 2 };
// Who the app works for (vault profile.md + machine config, from /api/state): name, log id, categories, assistant, Obsidian vault.
// the product name (index.html <meta name="application-name">, with <title>, apple-mobile-web-app-title and the manifest)
const APP_NAME = document.querySelector('meta[name="application-name"]')?.content || 'Gubernos';
const ME = () => S.data?.me || { id: 'me', name: 'Me', categories: ['work', 'home', 'energy', 'love', 'finance'], assistant: null, obsidian: null };
const cats = () => ME().categories;

// iPhone app (gubernos-ios): hand iOS what it should ring by itself — no Mac, no network needed:
// the open tasks' future reminders, the morning plan and the evening check-in for today and tomorrow (computed from
// the data as it is now), and the icon badge (= the Today count). Sent after every load; only changes are sent.
// The iPhone app's widgets show Today / Inbox (gubernos-ios Shared/AppGroup.swift): sent when they change.
let widgetCounts = '';
function syncWidgetCounts() {
  const h = window.webkit?.messageHandlers?.gubernos;
  if (!h || !S.data?.tasks) return;
  const c = { op: 'counts', today: VIEWS.today.count(), inbox: VIEWS.inbox.count(), overdue: S.data.tasks.filter((t) => open(t) && t.due && t.due < S.data.today && t.assigned !== 'agent').length };
  const key = JSON.stringify([S.data.today, c]);
  if (key === widgetCounts) return;
  widgetCounts = key;
  Promise.resolve(h.postMessage(c)).catch(() => {}); // an older app without the op
}
function syncNativeReminders() {
  const h = window.webkit?.messageHandlers?.gubernos;
  if (!h || !S.data?.tasks) return;
  const soon = Date.now() - 60e3;
  const open = S.data.tasks.filter((t) => t.status !== 'done');
  const items = open.filter((t) => t.reminder && t.reminder.length >= 16 && new Date(t.reminder.slice(0, 16)).getTime() > soon)
    .map((t) => ({ id: t.id, title: t.title, at: t.reminder.slice(0, 16), due: t.due || null })).sort((a, b) => a.at.localeCompare(b.at)).slice(0, 50);
  const day = (n) => { const d = fromIso(S.data.today); d.setDate(d.getDate() + n); return iso(d); };
  const order = { urgent: 0, planned: 1, someday: 2 };
  const checkins = [];
  const digestAt = S.settings ? S.settings.digestAt : '08:30';
  for (const d of [day(0), day(1)]) {
    const mine = open.filter((t) => t.assigned !== 'agent' && t.due && t.due <= d);
    const overdue = mine.filter((t) => t.due < d).length, review = open.filter((t) => t.assigned === 'agent' && t.agent_state === 'review').length;
    const decs = (S.data.decisions || []).filter((x) => x.status === 'open' && x.decide_by && x.decide_by <= day(3)).length;
    const parts = [mine.length ? `${mine.length} task${mine.length === 1 ? '' : 's'}` : '', overdue ? `${overdue} overdue` : '', review ? `${review} to review` : '', decs ? `${decs} decision${decs === 1 ? '' : 's'}` : ''].filter(Boolean);
    const top = [...mine].sort((a, b) => (order[a.priority] ?? 3) - (order[b.priority] ?? 3)).slice(0, 3).map((t) => `• ${t.title.slice(0, 60)}`).join('\n');
    const badge = open.filter((t) => t.due && t.due <= d).length; // what Today will show that day
    if (digestAt && parts.length) checkins.push({ id: `digest-${d}`, at: `${d}T${digestAt}`, title: mine.length ? `Plan your day · ${parts.join(' · ')}` : `Today: ${parts.join(' · ')}`, body: top || 'Agent work is waiting for review', hash: mine.length ? '#/plan' : '#/today', badge });
    const eveningAt = S.settings ? S.settings.eveningAt : '19:00', reflectionAt = S.settings ? S.settings.reflectionAt : '22:00';
    if (reflectionAt && !(d === S.data.today && S.data.reflectedToday)) checkins.push({ id: `reflect-${d}`, at: `${d}T${reflectionAt}`, title: 'Daily reflection', body: 'Three short answers about today — under five minutes.', hash: '#/reflect' });
    // AM / PM protocols (habits module): a nudge when the window starts; today's is skipped once it's all done
    if (habitsOn()) for (const p of S.data.day?.protocols || []) {
      const s = d === S.data.today ? (S.data.day.summary || []).find((g) => g.protocol === p.slug) : null;
      if (s && s.done >= s.total) continue;
      // today's next habit can be checked off from the notification (the app's Done / Minimum / Skip, also on the watch)
      const act = d === S.data.today && p.next ? { category: p.next.quit ? 'GUBERNOS_HABIT_QUIT' : 'GUBERNOS_HABIT', habit: p.next.slug } : {};
      checkins.push({ id: `proto-${p.slug}-${d}`, at: `${d}T${p.window.start}`, title: `${p.title} protocol${s ? ` · ${s.done}/${s.total}` : ''}`, body: p.habits.slice(0, 4).join(' → ') || 'Your protocol', hash: '#/day', ...act });
      // halfway through the window, if under half is done by then: the next habit (rescheduled on every load, so it knows)
      const mid = (() => { const [x, y] = [p.window.start, p.window.end].map((v) => +v.slice(0, 2) * 60 + +v.slice(3)); const m = Math.round((x + y) / 2); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; })();
      if (!s || s.done * 2 < s.total) checkins.push({ id: `proto-mid-${p.slug}-${d}`, at: `${d}T${mid}`, title: `${p.title}${s ? ` · ${s.done}/${s.total}` : ''}${d === S.data.today && p.next ? ` — next: ${p.next.title.slice(0, 40)}` : ''}`, body: (d === S.data.today && p.next?.cue) || `Before ${p.window.end}`, hash: '#/day', ...act });
    }
    if (mine.length && eveningAt) checkins.push({ id: `evening-${d}`, at: `${d}T${eveningAt}`, title: `${mine.length} left for today`, body: `Move ${mine.length === 1 ? 'it' : 'them'} to tomorrow? ${mine.slice(0, 2).map((t) => t.title.slice(0, 40)).join(' · ')}`, hash: '#/plan/evening' });
  }
  const badge = open.filter((t) => t.due && t.due <= S.data.today).length;
  const msg = { op: 'reminders', items, checkins: checkins.filter((c) => new Date(c.at).getTime() > soon), badge };
  const sig = JSON.stringify(msg);
  if (sig === S.remindersSent) return;
  S.remindersSent = sig;
  h.postMessage(msg).catch(() => { S.remindersSent = null; });
}

// iPhone app: Apple Health → the habits that take it (auto: health:…). The shell reads HealthKit (gubernos-ios Gubernos/Health.swift)
// for today and yesterday; the values go to /api/habits/auto (the Mac, or the phone's own copy offline). At most every 15 min.
async function syncHealth(force = false) {
  const h = window.webkit?.messageHandlers?.gubernos, want = (S.data.day?.auto || []).filter((x) => x.startsWith('health:'));
  // offline (no Mac): wait — Health values go to the Mac, which writes the day's file (local/boot.js)
  if (!h || !want.length || !habitsOn() || S.data.local || (!force && Date.now() - (S.healthAt || 0) < 15 * 60e3)) return;
  S.healthAt = Date.now();
  const today = S.data.today, y = (() => { const d = fromIso(today); d.setDate(d.getDate() - 1); return iso(d); })();
  let r;
  try { r = await h.postMessage({ op: 'health', dates: [y, today], metrics: want.map((x) => x.slice(7)) }); } catch (e) { noteErr(`health: ${e?.message || e}`); return; }
  let n = 0;
  for (const d of [y, today]) {
    if (!r?.[d] || !Object.keys(r[d]).length) continue;
    try { n += (await api('POST', '/api/habits/auto', { date: d, source: 'health', values: r[d] })).applied.length; } catch { /* the next look */ }
  }
  if (n) { bgLoad(); if (S.view === 'day' && !typing()) loadDay(S.day?.date || today); }
}

// The last errors on this page, sent along with a bug report (Report a bug or idea).
const ERRS = [];
const noteErr = (m) => { ERRS.push(`${new Date().toTimeString().slice(0, 8)} ${String(m ?? '').slice(0, 200)}`); if (ERRS.length > 10) ERRS.shift(); };
window.addEventListener('error', (e) => noteErr(e.message));
window.addEventListener('unhandledrejection', (e) => noteErr(e.reason?.message || e.reason));

async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  // not paired (another device, after the Mac turned pairing on): reload, and the Mac answers with its pairing page
  if (r.status === 401 && /^not paired/.test(j.error || '') && /^https?:$/.test(location.protocol) && !sessionStorage.getItem('unpaired')) {
    try { sessionStorage.setItem('unpaired', '1'); } catch { /* private window */ }
    location.replace('/');
  }
  if (r.ok && url === '/api/state') try { sessionStorage.removeItem('unpaired'); } catch { /* private window */ }
  if (!r.ok) { noteErr(`${method} ${url} → ${r.status} ${j.error || ''}`); toast(j.error || `Error ${r.status}`); throw new Error(j.error); }
  return j;
}

async function load() {
  S.data = await api('GET', '/api/state');
  syncNativeReminders();
  syncWidgetCounts();
  syncHealth();
  document.body.classList.toggle('no-voice', S.data.voice === false); // voice not installed on the Mac: hide the mic
  if (S.view === 'logbook') S.logbook = await api('GET', '/api/logbook');
  if (['day', 'reflect'].includes(S.view) && S.day?.date && !S.day.loading) loadDay(S.day.date); // the day file may have changed elsewhere
  render();
}

// ---------- dates ----------
function dayDiff(a, b) { return Math.round((fromIso(a) - fromIso(b)) / 864e5); }
function dateLabel(d) {
  const n = dayDiff(d, S.data.today);
  const dt = fromIso(d);
  if (n === 0) return ['Today', 'd-today'];
  if (n === 1) return ['Tomorrow', 'd-tom'];
  if (n === -1) return ['Yesterday', 'd-over'];
  if (n > 1 && n < 7) return [dt.toLocaleDateString('en-GB', { weekday: 'long' }), 'd-week'];
  const s = dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(dt.getFullYear() !== fromIso(S.data.today).getFullYear() ? { year: 'numeric' } : {}) });
  return [s, n < 0 ? 'd-over' : ''];
}

// ---------- views ----------
const open = (t) => t.status !== 'done';
const byPri = (a, b) => PRI[a.priority] - PRI[b.priority] || (a.due || '9').localeCompare(b.due || '9') || a.id.localeCompare(b.id);
// A task's container: a project, or a model container (commitment / want / decision / issue) shown by its title.
const proj = (slug) => (slug ? S.data.projects.find((p) => p.slug === slug) || S.data.containers?.find((c) => c.slug === slug) || null : null);
const isProject = (slug) => S.data.projects.some((p) => p.slug === slug);
const agentState = (t) => (t.assigned !== 'agent' ? null : runFor(t.id) ? 'running' : t.agent_state || (t.status === 'wait' ? 'blocked' : 'queued'));
const runFor = (id) => S.data.runs.find((r) => r.taskId === id && r.state === 'running');

const VIEWS = {
  inbox: { title: 'Inbox', icon: '⌂', key: '1', count: () => S.data.inbox.length + S.data.tasks.filter((t) => open(t) && !t.project).length },
  today: { title: 'Today', icon: '◉', key: '2', count: () => S.data.tasks.filter((t) => open(t) && t.due && t.due <= S.data.today).length },
  upcoming: { title: 'Upcoming', icon: '▦', key: '3' },
  agent: { title: 'Agents', icon: '✦', key: '4', count: () => S.data.tasks.filter((t) => open(t) && t.assigned === 'agent').length,
    hot: () => S.data.tasks.filter((t) => open(t) && agentState(t) === 'review').length },
  waiting: { title: 'Waiting', icon: '⏸', key: '5', count: () => S.data.tasks.filter((t) => t.status === 'wait' && t.assigned !== 'agent').length },
  someday: { title: 'Someday', icon: '☁', key: '6', count: () => S.data.tasks.filter((t) => open(t) && t.priority === 'someday').length },
  // personal model: a screen appears only when there is data for it
  week: { title: 'Wins', icon: '★', hidden: () => !S.data.focus, count: () => { const w = thisWeek(); return w ? `${w.filter((x) => x.done).length}/${w.length}` : 0; } },
  // the badge: what's left of the protocol whose window is on now (AM in the morning, PM in the evening)
  day: { title: 'Protocol', icon: '◐', count: () => { if (!habitsOn()) return 0; const now = nowHM(), g = (S.data.day?.summary || []).find((x) => x.window && now >= x.window.start && now < x.window.end); return g ? g.total - g.done : 0; } },
  plan: { title: 'Plan the day', icon: '◷' },
  decisions: { title: 'Decisions', icon: '⚖', hidden: () => !S.data.decisions?.length && !S.decided?.length,
    count: () => (S.data.decisions || []).filter((d) => d.status === 'open').length,
    hot: () => (S.data.decisions || []).filter((d) => d.status === 'open' && d.decide_by && d.decide_by <= S.data.today).length },
  goals: { title: 'Goals', icon: '◎', hidden: () => !S.data.goalDetails?.length, count: () => S.data.goalDetails?.length || 0 },
  logbook: { title: 'Completed', icon: '✓', key: '7' },
  projects: { title: 'Projects', icon: '▤', count: () => S.data.projects.filter((p) => p.status === 'active').length }, // the phone's list (More → Projects)
  more: { title: 'More', icon: '…' }, // the phone's fifth tab: pinned, projects, goals, the other screens
  how: { title: 'How it works', icon: '?' }, // the personal OS explained (public/concept.js); More and Settings → About
  reflect: { title: 'Daily reflection', icon: '☾' },
  weekly: { title: 'Weekly review', icon: '↻', key: '8' },
  settings: { title: 'Settings', icon: '⚙', key: '9' },
};

function sections() {
  const T = S.data.tasks.filter(open);
  const today = S.data.today;
  const q = ''; // the header box is a global search now (see renderSearch), lists aren't filtered by it
  const f = (arr) => (q ? arr.filter((t) => `${t.title} ${t.body} ${t.labels.join(' ')} ${t.project || ''}`.toLowerCase().includes(q)) : arr).sort(byPri);
  switch (S.view) {
    case 'inbox': return [{ title: 'No project', tasks: f(T.filter((t) => !t.project)), add: {} }]; // the phone has no sidebar Add button
    case 'today': {
      const review = T.filter((t) => agentState(t) === 'review');
      // Handed-back work is listed once, on top — not again under its date.
      const rest = T.filter((t) => agentState(t) !== 'review');
      const out = [];
      if (review.length) out.push({ title: 'Agents handed back', hint: 'review & accept', tasks: f(review) });
      out.push({ title: 'Overdue', tasks: f(rest.filter((t) => t.due && t.due < today)), hideEmpty: true });
      // Capacity: the owner's own tasks beyond today's free time (calendar 9–19; estimates from the planner, else 50 min) go below the line.
      const todays = f(rest.filter((t) => t.due === today));
      const over = overCapacity(todays);
      out.push({ title: dateLabel(today)[0] + ' · ' + fromIso(today).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }), tasks: todays.filter((t) => !over.has(t.id)), add: { due: today } });
      if (over.size) out.push({ title: 'Probably not today', hint: `over your free time — Plan the day to move them`, tasks: todays.filter((t) => over.has(t.id)), link: '#/plan' });
      const dl = rest.filter((t) => t.deadline && t.deadline <= iso(new Date(fromIso(today).getTime() + 3 * 864e5)) && !(t.due && t.due <= today));
      if (dl.length) out.push({ title: 'Deadlines within 3 days', tasks: f(dl) });
      return out;
    }
    case 'upcoming': {
      const out = [{ title: 'Overdue', tasks: f(T.filter((t) => t.due && t.due < today)), hideEmpty: true }];
      for (let i = 0; i < 14; i++) {
        const d = iso(new Date(fromIso(today).getTime() + i * 864e5));
        const [lbl] = dateLabel(d);
        const tasks = f(T.filter((t) => t.due === d || (t.deadline === d && t.due !== d)));
        out.push({ title: `${fromIso(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · ${lbl}`, tasks, hideEmpty: i > 6, add: { due: d } });
      }
      out.push({ title: 'Later', tasks: f(T.filter((t) => t.due && dayDiff(t.due, today) >= 14)), hideEmpty: true });
      return out;
    }
    case 'agent': {
      const A = T.filter((t) => t.assigned === 'agent');
      const by = (s) => f(A.filter((t) => agentState(t) === s));
      return [
        { title: 'Needs your review', hint: 'agent finished — accept or send back', tasks: by('review'), empty: 'Nothing to review.' },
        { title: 'Running', tasks: by('running'), hideEmpty: true },
        { title: 'Blocked', hint: 'agent needs input from you', tasks: by('blocked'), hideEmpty: true },
        { title: 'Queue', hint: 'press R to run it', tasks: by('queued'), add: { assigned: 'agent' }, empty: 'Queue is empty. Delegate with @agent.' },
      ];
    }
    case 'waiting': return [{ title: 'Waiting on someone', tasks: f(T.filter((t) => t.status === 'wait' && t.assigned !== 'agent')) }];
    case 'someday': return [{ title: 'Someday / maybe', tasks: f(T.filter((t) => t.priority === 'someday')), add: { priority: 'someday' } }];
    case 'project': {
      const P = T.filter((t) => t.project === S.arg);
      return [
        { title: 'Next actions', tasks: f(P.filter((t) => t.status === 'new')), add: { project: S.arg } },
        { title: 'Waiting', tasks: f(P.filter((t) => t.status === 'wait')), hideEmpty: true },
        ...(S.showDone ? [{ title: 'Completed', tasks: (S.logbook || []).filter((t) => t.project === S.arg), done: true, empty: 'Nothing completed yet.' }] : []),
      ];
    }
    case 'logbook': {
      const L = (S.logbook || []).filter((t) => (!q || t.title.toLowerCase().includes(q))
        && (S.doneProject === undefined || S.doneProject === '*' || (S.doneProject === '' ? !t.project : t.project === S.doneProject)));
      const day = (t) => (t.completed ? iso(new Date(t.completed)) : iso(new Date(t.mtime)));
      const n = (t) => dayDiff(S.data.today, day(t));
      const groups = [['Today', (t) => n(t) === 0], ['Yesterday', (t) => n(t) === 1], ['Earlier this week', (t) => n(t) > 1 && n(t) < 7],
        ['Last 30 days', (t) => n(t) >= 7 && n(t) < 30], ['Older', (t) => n(t) >= 30]];
      return groups.map(([title, fn]) => ({ title, tasks: L.filter(fn), done: true, hideEmpty: true }));
    }
  }
  return [];
}

// ---------- render ----------
function render() {
  renderFocus();
  renderSide();
  renderTop();
  renderTabs();
  renderMain();
  renderDrawer();
}

// Menu: New · Tasks (filters) · Focus. On a wide screen it folds into an icon rail (body.rail; the toggle at the bottom,
// remembered per device); projects and goals live in the menus above the page (renderTop). The phone slides it in.
const SIDE_GROUPS = { tasks: ['inbox', 'today', 'upcoming', 'agent', 'waiting', 'someday', 'logbook'], focus: ['day', 'plan', 'week', 'decisions', 'reflect', 'weekly'] };
// the G-wheel: a wheel with the G cut out of it (palette colours: --tile-*), the same drawing as public/icons/icon.svg
const LOGO = '<svg class="logo" viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" fill="var(--tile-bg)"/><g transform="translate(50 50) scale(.84) translate(-50 -50)" stroke-linecap="round" stroke-linejoin="round"><circle cx="50" cy="50" r="31" fill="var(--tile-fg)"/><path d="M80 50L94 50M71.21 71.21L81.11 81.11M50 80L50 94M28.79 71.21L18.89 81.11M20 50L6 50M28.79 28.79L18.89 18.89M50 20L50 6M71.21 28.79L81.11 18.89" stroke="var(--tile-fg)" stroke-width="8"/><path d="M61.31 38.69A16 16 0 1 0 66 50H51" fill="none" stroke="var(--tile-bg)" stroke-width="8.5"/></g></svg>';
const railOn = () => { try { return localStorage.getItem('side') !== 'wide'; } catch { return true; } };
document.body.classList.toggle('rail', railOn());
function toggleRail() {
  const rail = !document.body.classList.contains('rail');
  try { localStorage.setItem('side', rail ? 'rail' : 'wide'); } catch { /* private mode */ }
  document.body.classList.toggle('rail', rail);
  renderSide(); renderTop();
}
function navLink(k) {
  const v = VIEWS[k];
  if (!v || v.hidden?.()) return '';
  const c = v.count?.(), hot = v.hot?.();
  return `<a class="nav ${S.view === k ? 'on' : ''}" href="#/${k}" title="${esc(v.title)}"><span class="ic">${TAB_ICONS[k](fromIso(S.data.today).getDate())}</span><span class="lbl">${v.title}</span>
    ${hot ? `<span class="n hot" title="needs attention">${hot} ●</span>` : c ? `<span class="n">${c}</span>` : ''}</a>`;
}
function renderSide() {
  syncWidgetCounts(); // the nav counts changed: the iPhone widgets too
  const focus = SIDE_GROUPS.focus.map(navLink).join('');
  $('#side').innerHTML = `
    <div class="brand">${LOGO}<span class="bname">${esc(APP_NAME)}</span><small>${esc(new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }))}</small></div>
    <button class="add-btn" data-act="quick" title="New (q)"><span class="ic">${TAB_ICONS.compose()}</span><span class="lbl">New</span></button>
    <h4>Tasks</h4>${SIDE_GROUPS.tasks.map(navLink).join('')}
    ${focus ? `<h4>Focus</h4><span class="side-sep"></span>${focus}` : ''}
    <div class="side-end">${navLink('settings')}<a class="nav" href="#" data-act="report" title="Report bug / idea"><span class="ic">${TAB_ICONS.report()}</span><span class="lbl">Report bug / idea</span></a></div>
    <div class="foot"><kbd>?</kbd> all shortcuts · <kbd>g</kbd> <kbd>t</kbd> Today · <kbd>g</kbd> <kbd>d</kbd> Protocol · <kbd>q</kbd> add · <kbd>e</kbd> done · <kbd>t</kbd> schedule · <kbd>/</kbd> search · <kbd>⌘K</kbd> commands</div>`;
}

// Projects and goals: two menus above the page (wide screens), their pinned ones as chips beside them; the phone has
// them under More. Pins are shared by all devices (settings.pins: "project:<slug>" | "goal:<slug>").
const pins = () => S.settings?.pins || [];
const openCount = (slug) => S.data.tasks.filter((t) => open(t) && t.project === slug).length;
const activeProjects = () => S.data.projects.filter((p) => p.status === 'active');
function pinItem(key) {
  const [kind, slug] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  if (kind === 'project') { const p = activeProjects().find((x) => x.slug === slug); return p && { key, href: `#/project/${p.slug}`, title: p.title, mark: `<span class="dot cat-${p.category || 'none'}"></span>`, n: openCount(p.slug) }; }
  const g = (S.data.goalDetails || []).find((x) => x.slug === slug);
  return g && { key, href: `#/goals/${g.slug}`, title: g.title, mark: `<span class="ic">${TAB_ICONS.goals()}</span>`, n: 0 };
}
const pinnedItems = () => pins().map(pinItem).filter(Boolean);
async function togglePin(key) {
  const cur = pins(), next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
  S.settings = { ...S.settings, pins: next };
  renderTop(); if (['more', 'projects', 'goals'].includes(S.view)) renderMain();
  try { S.settings = await api('PATCH', '/api/settings', { pins: next }); mirrorSettings(S.settings); } catch (e) { toast(e.message); }
}
const pinBtn = (key) => { const on = pins().includes(key); return `<button class="pin-btn ${on ? 'on' : ''}" data-act="pin" data-key="${esc(key)}" title="${on ? 'Unpin' : 'Pin to the top'}" aria-label="${on ? 'Unpin' : 'Pin'}">${TAB_ICONS.pin(on)}</button>`; };
function projRow(p, sub) {
  return `<div class="tm-row ${sub ? 'sub' : ''}" data-find="${esc(p.title.toLowerCase())}"><a class="tm-t" href="#/project/${p.slug}"><span class="dot cat-${p.category || 'none'}"></span><span class="tt">${esc(p.title)}</span></a><span class="n">${openCount(p.slug) || ''}</span>${pinBtn(`project:${p.slug}`)}</div>`;
}
function goalRow(g) {
  return `<div class="tm-row" data-find="${esc(g.title.toLowerCase())}"><a class="tm-t" href="#/goals/${g.slug}"><span class="ic">${TAB_ICONS.goals()}</span><span class="tt">${esc(g.title)}</span></a>${pinBtn(`goal:${g.slug}`)}</div>`;
}
function projectsListHtml() {
  const P = activeProjects(), pinned = pinnedItems().filter((x) => x.key.startsWith('project:'));
  const groups = [...cats(), null].map((c) => [c, P.filter((p) => (c ? p.category === c : !cats().includes(p.category)))]).filter(([, l]) => l.length);
  return `${pinned.length ? `<div class="tm-h">Pinned</div>${pinned.map((x) => projRow(P.find((p) => `project:${p.slug}` === x.key))).join('')}` : ''}
    ${groups.map(([c, l]) => `<div class="tm-h">${esc(c || 'Other')}</div>${l.filter((p) => !pins().includes(`project:${p.slug}`)).map((p) => projRow(p)).join('')}`).join('')}`;
}
function goalsListHtml() {
  const G = S.data.goalDetails || [], P = activeProjects();
  const pinned = G.filter((g) => pins().includes(`goal:${g.slug}`));
  return `${pinned.length ? `<div class="tm-h">Pinned</div>${pinned.map(goalRow).join('')}` : ''}
    <div class="tm-h">Goals</div>${G.filter((g) => !pinned.includes(g)).map((g) => goalRow(g) + P.filter((p) => p.goal === g.slug).map((p) => projRow(p, true)).join('')).join('') || '<div class="tm-empty">No goals yet.</div>'}`;
}
// Wide screens: the page's actions and the search live in the top bar's right half (renderMain fills #tb-tools); the phone
// keeps them in the page header.
const wideUI = () => matchMedia('(min-width: 801px)').matches;
matchMedia('(min-width: 801px)').addEventListener('change', () => render());
const SEARCH_HTML = '<svg class="search-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg><input class="search" id="search" type="search" autocomplete="off" placeholder="Search" aria-label="Search"><div class="search-res" id="search-res" hidden></div>';
function renderTop() {
  const el = $('#topbar');
  if (!el) return;
  if (!$('#tb-left')) el.innerHTML = '<div class="tb-left" id="tb-left"></div><div class="page-h tb-right"><div class="tools" id="tb-tools"></div><div class="search-wrap" id="tb-search"></div></div>';
  const search = $('#tb-search');
  if (wideUI() && !search.firstChild) { search.innerHTML = SEARCH_HTML; $('#search').value = S.q || ''; }
  if (!wideUI() && search.firstChild) { search.innerHTML = ''; $('#tb-tools').innerHTML = ''; }
  const m = S.topMenu, rail = document.body.classList.contains('rail');
  const chips = pinnedItems().map((x) => `<a class="tb-pin" href="${x.href}" title="${esc(x.title)}">${x.mark}<span class="tt">${esc(x.title)}</span>${x.n ? `<span class="n">${x.n}</span>` : ''}</a>`).join('');
  const menu = (k, label, icon) => `<button class="tb-menu ${m === k ? 'open' : ''}" data-act="top-menu" data-m="${k}" aria-expanded="${m === k}"><span class="ic">${TAB_ICONS[icon]()}</span>${label}<span class="ic chev">${TAB_ICONS.chev()}</span></button>`;
  const drop = !m ? '' : `<div class="tm-drop ${m}" role="menu"><input class="tm-find" id="tm-find" type="search" autocomplete="off" placeholder="Find a ${m === 'projects' ? 'project' : 'goal'}…" aria-label="Find">
    <div class="tm-list">${m === 'projects' ? projectsListHtml() : goalsListHtml()}</div>
    <div class="tm-foot">${m === 'projects' ? '<button data-act="project-new">+ New project</button>' : '<button data-act="goal-new">+ New goal</button><a href="#/goals">All goals</a>'}</div></div>`;
  $('#tb-left').innerHTML = `<button class="tb-side" data-act="side-rail" title="${rail ? 'Show the menu' : 'Fold the menu'}" aria-label="${rail ? 'Show the menu' : 'Fold the menu'}">${TAB_ICONS[rail ? 'expand' : 'collapse']()}</button>
    ${menu('projects', 'Projects', 'folder')}${menu('goals', 'Goals', 'goals')}${chips ? `<span class="tb-sep"></span><div class="tb-pins">${chips}</div>` : ''}${drop}`;
  if (m) { const b = $('#tb-left .tb-menu.open'), d = $('#tb-left .tm-drop'); if (b && d) d.style.left = `${b.offsetLeft}px`; $('#tm-find')?.focus({ preventScroll: true }); }
}
function closeTopMenu() { if (S.topMenu) { S.topMenu = null; renderTop(); } }
document.addEventListener('input', (e) => {
  if (e.target.id !== 'tm-find') return;
  const q = e.target.value.trim().toLowerCase();
  for (const r of document.querySelectorAll('.tm-drop .tm-row')) r.hidden = !!q && !r.dataset.find.includes(q);
  for (const h of document.querySelectorAll('.tm-drop .tm-h')) h.hidden = !!q;
});
document.addEventListener('pointerdown', (e) => { if (S.topMenu && !e.target.closest('#topbar')) closeTopMenu(); });

// The phone's More tab: pinned on top, then Projects and Goals, then the screens that have no tab.
function moreHtml() {
  const row = (href, ic, title, n, hot, act) => `<a class="more-row" href="${href}"${act ? ` data-act="${act}"` : ''}>${ic}<span class="tt">${esc(title)}</span>${n ? `<span class="n ${hot ? 'hot' : ''}">${n}</span>` : ''}<span class="more-chev">›</span></a>`;
  const view = (k) => { const v = VIEWS[k]; if (!v || v.hidden?.()) return ''; const hot = v.hot?.(); return row(`#/${k}`, `<span class="ic">${TAB_ICONS[k](fromIso(S.data.today).getDate())}</span>`, v.title, hot || v.count?.(), !!hot); };
  const P = pinnedItems(), group = (h) => (h.trim() ? `<div class="more-g">${h}</div>` : '');
  return `<div class="more">
    ${P.length ? `<div class="more-h">Pinned</div>${group(P.map((x) => row(x.href, x.mark, x.title, x.n)).join(''))}` : ''}
    ${group(row('#/projects', `<span class="ic">${TAB_ICONS.folder()}</span>`, 'Projects', activeProjects().length) + row('#/goals', `<span class="ic">${TAB_ICONS.goals()}</span>`, 'Goals', (S.data.goalDetails || []).length))}
    ${group(['upcoming', 'plan', 'week', 'decisions', 'reflect', 'weekly'].map(view).join(''))}
    ${group(['waiting', 'someday', 'logbook'].map(view).join(''))}
    ${group(row('#/how', `<span class="ic">${TAB_ICONS.how()}</span>`, 'How it works') + view('settings') + row('#', `<span class="ic">${TAB_ICONS.report()}</span>`, 'Report bug / idea', 0, false, 'report'))}
  </div>`;
}
// #/how: what a personal OS is and how Gubernos runs it — the drawings and words live in concept.js (also the site, README)
function conceptCss() { if (!$('#cpt-css')) document.head.insertAdjacentHTML('beforeend', `<style id="cpt-css">${CONCEPT_CSS}</style>`); }
function howHtml() {
  conceptCss();
  return `<div class="how"><p class="how-lede">${TEXT.lede}</p><button class="linkbtn" data-act="tour">Take the short tour</button>${conceptHtml({ h: 'h2' })}</div>`;
}
// The first-launch tour: four screens, once per device (skippable; again from Settings → About → How it works → Tour)
const TOUR = [
  ['Your life, as one model', 'The areas you are responsible for, your goals and promises, the projects that move them, and today at the centre. Every task links out to why it matters.', () => `<div class="tour-wheel">${wheelSvg()}</div>`],
  ['Win the day', 'Each morning, plan the day against your calendar and pick a #1. Habits frame the morning and the evening. At night, look back and choose tomorrow’s #1.', () => loopsHtml('Day')],
  ['Life loops', 'Days roll into the week: three wins and a weekly review. Weeks roll into the quarter: focus, goals, decisions. Everything you capture lands in the Inbox and feeds them.', () => captureHtml()],
  ['Yours, all the way down', 'Plain Markdown files in your own iCloud. AI agents like Claude and Codex work in the same files, with your accounts. There is no Gubernos account and no server of ours.', () => `<ul class="tour-own"><li><b>Your files</b> open in Files, Obsidian or any editor</li><li><b>Your agents</b> run on your Mac, on your plan</li><li><b>No servers of ours</b>, no tracking, nothing to lock you in</li></ul>`],
];
function tourFirstRun() {
  let seen = true;
  try { seen = !!localStorage.getItem('tourSeen'); } catch { /* private window: don't nag */ }
  if (!seen && !S.focus && !$('#modal').innerHTML) tourOpen(0);
}
function tourOpen(i) {
  conceptCss();
  try { localStorage.setItem('tourSeen', '1'); } catch { /* private window */ }
  let el = $('#tour');
  if (!el) { el = document.createElement('div'); el.id = 'tour'; el.className = 'tour'; document.body.append(el); }
  const [title, text, art] = TOUR[i], last = i === TOUR.length - 1;
  el.innerHTML = `<div class="tour-card cpt" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <button class="tour-skip linkbtn" data-tour="close">${last ? 'Close' : 'Skip'}</button>
    <div class="tour-art">${art()}</div>
    <div class="tour-t"><div class="tour-step">${i + 1} of ${TOUR.length}</div><h2>${esc(title)}</h2><p>${esc(text)}</p></div>
    <div class="tour-nav"><span class="tour-dots">${TOUR.map((_, j) => `<i class="${j === i ? 'on' : ''}"></i>`).join('')}</span>
      ${i ? `<button class="btn" data-tour="${i - 1}">Back</button>` : ''}<button class="btn primary" data-tour="${last ? 'how' : i + 1}">${last ? 'How it works' : 'Next'}</button></div></div>`;
  el.onclick = (e) => {
    const b = e.target.closest('[data-tour]');
    if (!b && e.target !== el) return;
    const v = b?.dataset.tour ?? 'close';
    if (v === 'close' || v === 'how') { el.remove(); if (v === 'how') location.hash = '#/how'; return; }
    tourOpen(+v);
  };
  el.querySelector('.btn.primary')?.focus({ preventScroll: true });
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#tour')) { e.stopImmediatePropagation(); $('#tour').remove(); } }, true);

// #/projects: every active project by area, pins and a new one (the phone reaches it from More)
function projectsPageHtml() {
  return `<div class="tm-page">${projectsListHtml()}<div class="tm-foot"><button data-act="project-new">+ New project</button></div></div>`;
}

// Phone: icons for the bottom tabs and the header menu button.
const TAB_ICONS = {
  today: (d) => `<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="16" rx="3"/><path d="M3.5 9h17M8 2.8v3.4M16 2.8v3.4"/><text x="12" y="17.6" text-anchor="middle">${d}</text></svg>`,
  inbox: () => '<svg viewBox="0 0 24 24"><path d="M3.5 13.5l2.6-7.2A2 2 0 0 1 8 5h8a2 2 0 0 1 1.9 1.3l2.6 7.2V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M3.5 13.5H8l1.5 2.5h5l1.5-2.5h4.5"/></svg>',
  agent: () => '<svg viewBox="0 0 24 24"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/></svg>',
  upcoming: () => '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="16" rx="3"/><path d="M3.5 9h17M8 2.8v3.4M16 2.8v3.4M7.5 13h2M11 13h2M14.5 13h2M7.5 16.5h2M11 16.5h2"/></svg>',
  more: () => '<svg viewBox="0 0 24 24"><path d="M4 6.5h16M4 12h16M4 17.5h16"/></svg>',
  waiting: () => '<svg viewBox="0 0 24 24"><path d="M6.5 3.5h11M6.5 20.5h11"/><path d="M7.5 3.5c0 4.5 4.5 5.5 4.5 8.5s-4.5 4-4.5 8.5M16.5 3.5c0 4.5-4.5 5.5-4.5 8.5s4.5 4 4.5 8.5"/></svg>',
  someday: () => '<svg viewBox="0 0 24 24"><path d="M7 18.5a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4.5 4.5 0 0 1-.5 9z"/></svg>',
  logbook: () => '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M8.2 12.3l2.5 2.5 5-5.3"/></svg>',
  review: () => '<svg viewBox="0 0 24 24"><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5"/><path d="M4.5 14v4a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-4"/></svg>',
  report: () => '<svg viewBox="0 0 24 24"><path d="M4.5 5.5h15v10h-8l-4.5 4v-4h-2.5z"/><path d="M12 8v3.5M12 13.6v.1"/></svg>',
  reflect: () => '<svg viewBox="0 0 24 24"><path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10z"/></svg>',
  weekly: () => '<svg viewBox="0 0 24 24"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/><path d="M9 12.5l2 2 4-4.5"/></svg>',
  week: () => '<svg viewBox="0 0 24 24"><path d="M8 4h8v4a4 4 0 0 1-8 0z"/><path d="M8 5.5H5a2.5 2.5 0 0 0 3 3.3M16 5.5h3a2.5 2.5 0 0 1-3 3.3M12 12v4M8.5 20h7M10 16h4v4h-4z"/></svg>',
  plan: () => '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="16" rx="3"/><path d="M3.5 9h17M8 2.8v3.4M16 2.8v3.4M7.5 13h5M7.5 16.5h8"/></svg>',
  day: () => '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>', // Protocol: a target (habits are targets)
  compose: () => '<svg viewBox="0 0 24 24"><path d="M11.5 4.5H7A2.5 2.5 0 0 0 4.5 7v10A2.5 2.5 0 0 0 7 19.5h10a2.5 2.5 0 0 0 2.5-2.5v-4.5"/><path d="M17.6 3.9l2.5 2.5-7.6 7.6-3.3.8.8-3.3z"/></svg>',
  expand: () => '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2.5"/><path d="M9.5 5v14M13 10l2 2-2 2"/></svg>',
  collapse: () => '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2.5"/><path d="M9.5 5v14M15 10l-2 2 2 2"/></svg>',
  moretab: () => '<svg viewBox="0 0 24 24"><circle cx="5.5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor"/></svg>',
  folder: () => '<svg viewBox="0 0 24 24"><path d="M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2h7.2a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>',
  pin: (on) => `<svg viewBox="0 0 24 24"><path d="M9 3.5h6M10 3.5v5.5l-3 3.5h10l-3-3.5V3.5z"${on ? ' fill="currentColor"' : ''}/><path d="M12 12.5V20"/></svg>`,
  chev: () => '<svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5"/></svg>',
  decisions: () => '<svg viewBox="0 0 24 24"><path d="M12 4v16M7 20h10M5 7h14"/><path d="M5 7l-2.5 6a2.5 2.5 0 0 0 5 0zM19 7l-2.5 6a2.5 2.5 0 0 0 5 0z"/></svg>',
  goals: () => '<svg viewBox="0 0 24 24"><path d="M5 21V4"/><path d="M5 4.5h11.5l-2.2 3.7 2.2 3.8H5"/></svg>',
  how: () => '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.6"/><path d="M12 2.5v3.5M12 18v3.5M2.5 12H6M18 12h3.5M5.3 5.3l2.5 2.5M16.2 16.2l2.5 2.5M5.3 18.7l2.5-2.5M16.2 7.8l2.5-2.5"/></svg>',
  settings: () => '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/><circle cx="12" cy="12" r="6.2"/></svg>',
};

// Phone: top-right icon in the page header that slides the sidebar in (hidden on desktop).
const MENU_BTN = `<button class="icon-btn menu-btn" data-act="side-open" aria-label="Menu" title="Menu">${TAB_ICONS.more()}</button>`;

// Page-header actions as icons (title = tooltip / aria-label). Inline here: ICON is defined further down.
const HD_ICON = {
  plan: '<rect x="3.5" y="4.5" width="17" height="16" rx="3"/><path d="M3.5 9h17M8 2.8v3.4M16 2.8v3.4"/><path d="M8.5 14.5l2.3 2.3 4.7-4.8"/>',
  day: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  wins: '<path d="M8 4h8v4a4 4 0 0 1-8 0z"/><path d="M8 5.5H5a2.5 2.5 0 0 0 3 3.3M16 5.5h3a2.5 2.5 0 0 1-3 3.3M12 12v4M8.5 20h7M10 16h4v4h-4z"/>',
  focus: '<circle cx="12" cy="12" r="8.5"/><path d="M10.2 8.7l5 3.3-5 3.3z"/>', // start Focus (a target is the Protocol's icon)
  process: '<path d="M3.5 13.5l2.6-7.2A2 2 0 0 1 8 5h8a2 2 0 0 1 1.9 1.3l2.6 7.2V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M3.5 13.5H8l1.5 2.5h5l1.5-2.5h4.5"/><path d="M9.3 9.6l1.9 1.9 3.6-3.7"/>',
  edit: '<path d="M4.5 19.5l1-4L15.8 5.2a2 2 0 0 1 2.9 0l.1.1a2 2 0 0 1 0 2.9L8.5 18.5z"/><path d="M13.8 7.2l3 3"/>',
  complete: '<circle cx="12" cy="12" r="8.5"/><path d="M8.2 12.3l2.5 2.5 5-5.3"/>',
  vfocus: '<path d="M4 8.5V6a2 2 0 0 1 2-2h2.5M15.5 4H18a2 2 0 0 1 2 2v2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5M8.5 20H6a2 2 0 0 1-2-2v-2.5"/><path d="M8.5 12h7"/>', // the Focus view: one thing in the frame
  group: '<rect x="4" y="4.5" width="16" height="5" rx="1.5"/><rect x="4" y="14.5" width="16" height="5" rx="1.5"/><path d="M7 12h10" opacity=".5"/>',
};
// Header icon that navigates, with a small badge (e.g. "6h", "1/3").
const hdLink = (href, icon, label, badge = '', cls = '') => `<a class="icon-btn hd-act ${cls}" href="${href}" title="${label}" aria-label="${label}"><svg viewBox="0 0 24 24" aria-hidden="true">${HD_ICON[icon]}</svg>${badge ? `<span class="hd-badge">${badge}</span>` : ''}</a>`;
const hdBtn = (act, icon, label, attrs = '', cls = '') => `<button class="icon-btn hd-act ${cls}" data-act="${act}" ${attrs} title="${label}" aria-label="${label}"><svg viewBox="0 0 24 24" aria-hidden="true">${HD_ICON[icon]}</svg></button>`;

// Phone: bottom tabs for the main views.
function renderTabs() {
  const day = fromIso(S.data.today).getDate();
  const tab = (k) => {
    const v = VIEWS[k];
    const hot = v.hot?.();
    const c = hot || v.count?.();
    return `<a class="tab ${S.view === k ? 'on' : ''}" href="#/${k}"><span class="ic">${TAB_ICONS[k](day)}</span>${v.title}
      ${c ? `<span class="badge ${hot ? 'hot' : ''}">${c > 99 ? '99+' : c}</span>` : ''}</a>`;
  };
  const TABS = ['today', 'day', 'inbox', 'agent'];
  // More: everything without a tab (Upcoming, Plan the day, projects, goals…); it stays lit on those screens
  const more = `<a class="tab ${TABS.includes(S.view) ? '' : 'on'}" href="#/more"><span class="ic">${TAB_ICONS.moretab()}</span>More</a>`;
  $('#tabs').innerHTML = TABS.map(tab).join('') + more; // Protocol next to Today
}
// Phone: the tab bar fades while scrolling down and comes back on scroll up / near the top.
let lastMainY = 0;
$('#main').addEventListener('scroll', (e) => {
  const y = e.target.scrollTop;
  if (Math.abs(y - lastMainY) < 6) return;
  document.body.classList.toggle('tabs-dim', y > lastMainY && y > 40);
  lastMainY = y;
}, { passive: true });

function rowHtml(t, i, done) {
  const pend = pendingDone.get(t.id);
  const meta = [];
  if (done && t.completed) meta.push(`<span>${t.dropped ? '⊘' : '✓'} ${dateLabel(iso(new Date(t.completed)))[0]}</span>`);
  if (done && t.dropped) meta.push('<span class="pill">dropped</span>');
  if (t.due) { const [l, c] = dateLabel(t.due); meta.push(`<span class="${done ? '' : c}">◷ ${l}${t.recurrence ? ' ↻' : ''}</span>`); }
  if (t.deadline) { const [l, c] = dateLabel(t.deadline); meta.push(`<span class="${done ? '' : c}" title="deadline">⚑ ${l}</span>`); }
  const open = S.expanded.has(t.id);
  const live = !done && todayBlock(t.id, S.planFree); // today's block at its time in the calendar
  const nextTb = !done && (t.timeblocks || []).filter((b) => b.start.slice(0, 10) !== S.data.today).concat(live ? [live] : []).filter((b) => b.end >= nowLocal()).sort((a, b) => a.start.localeCompare(b.start))[0];
  if (nextTb) meta.push(`<span class="tb-chip" title="${nextTb.deep ? 'Deep work for #1' : 'Time block in your calendar'}">${nextTb.deep ? '◆' : '⏱'} ${tbLabel(nextTb)}</span>`);
  else if (!done && S.view === 'today' && notPlanned(t)) meta.push('<span class="np-chip" title="No time for it in today’s calendar — Plan the day">not planned</span>');
  if (t.checks.total) meta.push(`<button class="subcount" data-act="sub-expand" data-id="${t.id}" title="${open ? 'Hide' : 'Show'} subtasks">☑ ${t.checks.done}/${t.checks.total}</button>`);
  const as = done ? null : agentState(t);
  if (as) meta.push(`<span class="pill ${as === 'queued' ? 'agent' : as}">${as === 'queued' ? `✦ ${agentName(t.agent)}` : as === 'review' ? '✦ review' : as === 'running' ? 'running' : '✦ blocked'}</span>`);
  if (t.assigned === 'someone') meta.push('<span class="pill">delegated</span>');
  if (t.status === 'wait' && t.assigned !== 'agent') meta.push('<span class="pill">waiting</span>');
  for (const l of t.labels.slice(0, 4)) meta.push(`<span>@${esc(l)}</span>`);
  if (t.project && S.view !== 'project' && groupMode() !== 'project') { const p = proj(t.project); meta.push(`<span class="proj"># ${esc(p?.title || t.project)}</span>`); }
  if (!done && t.project) { const g = goalChain(t.project)[0]; if (g && g.title !== proj(t.project)?.title) meta.push(`<span class="goal-chain" title="what it leads to">→ ${esc(g.title)}</span>`); }
  if (!done && t.woop?.plan) meta.push(`<span class="woop-chip" title="${esc(t.woop.plan)}">↯ ${esc(woopShort(t.woop.plan))}</span>`);
  else if (!done && t.moved >= 3) meta.push(`<button class="woop-nudge" data-act="woop-open" data-id="${t.id}" title="Its due date was pushed later ${t.moved} times. Name what gets in the way and plan for it">moved ${t.moved}× · WOOP it?</button>`);
  const desc = t.body.replace(WOOP_SECTION, '').replace(/<!--[\s\S]*?-->/g, '').split('\n').find((l) => l.trim() && !/^#|^\s*[-*] \[|^- ⏱ /.test(l)) || '';
  const caret = t.subtasks.length
    ? `<button class="caret ${open ? 'on' : ''}" data-act="sub-expand" data-id="${t.id}" aria-label="Toggle subtasks">›</button>`
    : '<span class="caret"></span>';
  const subs = open ? `<div class="subs">${t.subtasks.map((s) => `<div class="subrow ${s.done ? 'done' : ''}" data-id="${t.id}">
      <button class="check sm ${s.done ? 'done' : ''}" data-act="sub-toggle" data-id="${t.id}" data-ck="${s.i}" ${done ? 'disabled' : ''}></button>
      <span class="subtext">${inline(s.text)}</span></div>`).join('')}</div>` : '';
  const undo = pend ? `<button class="undo" data-act="undo" data-id="${t.id}">Undo <span class="cd">${Math.max(0, Math.ceil((pend.until - Date.now()) / 1000))}</span></button>`
    : done ? `<button class="undo reopen" data-act="reopen" title="Back to active">↺ Reopen</button>` : '';
  return `<div class="row ${S.sel === i ? 'sel' : ''} ${S.openId === t.id ? 'open' : ''} ${done || pend ? 'is-done' : ''} ${t.dropped || pend?.drop ? 'is-dropped' : ''}" data-id="${t.id}" data-i="${i}">
    ${caret}<button class="check p-${t.priority} ${done || pend ? 'done' : ''}" data-act="${done ? 'reopen' : 'complete'}" title="${done ? 'Reopen' : pend ? 'Undo' : 'Complete'}"></button>
    <div class="row-main"><div class="row-title">${inline(t.title)}</div>
    ${desc ? `<div class="row-desc">${esc(desc.replace(/[*`>]|\[\[|\]\]/g, '').slice(0, 140))}</div>` : ''}
    ${meta.length ? `<div class="meta">${meta.join('')}</div>` : ''}</div>${undo}</div>${subs}`;
}

// Expanded rows persist per browser (the list is re-rendered on every vault change).
function loadExpanded() { try { return new Set(JSON.parse(localStorage.getItem('expanded') || '[]')); } catch { return new Set(); } }
function toggleExpanded(id, force) {
  const on = force ?? !S.expanded.has(id);
  if (on) S.expanded.add(id); else S.expanded.delete(id);
  try { localStorage.setItem('expanded', JSON.stringify([...S.expanded])); } catch { /* private mode */ }
  renderMain();
}

let flat = [];
// ---------- group by (per view, remembered in this browser) ----------
const GROUPS = { default: 'Default', project: 'Project', priority: 'Priority', owner: 'Owner', category: 'Category' };
const groupModes = () => (['inbox', 'project'].includes(S.view) ? ['default', 'priority', 'owner'] : ['logbook', 'weekly', 'reflect', 'settings', 'goals', 'decisions', 'week', 'plan', 'day', 'more', 'projects', 'how'].includes(S.view) ? [] : ['default', 'project', 'category', 'priority', 'owner']);
function groupMode() {
  let m = 'default';
  try { m = localStorage.getItem(`group:${S.view}`) || 'default'; } catch { /* private mode */ }
  return groupModes().includes(m) ? m : 'default';
}
// Same tasks as the view's own sections, regrouped. Completed sections (project "Show completed") stay as they are.
function regroup(secs) {
  const mode = groupMode();
  if (mode === 'default') return secs;
  const seen = new Set(), tasks = [];
  for (const sec of secs) if (!sec.done) for (const t of sec.tasks) if (!seen.has(t.id)) { seen.add(t.id); tasks.push(t); }
  const byDue = (a, b) => (a.due || '9').localeCompare(b.due || '9') || byPri(a, b);
  const keep = secs.filter((x) => x.done);
  if (mode === 'owner') {
    return [...[['me', 'Me'], ['agent', '✦ Agent'], ['someone', 'Waiting on someone']]
      .map(([k, title]) => ({ title, tasks: tasks.filter((t) => (t.assigned || 'me') === k).sort(byDue), hideEmpty: true })), ...keep];
  }
  if (mode === 'category') {
    const cat = (t) => proj(t.project)?.category || '';
    return [...[...cats(), ''].map((c) => ({ title: c ? c[0].toUpperCase() + c.slice(1) : 'No project', dot: c || null,
      tasks: tasks.filter((t) => cat(t) === c).sort(byDue), hideEmpty: true })), ...keep];
  }
  if (mode === 'priority') {
    return [...[['urgent', 'P1 · Urgent'], ['planned', 'P2 · Planned'], ['someday', 'P4 · Someday']]
      .map(([k, title]) => ({ title, tasks: tasks.filter((t) => t.priority === k).sort(byDue), hideEmpty: true })), ...keep];
  }
  const groups = new Map();
  for (const t of tasks) { const k = t.project || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
  const order = [...groups.keys()].sort((a, b) => (!a) - (!b) || cats().indexOf(proj(a)?.category) - cats().indexOf(proj(b)?.category)
    || (proj(a)?.title || a).localeCompare(proj(b)?.title || b));
  return [...order.map((k) => ({ title: k ? proj(k)?.title || k : 'No project', dot: k ? proj(k)?.category || 'none' : null, link: k && isProject(k) ? `#/project/${k}` : null,
    tasks: groups.get(k).sort(byDue) })), ...keep];
}
function groupBar() {
  const modes = groupModes();
  if (!modes.length || !S.groupOpen) return '';
  const cur = groupMode();
  return `<div class="group-bar"><span class="lbl">Group by</span>${modes.map((m) => `<button class="chip ${m === cur ? 'on' : ''}" data-act="group-set" data-g="${m}">${GROUPS[m]}</button>`).join('')}</div>`;
}

function renderMain() {
  if (wideUI() && $('#tb-tools')) $('#tb-tools').innerHTML = '';
  if (S.view === 'settings') { flat = []; $('#main').innerHTML = settingsHtml(); return; }
  if (S.view === 'today' && simpleOn()) return paintMain(simpleTodayHtml());
  const secs = regroup(sections());
  flat = [];
  let head;
  if (S.view === 'project') {
    const p = proj(S.arg);
    head = `<h1>${esc(p?.title || S.arg)}</h1><span class="sub"><span class="dot cat-${p?.category || 'none'}"></span> ${esc(p?.category || '')}${p?.goal ? ` · goal: ${esc((S.data.goals || []).find((g) => g.slug === p.goal)?.title || p.goal)}` : ''}${p?.due ? ` · due ${dateLabel(p.due)[0]}` : ''}
      ${ME().obsidian ? ` · <a href="${obsidianPath(p?.file)}">open in Obsidian</a>` : ''}</span>
      ${p?.outcome ? `<div class="proj-outcome"><span>Outcome</span>${inline(p.outcome.replace(/\s*\n+\s*/g, ' '))}</div>` : ''}`;
  } else {
    head = `<h1>${VIEWS[S.view].title}</h1>`;
  }
  // phone: screens without a tab get a way back (Plan the day hides the tab bar for its Apply bar)
  if (!['today', 'day', 'inbox', 'agent', 'more'].includes(S.view)) head = `<button class="back-link" data-act="back">‹ Back</button>${head}`;
  // AICODE-NOTE: header = title · view actions · search · menu, all flat siblings of .page-h so the phone layout can
  // put title+actions+menu on one row and give search its own full-width row (see .page-h in app.css).
  const acts = [
    S.view === 'today' ? '' : pomoLiveHtml(),
    S.view === 'project' ? hdBtn('project-edit', 'edit', 'Edit project', `data-slug="${esc(S.arg)}"`) + hdBtn('project-done', 'complete', 'Complete project', `data-slug="${esc(S.arg)}"`) : '',
    S.view === 'logbook' ? `<select id="done-proj" class="search done-proj"><option value="*">All projects</option><option value="" ${S.doneProject === '' ? 'selected' : ''}>No project</option>${S.data.projects.map((p) => `<option value="${p.slug}" ${S.doneProject === p.slug ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}</select>` : '',
    S.view === 'today' && S.pomoStats?.today ? `<span class="pomo-pill" title="Sprints today · ${S.pomoStats.week} this week">⚡ ${S.pomoStats.today}</span>` : '',
    S.view === 'today' ? (refreshPlanInfo(), planLink()) : '',
    S.view === 'today' && S.data.focus ? winsLink() : '',
    S.view === 'today' ? pomoLiveHtml(true) || hdBtn('focus-start', 'focus', 'Focus on the most important task (f)', '', 'accent') : '',
    S.view === 'today' ? simpleBtn() : '',
    S.view === 'inbox' && modeQueue('inbox').length ? hdBtn('mode-inbox', 'process', 'Process inbox one by one', '', 'accent') : '',
    groupModes().length ? hdBtn('group-toggle', 'group', `Group by… (now: ${GROUPS[groupMode()]})`, '', groupMode() !== 'default' || S.groupOpen ? 'on' : '') : '',
  ].join('');
  const wide = wideUI();
  if (wide) $('#tb-tools').innerHTML = acts;
  let html = `<div class="page${S.view === 'today' ? ' has-cal' : ''}"><div class="page-h">${head}${wide ? '' : `<div class="tools">${acts}</div>
    <div class="search-wrap"><svg class="search-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg><input class="search" id="search" type="search" autocomplete="off" placeholder="Search" aria-label="Search" value="${esc(S.q)}"><div class="search-res" id="search-res" hidden></div></div>`}</div>`;
  html += groupBar();
  if (S.view === 'today') html += `<div class="seg today-mode">${[['list', 'List'], ['day', 'Day']].map(([k, l]) => `<button data-act="today-mode" data-val="${k}" class="${(S.todayMode || 'list') === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="today-split ${S.todayMode === 'day' ? 'mode-day' : ''}"><div class="today-list">`;
  if (S.view === 'goals') {
    html += goalsHtml(); html += '</div>'; paintMain(html);
    // #/goals/<slug> (from the menu): bring that goal's card into view once
    if (S.arg && S.goalScrolled !== S.arg) { S.goalScrolled = S.arg; const el = $(`#goal-${CSS.escape(S.arg)}`); if (el) { el.scrollIntoView({ block: 'start' }); el.closest('.goal-card')?.classList.add('hl'); } }
    return;
  }
  if (S.view === 'more') { html += moreHtml(); html += '</div>'; return paintMain(html); }
  if (S.view === 'how') { html += howHtml(); html += '</div>'; return paintMain(html); }
  if (S.view === 'projects') { html += projectsPageHtml(); html += '</div>'; return paintMain(html); }
  if (S.view === 'decisions') { html += decisionsHtml(); html += '</div>'; return paintMain(html); }
  if (S.view === 'week') { html += weekHtml(); html += '</div>'; return paintMain(html); }
  if (S.view === 'weekly') { html += weeklyHtml(); html += '</div>'; return paintMain(html); }
  if (S.view === 'reflect') { html += reflectHtml(); html += '</div>'; return paintMain(html); }
  if (S.view === 'day') { html += dayHtml(); html += '</div>'; return paintMain(html); }
  if (S.view === 'plan') { html += planHtml(); html += '</div>'; return paintMain(html); }
  if (S.view === 'today') html += todayOneHtml() + todayProtoHtml();
  if (S.view === 'inbox') html += capturesHtml();
  if (S.view === 'upcoming') html += `<div class="upcoming-cu">${comingUpHtml()}</div>`;
  if (S.view === 'agent' && VIEWS.agent.hot()) html += `<button class="btn focus-btn" data-act="mode-review" style="margin-top:6px">✦ Review ${VIEWS.agent.hot()} one by one</button>`;
  if (S.view === 'agent') html += `<div class="empty" style="padding-top:0">Delegate with <b>@agent</b> in quick add. Agents work the task file as a brief, log into <i>## Agent log</i>, then hand it back here for review. Any agent can join the same loop over the HTTP API (see README).</div>`;
  for (const s of secs) {
    if (s.hideEmpty && !s.tasks.length) continue;
    const title = `${s.dot ? `<span class="dot cat-${s.dot}"></span> ` : ''}${s.link ? `<a class="sec-link" href="${s.link}">${esc(s.title)}</a>` : esc(s.title)}`;
    html += `<div class="section"><div class="section-h">${title} <span class="c">${s.tasks.length || ''}</span>${s.hint ? `<span class="hint">${esc(s.hint)}</span>` : ''}</div>`;
    html += s.tasks.map((t) => { flat.push(t); return rowHtml(t, flat.length - 1, s.done || t.status === 'done'); }).join('');
    if (!s.tasks.length && !s.add) html += `<div class="empty">${esc(s.empty || 'Nothing here.')}</div>`;
    if (s.add) html += `<div class="add-row" data-act="quick" data-defaults='${esc(JSON.stringify(s.add))}'><span class="plus">+</span>Add task</div>`;
    html += '</div>';
  }
  if (S.view === 'project') html += `<button class="linkbtn show-done" data-act="toggle-done">${S.showDone ? 'Hide completed' : 'Show completed'}</button>`;
  if (S.view === 'today') html += `</div><aside class="today-cal">${dayCalHtml()}</aside></div>`;
  html += '</div>';
  paintMain(html);
}
function paintMain(html) {
  const main = $('#main');
  const scroll = main.scrollTop;
  const hadFocus = document.activeElement?.id === 'search';
  main.innerHTML = html;
  main.scrollTop = scroll;
  if (hadFocus) { const s = $('#search'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
  if (S.q) renderSearch(); // keep open results across re-renders (e.g. after a voice search, data reloads)
  main.querySelectorAll('textarea.rv-auto').forEach(autosize);
}

// The note's text without the sentence that already is its title.
function capPreview(it) {
  const flat = it.body.replace(/\s+/g, ' ').trim(), head = it.title.replace(/[.…]$/, '');
  return (flat.startsWith(head) ? flat.slice(head.length).replace(/^[.!?…]?\s*/, '') : flat).slice(0, 220);
}
// The triage agent's read of a capture (lib/triage.js): what it is, what to do, and for a task the proposal.
function triageHtml(it) {
  const t = it.triage;
  if (!t) return (it.source === 'watch' || !it.suggestion) && it.date === S.data.today ? '<div class="cap-tri muted">✦ the agent is looking at it…</div>' : '';
  const pj = t.project ? (S.data.projects.find((p) => p.slug === t.project)?.title || t.project) : null;
  const bits = t.kind === 'task' ? [t.title !== it.title ? `“${esc(t.title)}”` : '', pj ? esc(pj) : '', t.due ? esc(dateLabel(t.due)[0]) : '', t.reminder ? `⏰ ${esc(t.reminder.slice(11))}` : '',
    t.priority === 'urgent' ? 'urgent' : t.priority === 'someday' ? 'someday' : '', t.assigned === 'agent' ? `@${esc(t.agent || 'agent')}` : ''].filter(Boolean) : [];
  return `<div class="cap-tri"><span class="cap-tri-k">✦ ${esc(t.what || t.kind)}</span>${t.do ? ` → ${esc(t.do)}` : ''}${bits.length ? `<div class="cap-tri-p">${bits.join(' · ')}</div>` : ''}</div>`;
}
function capturesHtml() {
  if (!S.data.inbox.length) return '';
  return `<div class="section"><div class="section-h">Notes <span class="c">${S.data.inbox.length}</span><span class="hint">decide what each one is</span></div>
    ${S.data.inbox.map((it) => `<div class="cap" data-item="${it.id}">
      <div class="cap-h" data-act="cap-toggle"><span class="pill">${esc(!it.source || it.source === 'manual' ? 'note' : it.source)}</span><span class="t">${esc(it.title)}</span>${it.url ? `<a class="cap-url" href="${esc(it.url)}" target="_blank" rel="noopener" title="${esc(it.url)}">↗</a>` : ''}
        ${it.suggestion ? `<span class="pill ${it.suggestion === 'task' ? 'agent' : ''}">→ ${esc(it.suggestion)}</span>` : ''}<span class="meta" style="margin:0">${esc(it.sender || '')} ${it.date ? dateLabel(it.date)[0] : ''}</span></div>
      ${capPreview(it) ? `<div class="cap-prev" data-act="cap-toggle">${esc(capPreview(it))}</div>` : ''}
      ${triageHtml(it)}
      <div class="cap-b md" hidden>${md(it.body, false)}</div>
      <div class="cap-actions">${it.triage?.kind === 'trash' ? '<button class="btn primary" data-act="cap-trash" title="The agent thinks it’s noise — kept in the archive as trash">Delete</button>' : ''}${it.triage?.kind === 'task' ? '<button class="btn primary" data-act="cap-apply" title="Create the task the agent proposes and archive the note">✦ Make it a task</button><button class="btn" data-act="cap-task" title="Edit the proposal first">Task…</button>' : `<button class="btn ${it.triage?.kind === 'trash' ? '' : 'primary'}" data-act="cap-task">Task</button>`}<button class="btn" data-act="cap-project">Project</button><button class="btn" data-act="cap-goal">Goal</button>
        <button class="btn agentish" data-act="cap-agent">✦ Agent</button><button class="btn" data-act="cap-ask" title="Discuss with the agent">Ask</button>
        <button class="btn ghost" data-act="cap-done">Archive</button>${it.triage?.kind === 'trash' ? '' : '<button class="btn ghost" data-act="cap-trash" title="Remove it (kept in the archive as trash)">Delete</button>'}</div>
    </div>`).join('')}</div>`;
}

// ---------- plan day: what fits today (calendar 9–19 minus meetings and lunch), what goes to agents, what moves ----------
// The agent estimates minutes and marks what truly has to happen today; the screen fills the free time with those first, then
// with the next most important, and proposes a date for the rest. Nothing is written until Apply.
S.plan = null; // { draft, pick: {id: 'do'|'move'}, moveTo: {id}, run: {id}, loading, evening }
const planMins = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);
// The time a task takes: your own (the task's `estimate`, minutes) wins over the agent's (✦, Plan the day's estimate).
// Chips or a number set yours; ✦ goes back to the agent's.
const EST_OPTS = [15, 30, 45, 60, 90, 120, 180];
function estPickerHtml(id, own, agent) {
  const b = (m, label, on, title = '') => `<button class="chip ${on ? 'on' : ''}" data-act="est-set" data-id="${esc(id)}" data-min="${m}"${title ? ` title="${title}"` : ''}>${label}</button>`;
  return `<div class="chips est-pick">${EST_OPTS.map((m) => b(m, planMins(m), own === m)).join('')}
    <input class="est-in" type="number" min="5" max="600" step="5" inputmode="numeric" placeholder="min" data-est="${esc(id)}" value="${own && !EST_OPTS.includes(own) ? own : ''}" aria-label="Minutes">
    ${agent ? b('', `✦ ${planMins(agent)}`, !own, 'The agent’s estimate') : own ? b('', '✕', false, 'Clear your time') : ''}</div>`;
}
async function setEstimate(id, min) {
  const m = Math.round(Number(min)) || null;
  try { await patch(id, { estimate: m }); } catch { return; }
  const e = S.plan?.draft?.tasks.find((x) => x.id === id);
  if (e) { e.minutes = m || e.agentMinutes || 50; e.own = !!m; }
  if (S.plan) S.plan.estOpen = null;
  const P = S.plan, w = P?.blk?.work;
  if (e && w && !w.exists && P.one?.link === id) { // #1's time → its deep work block: the same start if you set it, else proposed again
    if (w.hand) w.end = hhmm(Math.min(24 * 60 - 5, mins(w.start) + e.minutes));
    else { const n = proposeWork(P.draft, P.one); if (n) P.blk.work = { ...n, on: w.on }; }
  }
  if (m && S.planEst) S.planEst[id] = m; else refreshPlanInfo(true); // cleared: the agent's comes back with the estimates
  renderMain();
  if (S.openId === id) renderDrawer(true);
}
const MOVES = [['tomorrow', 'Tomorrow'], ['weekend', 'Weekend'], ['next_week', 'Next week'], ['someday', 'Someday']];
function moveDate(k) {
  const d = fromIso(S.data.today), dow = d.getDay();
  const n = k === 'tomorrow' ? 1 : k === 'weekend' ? (dow === 6 ? 1 : (6 - dow + 7) % 7 || 7) : k === 'next_week' ? ((8 - dow) % 7) || 7 : 0;
  if (!n) return null;
  d.setDate(d.getDate() + n); return iso(d);
}
function planLink() {
  const f = S.planFree;
  return hdLink('#/plan', 'plan', `Plan the day${f ? ` — ${planMins(f.freeMinutes)} free` : ''}`, f && !f.calendarError && Number.isFinite(f.freeMinutes) ? `${Math.round(f.freeMinutes / 60)}h` : '');
}
async function loadPlan(refresh = false) {
  S.plan = { ...(S.plan || {}), loading: true, error: null };
  renderMain();
  try {
    const d = await api('POST', '/api/plan/draft', { refresh });
    const order = { urgent: 0, planned: 1, someday: 2 };
    const pr = (id) => order[taskById(id)?.priority] ?? 3;
    // re-planning a plan set today: its open tasks stay picked (first); then must-do, then the rest by priority; fill ~85%
    // of the free time, move what doesn't fit
    const kept = new Set(d.plan?.setAt ? d.plan.tasks.filter((x) => !x.done).map((x) => x.id) : []);
    const list = [...d.tasks].sort((a, b) => (kept.has(b.id) - kept.has(a.id)) || (b.must - a.must) || pr(a.id) - pr(b.id));
    const pick = {}, moveTo = {}, run = {};
    let used = 0;
    const cap = d.capacity ?? d.free.freeMinutes * 0.85; // your real pace (plan vs actual), at most 85% of the free time
    for (const t of list) {
      const fits = used + t.minutes <= cap;
      pick[t.id] = kept.has(t.id) || t.must || fits ? 'do' : 'move';
      if (pick[t.id] === 'do') used += t.minutes;
      moveTo[t.id] = t.moveTo || 'tomorrow';
    }
    for (const a of d.agents) run[a.id] = a.state === 'queued' && !isAssistant(a.agent);
    const one = d.plan?.one ? { ...d.plan.one } : winOne(); // today's #1: set already (often last night, on Daily reflection), else WIN #1
    if (one?.link && pick[one.link]) { if (pick[one.link] !== 'do') used += d.tasks.find((x) => x.id === one.link).minutes; pick[one.link] = 'do'; } // #1 is never moved off today
    S.plan = { draft: d, order: list.map((t) => t.id), pick, moveTo, run, loading: false, evening: S.plan?.evening, one, oneFrom: d.plan?.one ? 'set' : one ? 'win' : null, blk: proposeBlocks(d, one) };
    // re-planning: tasks with a block ahead today first, in their calendar order; the rest after them as proposed
    const at = planBlocks(S.plan), key = (id) => at[id]?.start || '~';
    for (const id of Object.keys(at)) if (pick[id]) pick[id] = 'do'; // already in today's calendar: still on the plan unless you move it
    S.plan.order.sort((x, y) => (key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : 0));
    S.planFree = d.free; S.planEst = Object.fromEntries(d.tasks.map((t) => [t.id, t.minutes])); S.planInfoAt = Date.now();
  } catch (e) { S.plan = { ...(S.plan || {}), loading: false, error: e.message }; }
  renderMain();
}
// Which of today's own tasks don't fit the free time left (tasks with a time block today count as planned).
function overCapacity(tasks) {
  const f = S.planFree, over = new Set();
  if (!f || f.calendarError) return over;
  let left = f.freeMinutes;
  for (const t of tasks) {
    if (t.assigned === 'agent' || hasBlockToday(t.id)) continue;
    left -= S.planEst?.[t.id] || 50;
    if (left < 0) over.add(t.id);
  }
  return over;
}
// Plan the day → Lunch: at = "HH:MM" (moved today), "" (skipped today) or null (back to Settings); the day's free time is read again
async function setLunchToday(at) {
  const P = S.plan;
  await api('PATCH', '/api/settings', { lunchDay: at === null ? null : { date: S.data.today, at } });
  if (P) P.lunchEdit = false;
  try { const free = await api('GET', '/api/plan/free'); if (P?.draft) P.draft.free = free; S.planFree = free; } catch { /* offline */ }
  S.planInfoAt = 0;
  renderMain();
  const lunch = P?.draft?.free?.lunch || S.planFree?.lunch;
  const msg = at === null ? 'Lunch as usual today' : !at ? 'No lunch today' : lunch ? `Lunch today at ${lunch.start}` : `No free time around ${at} (passed or busy) — no lunch today`;
  if (at === null) toast(msg); else toast(msg, 'Undo', () => setLunchToday(null));
}
// Typed into, a time field (Plan the day's blocks and lunch, Settings' times) changes on every digit: applied then, the
// re-render took the focus away and the next digits ran as shortcuts (8 → Weekly review). So it applies once it's left (or
// on Enter). Chrome blurs it for a moment between the hour and the minutes, so "left" is checked after a tick.
function applyTimeField(el) {
  if (el.classList.contains('pt-lunch-at')) { if (el.value) setLunchToday(el.value); return; }
  if (el.id === 'set-digest' && el.value) return saveSetting({ digestAt: el.value });
  if (el.matches('.set-time') && el.value) return saveSetting({ [el.dataset.key]: el.value });
  const k = el.dataset.blk, b = k && S.plan?.blk?.[k];
  if (!b || !/^\d{2}:\d{2}$/.test(el.value)) return;
  const len = mins(b.end) - mins(b.start);
  if (el.dataset.end === '1') b.end = el.value; else { b.start = el.value; b.end = hhmm(Math.min(24 * 60 - 5, mins(b.start) + len)); }
  b.on = true; b.hand = true; renderMain();
}
function settleTimeField(el) {
  setTimeout(() => {
    if (document.activeElement === el || !el.dataset.pend || !el.isConnected) return;
    delete el.dataset.pend;
    const to = document.activeElement, next = to?.matches?.('[data-blk]') ? `[data-blk="${to.dataset.blk}"][data-end="${to.dataset.end}"]` : null;
    applyTimeField(el);
    if (next) $(next)?.focus();
  });
}
document.addEventListener('change', (e) => { if (e.target.matches?.('[data-blk], .pt-lunch-at, #set-digest, .set-time')) { e.target.dataset.pend = '1'; settleTimeField(e.target); } });
document.addEventListener('focusout', (e) => { if (e.target.dataset?.pend) settleTimeField(e.target); });
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset?.pend) { e.preventDefault(); e.target.blur(); } });
// Free time + cached estimates for Today (no model call); read again after a block changes in the app, else at most every
// 2 minutes (an event changed in the calendar itself shows by then).
async function refreshPlanInfo(force = false) {
  if (!force && S.planInfoAt && Date.now() - S.planInfoAt < 2 * 60e3) return;
  S.planInfoAt = Date.now();
  try {
    const [free, est] = await Promise.all([fetch('/api/plan/free').then((r) => r.json()), fetch('/api/plan/estimates').then((r) => r.json())]);
    S.planFree = free; S.planEst = est;
    if (S.view === 'today') renderMain();
  } catch { /* offline: no capacity line */ }
}

// What can go into a free window starting at a: any task of the day not already there — earlier or later, taken on or
// not (not #1 in deep work, not a block already started).
function fillCandidates(a, slots) {
  const P = S.plan;
  return P.order.filter((id) => {
    const sl = slots[id];
    if (P.pick[id] !== 'do' || !sl) return true;
    return !sl.deep && !sl.pinned && mins(sl.start.slice(11)) !== a;
  }).slice(0, 12);
}
const clipTitle = (t) => (t.length > 60 ? `${t.slice(0, 60).replace(/\s+\S*$/, '')}…` : t);

// Plan the day's Do today, side by side with the day: each task next to its time, the calendar's own events and free
// windows between them, in time order (not to scale); what doesn't fit goes under a line. Drag ⋮⋮ to change the order,
// or onto a free window to put the task there.
function planRailHtml(ids, slots, row) {
  const P = S.plan, f = P.draft.free, wd = f.workday || ME().workday, from = planStart(wd), to = mins(wd.end);
  const mine = new Set(Object.values(planBlocks(P)).map((b) => b.event)), byEv = calTasks(); // our tasks' blocks show as the tasks
  const items = ids.filter((id) => slots[id]).map((id) => ({ a: mins(slots[id].start.slice(11)), z: mins(slots[id].end.slice(11)), id, sl: slots[id] }));
  for (const e of f.events || []) {
    const a = mins(e.start), z = e.end === '00:00' ? 24 * 60 : mins(e.end);
    if (z <= from || a >= to || mine.has(e.id) || e.kind === 'focus') continue;
    if (P.order.some((id) => (taskById(id)?.timeblocks || []).some((x) => x.event === e.id))) continue; // a block of a task in this plan (passed or moved off today)
    const t = byEv.get(e.id), deep = /^⏱ Deep (work|love)/.exec(e.title);
    if (deep && items.some((x) => x.sl?.deep)) continue; // #1's task is shown in its deep work block
    items.push({ a, z, ev: t ? t.title : e.title.replace(/^⏱\s*/, ''), kind: deep ? (deep[1] === 'love' ? 'love' : 'deep') : t || e.kind === 'block' ? 'task' : 'meet', task: t?.id });
  }
  if (f.lunch && mins(f.lunch.end) > from) items.push({ a: mins(f.lunch.start), z: mins(f.lunch.end), ev: 'Lunch', kind: 'lunch' });
  const w = P.blk?.work;
  if (w?.on && !w.exists && !items.some((x) => x.sl?.deep)) items.push({ a: mins(w.start), z: mins(w.end), ev: `Deep work${P.one?.text ? ` for #1: ${P.one.text}` : ''} · on Apply`, kind: 'deep prop' });
  items.sort((x, y) => x.a - y.a || x.z - y.z);
  const tm = (a, z) => `<span class="pt-a">${hhmm(a)}</span><span class="pt-z">–${hhmm(z)}</span>`;
  const out = [];
  // a free window: + puts a task there; inside a "Focus time" event it says so (room for the important ones)
  const focus = (f.events || []).filter((e) => e.kind === 'focus').map((e) => [mins(e.start), mins(e.end)]);
  const freeRow = (a, z) => {
    const inFocus = focus.some(([x, y]) => x < z && y > a), open = P.fillAt === a;
    const cands = open ? fillCandidates(a, slots) : [];
    return `<div class="pt-row pt-free" data-free="${a}"><span class="pt-drag off"></span><div class="pt-l"><span class="pt-ev">${planMins(z - a)} free${inFocus ? ' <span class="pt-fk">· in Focus time</span>' : ''}</span>
      <button class="linkbtn pt-fill" data-act="pt-fill" data-a="${a}">${open ? 'Close' : '+ Put a task here'}</button>
      ${open ? `<div class="pt-cands">${cands.length ? cands.map((id) => { const t = taskById(id), m = P.draft.tasks.find((x) => x.id === id)?.minutes; return `<button class="chip" data-act="pt-put" data-id="${esc(id)}" data-a="${a}">${inline(clipTitle(t?.title || id))}${m ? ` <span class="muted">~${planMins(m)}</span>` : ''}</button>`; }).join('') : '<span class="muted">Nothing else to put here</span>'}</div>` : ''}</div>
      <div class="pt-r"><div class="pt-blk free">${tm(a, z)}</div></div></div>`;
  };
  let cur = from;
  for (const x of items) {
    if (x.a - cur >= 10 && cur < to) out.push(freeRow(cur, Math.min(x.a, to)));
    if (x.id) {
      const sl = x.sl, cls = sl.deep ? 'deep' : sl.pinned || sl.kept ? 'task' : 'prop';
      const note = sl.pinned ? 'started' : sl.byHand ? 'put here' : sl.was ? `was ${sl.was}` : sl.kept ? 'in calendar' : sl.deep ? '' : 'new';
      out.push(`<div class="pt-row" data-task="${esc(x.id)}">${sl.pinned || sl.deep ? '<span class="pt-drag off"></span>' : `<span class="pt-drag" data-pdrag="${esc(x.id)}" aria-label="Drag to reorder or onto a free time" title="Drag to reorder, or onto a free time">⋮⋮</span>`}
        <div class="pt-l">${row(x.id, true, true)}</div><div class="pt-r"><div class="pt-blk ${cls}" title="${sl.pinned ? 'started — stays where it is' : sl.was ? `moves from ${sl.was} on Apply` : sl.kept ? 'in your calendar' : sl.deep ? 'deep work' : 'goes to your calendar on Apply'}">${tm(x.a, x.z)}${note ? `<span class="pt-note">${note}</span>` : ''}</div></div></div>`);
    } else {
      const what = x.kind === 'meet' ? 'meeting' : x.kind === 'lunch' ? '' : x.kind.startsWith('deep') ? 'deep work' : x.kind === 'love' ? 'deep love' : 'task block';
      // lunch: move it or skip it for today (Settings keeps the usual time)
      const lunchCtl = x.kind !== 'lunch' ? '' : P.lunchEdit
        ? `<span class="pt-lunch"><input type="time" step="300" class="pt-lunch-at" value="${hhmm(x.a)}" aria-label="Lunch today at"><button class="linkbtn" data-act="lunch-edit">Cancel</button></span>`
        : `<span class="pt-lunch"><button class="linkbtn" data-act="lunch-edit">Move</button> · <button class="linkbtn" data-act="lunch-skip">Skip today</button></span>`;
      out.push(`<div class="pt-row pt-cal ${x.kind === 'meet' || x.kind === 'lunch' ? 'is-meet' : ''}"><span class="pt-drag off"></span><div class="pt-l"><span class="pt-ev"><span class="pt-ic" aria-hidden="true">${x.kind === 'meet' ? '▦' : x.kind === 'lunch' ? '◌' : x.kind.startsWith('deep') ? '◆' : x.kind === 'love' ? '♥' : '⏱'}</span>${x.task ? `<button class="linkbtn" data-act="open-id" data-id="${esc(x.task)}">${inline(x.ev)}</button>` : esc(x.ev)} <span class="pt-k">${what}</span></span>${lunchCtl}</div><div class="pt-r"><div class="pt-blk ${x.kind}">${tm(x.a, x.z)}</div></div></div>`);
    }
    cur = Math.max(cur, x.z);
  }
  if (to - cur >= 10) out.push(freeRow(cur, to));
  const left = ids.filter((id) => !slots[id]);
  if (left.length) {
    out.push(`<div class="pt-cut">doesn’t fit today · ${left.length} — ○ to move${left.length === 1 ? ' it' : ''}</div>`);
    const ahead = planBlocks(P);
    for (const id of left) out.push(`<div class="pt-row pt-out" data-task="${esc(id)}"><span class="pt-drag" data-pdrag="${esc(id)}" aria-label="Drag to reorder or onto a free time" title="Drag to reorder, or onto a free time">⋮⋮</span><div class="pt-l">${row(id, true, true)}</div><div class="pt-r"><div class="pt-blk none">${ahead[id] ? `its ${ahead[id].start.slice(11)} block goes on Apply` : 'no time'}</div></div></div>`);
  }
  return `<div class="pt">${out.join('')}</div>`;
}
// Today: a task row and its block in the day's calendar light up together
document.addEventListener('mouseover', (e) => {
  if (S.view !== 'today') return;
  const x = e.target.closest('#main .row[data-id], #main [data-cal]');
  const id = x && (x.dataset.cal || x.dataset.id);
  if (id === S.calHl) return;
  document.querySelectorAll('.cal-hl').forEach((el) => el.classList.remove('cal-hl'));
  S.calHl = id;
  if (id && document.querySelector(`[data-cal="${CSS.escape(id)}"]`)) document.querySelectorAll(`#main .row[data-id="${CSS.escape(id)}"], [data-cal="${CSS.escape(id)}"]`).forEach((el) => el.classList.add('cal-hl'));
});
// Reorder Do today by dragging ⋮⋮ (mouse or touch): the order is the day's order. Dropped on a free window: the task
// goes there (like + Put a task here), whatever its place in the order.
let pdrag = null;
document.addEventListener('pointerdown', (e) => {
  const h = e.target.closest('[data-pdrag]');
  if (!h || !S.plan) return;
  e.preventDefault();
  pdrag = { id: h.dataset.pdrag, row: h.closest('.pt-row'), over: null };
  pdrag.row.classList.add('dragging');
});
document.addEventListener('pointermove', (e) => {
  if (!pdrag) return;
  e.preventDefault();
  document.querySelectorAll('.pt-row.drop-before, .pt-row.drop-after, .pt-row.drop-in').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-in'));
  const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.pt-row[data-task], .pt-row[data-free]');
  if (!el || el === pdrag.row) { pdrag.over = null; return; }
  if (el.dataset.free) { el.classList.add('drop-in'); pdrag.over = { free: +el.dataset.free }; return; }
  const r = el.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
  el.classList.add(after ? 'drop-after' : 'drop-before');
  pdrag.over = { id: el.dataset.task, after };
}, { passive: false });
function endPlanDrag() {
  if (!pdrag) return;
  const { id, over } = pdrag;
  pdrag = null;
  document.querySelectorAll('.pt-row.dragging').forEach((x) => x.classList.remove('dragging'));
  if (!over || !S.plan) return renderMain();
  if (over.free != null) { // onto a free window: there, by hand
    (S.plan.at ||= {})[id] = over.free; S.plan.pick[id] = 'do'; S.plan.fillAt = null; S.plan.loose?.delete(id);
    return renderMain();
  }
  const o = S.plan.order.filter((x) => x !== id), i = o.indexOf(over.id);
  if (i < 0) return renderMain();
  o.splice(over.after ? i + 1 : i, 0, id);
  S.plan.order = o;
  (S.plan.loose ||= new Set()).add(id); // dragged: no longer held at its old time
  if (S.plan.at) delete S.plan.at[id];   // nor at a time put by hand
  renderMain();
}
document.addEventListener('pointerup', endPlanDrag);
document.addEventListener('pointercancel', endPlanDrag);

// ---------- the day's calendar next to Today (the Mac: on the right; the phone: Day mode) — the workday to scale, read-only ----------
// Today's calendar events (S.planFree, from the Mac's calendars or Google's) → the task whose ## Time blocks holds that event.
function calTasks() {
  const m = new Map();
  for (const t of S.data.tasks) for (const b of t.timeblocks || []) if (b.start.slice(0, 10) === S.data.today) m.set(b.event, t);
  return m;
}
const notPlanned = (t) => t.status === 'new' && t.assigned !== 'agent' && t.due && t.due <= S.data.today && !hasBlockToday(t.id);
function dayCalHtml() {
  const f = S.planFree;
  if (!f) return '<div class="dc-empty">Reading your calendar…</div>';
  if (f.calendarError) return `<div class="dc-empty">${/not connected|No OAuth client|no access to calendars/.test(f.calendarError) ? 'No calendar connected — Settings → Calendar' : 'Calendar not reachable right now'}</div>`;
  const wd = f.workday || ME().workday, a = mins(wd.start), z = mins(wd.end), PH = 56, now = mins(nowHM());
  const y = (n) => ((Math.min(Math.max(n, a), z) - a) / 60) * PH, byEv = calTasks();
  const evs = [];
  for (const e of f.events || []) {
    const s = mins(e.start), en = e.end === '00:00' ? 24 * 60 : mins(e.end);
    if (en <= a || s >= z) continue;
    const t = byEv.get(e.id), deep = /^⏱ Deep (work|love)/.exec(e.title);
    evs.push({ s, e: en, id: t?.id, title: t ? t.title : e.title.replace(/^⏱\s*/, ''),
      k: t ? `task${t.status === 'done' ? ' ok' : en <= now ? ' miss' : ''}` : deep ? (deep[1] === 'love' ? 'love' : 'deep') : e.kind === 'block' ? 'task' : e.kind === 'focus' ? 'focus' : 'meet' });
  }
  // overlapping events side by side
  evs.sort((p, q) => p.s - q.s || q.e - p.e);
  let cl = [], end = -1;
  const flush = () => { const n = Math.max(...cl.map((x) => x.lane)) + 1; cl.forEach((x) => { x.lanes = n; }); cl = []; };
  for (const ev of evs) {
    if (ev.s >= end && cl.length) flush();
    const used = cl.filter((x) => x.e > ev.s).map((x) => x.lane);
    ev.lane = 0; while (used.includes(ev.lane)) ev.lane++;
    cl.push(ev); end = Math.max(end, ev.e);
  }
  if (cl.length) flush();
  let h = '';
  for (let t = Math.ceil(a / 60) * 60; t <= z; t += 60) h += `<div class="dc-hr" style="top:${y(t)}px"><i>${hhmm(t)}</i></div>`;
  for (const g of f.gaps || []) if (mins(g.end) - mins(g.start) >= 10) h += `<div class="dc-ev free" style="top:${y(mins(g.start)) + 1}px;height:${Math.max(14, y(mins(g.end)) - y(mins(g.start)) - 2)}px">${planMins(g.minutes)} free</div>`;
  for (const ev of evs) {
    const wdt = 100 / ev.lanes, ht = Math.max(14, y(ev.e) - y(ev.s) - 2);
    h += `<${ev.id ? `button data-act="open-id" data-id="${esc(ev.id)}" data-cal="${esc(ev.id)}"` : 'div'} class="dc-ev ${ev.k}" style="top:${y(ev.s) + 1}px;height:${ht}px;left:calc(${ev.lane * wdt}% + 1px);width:calc(${wdt}% - 3px)" title="${esc(`${hhmm(ev.s)}–${hhmm(ev.e)} · ${ev.title}`)}">
      ${ht >= 30 ? `<span class="dc-tm">${hhmm(ev.s)}–${hhmm(ev.e)}</span>` : ''}<span class="dc-t">${esc(ev.title)}</span></${ev.id ? 'button' : 'div'}>`;
  }
  if (now > a && now < z) h += `<div class="dc-past" style="height:${y(now)}px"></div><div class="dc-now" style="top:${y(now)}px"><b>${nowHM()}</b></div>`;
  const prot = habitsOn() ? S.data.day?.protocols || [] : [], sum = S.data.day?.summary || [];
  const pline = (p) => { const g = sum.find((x) => x.protocol === p.slug); return p ? `<a class="dc-proto" href="#/day">◐ ${esc(p.title)} ${p.window.start}–${p.window.end}${g ? ` · ${g.done}/${g.total}` : ''}</a>` : ''; };
  const am = prot.find((p) => p.window.end <= wd.start), pm = prot.find((p) => p.window.start >= wd.end);
  const np = S.data.tasks.filter(notPlanned), npMin = np.reduce((n, t) => n + (S.planEst?.[t.id] || 50), 0);
  return `<div class="dc-h"><b>${esc(fromIso(S.data.today).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }))}</b>
      <span>${planMins(f.freeMinutes)} free${now < z ? ` till ${wd.end}` : ''}</span>${f.plannedMinutes ? `<span>${planMins(f.plannedMinutes)} in blocks</span>` : ''}
      ${np.length ? `<span class="${npMin > f.freeMinutes ? 'd-over' : ''}">${np.length} not planned · ~${planMins(npMin)}${npMin > f.freeMinutes ? ` — ${planMins(npMin - f.freeMinutes)} more than fits` : ''}</span>` : ''}</div>
    ${am ? pline(am) : ''}<div class="dc" style="height:${y(z)}px">${h}</div>${pm ? pline(pm) : ''}
    ${np.length ? `<div class="dc-tray"><div class="dc-tray-h">Not planned <span class="c">${np.length}</span><a class="hint" href="#/plan">Plan the day</a></div>${np.sort(byPri).map((t) => `<button class="dc-np" data-act="open-id" data-id="${esc(t.id)}">○ ${inline(t.title)} <span class="muted">~${planMins(S.planEst?.[t.id] || 50)}</span></button>`).join('')}</div>` : ''}`;
}

// The plan laid out on today's calendar, strictly in list order (each task starts after the one above it). Re-planning
// later in the day: a task's block keeps its time while that still fits the order, a dragged task (P.loose) takes the
// earliest free time after the one above; on Apply moved blocks move in the calendar, new ones are created. A block
// already started stays where it is; #1's task goes into deep work; a task that fits nowhere gets null.
const planStart = (wd) => Math.max(mins(wd.start), Math.ceil(mins(nowHM()) / 5) * 5);
// our tasks' blocks still ahead today ({id → block}): the plan may move them
function planBlocks(P = S.plan) {
  const out = {}, now = nowLocal();
  for (const id of P.order) { const b = todayBlock(id, P.draft.free, { deep: false }); if (b && b.end > now) out[id] = b; }
  return out;
}
function planSlots() {
  const P = S.plan, out = {}, f = P.draft.free, day = S.data.today, now = nowLocal(), nowM = mins(nowHM());
  const wd = f.workday || ME().workday, to = mins(wd.end), at = (n) => `${day}T${hhmm(n)}`;
  const blk = planBlocks(P), started = (b) => b.start <= now;
  const ours = new Set(Object.values(blk).filter((b) => !started(b)).map((b) => b.event));
  const busy = (f.events || []).filter((e) => e.kind !== 'focus' && !ours.has(e.id)).map((e) => [mins(e.start), e.end === '00:00' ? 24 * 60 : mins(e.end)]);
  if (f.lunch) busy.push([mins(f.lunch.start), mins(f.lunch.end)]);
  const w = P.blk?.work;
  if (w?.on && !w.exists) busy.push([mins(w.start), mins(w.end)]);
  const fits = (a, m) => a >= nowM && a + m <= to && !busy.some(([x, y]) => x < a + m && y > a);
  const earliest = (c, m) => [c, ...busy.map(([, y]) => y).filter((y) => y > c)].sort((x, y) => x - y).find((a) => fits(a, m)) ?? null;
  // put in a free window by hand (P.at: + on a free row): there, as long as the window allows (cut to fit it)
  for (const [id, a] of Object.entries(P.at || {})) {
    if (P.pick[id] !== 'do' || a < nowM || busy.some(([x, y]) => x <= a && y > a)) { delete P.at[id]; continue; }
    const m = P.draft.tasks.find((t) => t.id === id)?.minutes || 50, room = Math.min(to, ...busy.map(([x]) => x).filter((x) => x > a)) - a;
    const z = a + Math.min(m, room), b = blk[id];
    out[id] = { start: at(a), end: at(z), event: b?.event || null, byHand: true, was: b && b.start.slice(11) !== hhmm(a) ? b.start.slice(11) : null };
    busy.push([a, z]);
  }
  let cur = planStart(wd);
  for (const id of P.order.filter((x) => P.pick[x] === 'do' && !out[x])) {
    if ((w?.on || w?.exists) && P.one?.link === id) { out[id] = { deep: true, start: at(mins(w.start)), end: at(mins(w.end)) }; continue; } // #1's task goes into the deep work block
    const b = blk[id];
    if (b && started(b)) { out[id] = { start: b.start, end: b.end, pinned: true }; continue; }
    const m = b ? mins(b.end.slice(11)) - mins(b.start.slice(11)) : P.draft.tasks.find((t) => t.id === id).minutes;
    const was = b ? mins(b.start.slice(11)) : null, kept = b && !P.loose?.has(id) && was >= cur && fits(was, m);
    const a = kept ? was : earliest(cur, m);
    if (a == null) { out[id] = null; continue; }
    out[id] = { start: at(a), end: at(a + m), event: b?.event || null, kept: !!kept, was: b && !kept ? b.start.slice(11) : null };
    busy.push([a, a + m]);
    cur = a + m + (kept ? 0 : 5); // a short break after a new block
  }
  return out;
}
const mins = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
// An agent task in Plan the day: queued ones toggle "run on Apply" (same circle as Do today); others say what they wait for.
function agentPlanRow(a) {
  const P = S.plan, t = taskById(a.id), mine = isAssistant(a.agent), runnable = a.state === 'queued' && !mine, on = !!P.run[a.id];
  const status = mine ? `${agentName(a.agent)} picks it up` : a.state === 'queued' ? (on ? 'runs on Apply' : 'not now')
    : a.state === 'review' ? 'done — review it' : a.state === 'blocked' ? 'needs your answer' : 'running…';
  const ctl = runnable ? `<button class="check agent ${on ? 'done' : ''}" data-act="plan-run" data-id="${a.id}" aria-label="${on ? 'Don’t run now' : 'Run on Apply'}" title="${on ? 'Don’t run now' : 'Run on Apply'}"></button>`
    : '<span class="plan-ag-ic" aria-hidden="true">✦</span>';
  const open = runnable || mine ? '' : `<button class="linkbtn" data-act="open-id" data-id="${a.id}">${a.state === 'review' ? 'Review' : a.state === 'blocked' ? 'Answer' : 'Open'}</button>`;
  return `<div class="plan-row agent ${runnable && !on ? 'moving' : ''}">${ctl}<div class="plan-main"><div class="plan-t">${inline(t.title)}</div>
    <div class="plan-meta"><span class="pill agent">✦ ${agentName(a.agent)}</span><span>${status}</span>${open}</div></div></div>`;
}
// A plan set today (Apply): Plan the day shows it as it stands, nothing is re-planned; Re-plan opens the planning, with
// the plan's open tasks still picked.
function planSetHtml() {
  const D = S.planDay, today = S.data.today;
  if ((!D || D.date !== today || Date.now() - (S.planDayAt || 0) > 60e3) && !S.planDayLoading) {
    S.planDayLoading = true;
    api('GET', `/api/day?date=${today}`).then((d) => { S.planDay = d; }, (e) => { S.planDay = { date: today, error: e.message }; })
      .finally(() => { S.planDayLoading = false; S.planDayAt = Date.now(); if (S.view === 'plan') renderMain(); });
  }
  if (!D || D.date !== today) return '<div class="plan"><div class="vstatus"><span class="spin"></span>Today’s plan…</div></div>';
  const p = D.plan || { tasks: [], blocks: [], added: [] }, T = (id) => taskById(id) || D.tasks?.[id];
  const isDone = (x) => x.done || T(x.id)?.status === 'done';
  const done = p.tasks.filter(isDone), mins0 = (x) => taskById(x.id)?.estimate || x.minutes || 0;
  const left = p.tasks.filter((x) => !isDone(x)).reduce((n, x) => n + mins0(x), 0);
  const f = S.planFree, pct = p.tasks.length ? Math.round((done.length / p.tasks.length) * 100) : 0;
  const at = (p.setAt || '').slice(11, 16);
  const row = (x) => {
    const t = T(x.id), ok = isDone(x), b = !ok && todayBlock(x.id), m = mins0(x);
    return `<div class="plan-row ${ok ? 'moving' : ''}"><span class="plan-ic">${ok ? '✓' : '○'}</span><div class="plan-main">
      <button class="plan-t linkbtn plan-open" data-act="open-id" data-id="${esc(x.id)}">${inline(t?.title || x.id)}</button>
      <div class="plan-meta">${m ? `<span>~${planMins(m)}</span>` : ''}${b ? `<span class="plan-slot">⏱ ${b.start.slice(11, 16)}–${b.end.slice(11, 16)}</span>` : ''}${!ok && t?.due && t.due > today ? `<span class="d-over">moved to ${esc(dateLabel(t.due)[0])}</span>` : ''}</div></div></div>`;
  };
  const one = p.one, oneOk = D.oneDone;
  return `<div class="plan">
    <div class="plan-cap"><div class="plan-cap-t"><b>Today’s plan</b>${at ? ` · set ${at}` : ''}</div>
      <div class="plan-cap-s">${done.length} of ${p.tasks.length} done${left ? ` · ~${planMins(left)} left` : ''}${f && !f.calendarError && Number.isFinite(f.freeMinutes) ? ` · ${planMins(f.freeMinutes)} free now` : ''}</div>
      <div class="plan-bar"><span style="width:${pct}%"></span></div>
      ${D.error ? `<div class="plan-cap-s d-over">Couldn’t read the plan: ${esc(D.error)}</div>` : ''}</div>
    ${one ? `<div class="section-h">#1</div><div class="plan-row"><span class="plan-ic">${oneOk ? '✓' : '◎'}</span><div class="plan-main">${one.link ? `<button class="plan-t linkbtn plan-open" data-act="open-id" data-id="${esc(one.link)}">${inline(one.text)}</button>` : `<div class="plan-t">${inline(one.text)}</div>`}</div></div>` : ''}
    ${(() => { const rest = p.tasks.filter((x) => x.id !== one?.link); return `<div class="section-h">Taken on <span class="c">${rest.length}</span></div>
    ${rest.length ? rest.map(row).join('') : '<div class="empty">No other tasks in the plan.</div>'}`; })()}
    ${p.blocks?.length ? `<div class="section-h">Blocks</div>${p.blocks.map((b) => `<div class="plan-row"><span class="plan-ic">${b.kind === 'love' ? '♥' : '◆'}</span><div class="plan-main"><div class="plan-t">${b.kind === 'love' ? 'Deep love' : 'Deep work'}</div><div class="plan-meta"><span class="plan-slot">${b.start}–${b.end}</span></div></div></div>`).join('')}` : ''}
    ${p.added?.length ? `<div class="section-h">Added later <span class="c">${p.added.length}</span></div>${p.added.map((id) => row({ id, done: T(id)?.status === 'done' })).join('')}` : ''}
    <div class="plan-acts"><span class="plan-sum">The day changed? Re-plan fits it to the time left</span>
      <button class="btn primary" data-act="plan-replan">Re-plan</button></div>
  </div>`;
}
function planHtml() {
  if (S.plan?.evening) return eveningHtml();
  const P = S.plan;
  if (!P?.draft && !P?.loading && !P?.error && !P?.replan) {
    if (!S.data.vault) return '<div class="plan"><div class="vstatus"><span class="spin"></span>Today’s plan…</div></div>'; // the state isn't here yet: is there a plan?
    if (S.data.day?.planSet) return planSetHtml();
  }
  if (!P?.draft) {
    if (!P?.loading && !P?.error) setTimeout(() => loadPlan(), 0);
    return `<div class="plan"><div class="vstatus"><span class="spin"></span>Looking at your calendar and estimating today’s tasks…</div>${P?.error ? `<div class="empty">Couldn’t plan: ${esc(P.error)}</div>` : ''}</div>`;
  }
  const d = P.draft, free = d.free, slots = planSlots(), carry = new Set((d.carry || []).filter((id) => P.order.includes(id)));
  const est = (id) => d.tasks.find((t) => t.id === id);
  const doIds = P.order.filter((x) => P.pick[x] === 'do'), moveIds = P.order.filter((x) => P.pick[x] === 'move');
  const used = doIds.reduce((n, id) => n + est(id).minutes, 0);
  const cap = d.capacity ?? Math.round(free.freeMinutes * 0.85);
  const pct = Math.min(100, Math.round((used / Math.max(cap, 1)) * 100));
  const row = (id, doing, rail) => {
    const t = taskById(id), e = est(id), sl = rail ? undefined : slots[id], g = goalChain(id)[0];
    return `<div class="plan-row ${doing ? '' : 'moving'}">
      <button class="check ${doing ? 'done' : ''}" data-act="plan-toggle" data-id="${id}" aria-label="${doing ? 'Move instead' : 'Do today'}" title="${doing ? 'Move instead' : 'Do today'}"></button>
      <div class="plan-main"><div class="plan-t">${inline(t?.title || id)}</div>
        <div class="plan-meta"><button class="est-btn ${e.own ? 'own' : ''}" data-act="est-open" data-id="${id}" title="${e.own ? 'Your time — tap to change' : 'The agent’s estimate — tap to set your own'}">${e.own ? '' : '✦ '}~${planMins(e.minutes)}</button>${doing && sl !== undefined ? (sl?.deep ? '<span class="plan-slot">◆ in deep work</span>' : sl ? `<span class="plan-slot">⏱ ${sl.start.slice(11)}–${sl.end.slice(11)}</span>` : '<span class="d-over">no free slot</span>') : ''}${e.must ? '<span class="pill">today</span>' : ''}${g ? `<span class="goal-chain">→ ${esc(g.title)}</span>` : ''}${e.why ? `<span class="plan-why">${esc(e.why)}</span>` : ''}</div>
        ${P.estOpen === id ? estPickerHtml(id, e.own ? e.minutes : null, e.agentMinutes) : ''}
        ${doing ? '' : `<div class="chips plan-moves">${MOVES.map(([k, l]) => `<button class="chip ${P.moveTo[id] === k ? 'on' : ''}" data-act="plan-move" data-id="${id}" data-to="${k}">${l}${moveDate(k) ? ` · ${fromIso(moveDate(k)).toLocaleDateString('en-GB', { weekday: 'short' })}` : ''}</button>`).join('')}</div>`}</div></div>`;
  };
  // left undone in the plan three days running: decide now instead of carrying it again
  const carryRow = (id) => {
    const t = taskById(id), e = est(id), doing = P.pick[id] === 'do';
    return `<div class="plan-row carry"><span class="plan-ic">⟳</span><div class="plan-main"><div class="plan-t">${inline(t?.title || id)}</div>
      <div class="plan-meta"><span>~${planMins(e.minutes)}</span><span>3 days in the plan, not done</span></div>
      <div class="chips plan-moves"><button class="chip ${doing ? 'on' : ''}" data-act="carry-do" data-id="${id}">Do it today</button>
        <button class="chip" data-act="open-id" data-id="${id}">Break it down…</button>
        ${MOVES.slice(1).map(([k, l]) => `<button class="chip ${!doing && P.moveTo[id] === k ? 'on' : ''}" data-act="carry-move" data-id="${id}" data-to="${k}">${l}</button>`).join('')}
        <button class="chip" data-act="carry-drop" data-id="${id}">Drop</button></div></div></div>`;
  };
  const agents = d.agents.filter((a) => taskById(a.id));
  const nRun = agents.filter((a) => P.run[a.id]).length, nBlocks = doIds.filter((id) => slots[id]?.start && !slots[id].pinned && !slots[id].deep && !slots[id].kept).length;
  const calOk = !free.calendarError && !S.data.local;
  const nDeep = calOk ? ['work', 'love'].filter((k) => P.blk?.[k]?.on && !P.blk[k].exists).length : 0;
  const wd = free.workday || { start: ME().workday.start, end: ME().workday.end };
  const hh = (x) => x.replace(/:00$/, '').replace(/^0/, '');
  const blkRow = (k) => {
    const b = P.blk?.[k];
    if (!b) return '';
    const name = k === 'love' ? '♥ Deep love' : `◆ Deep work${P.one?.text ? ' for #1' : ''}`;
    if (b.exists) return `<div class="plan-row"><span class="plan-ic">${k === 'love' ? '♥' : '◆'}</span><div class="plan-main"><div class="plan-t">${name.slice(2)}</div><div class="plan-meta"><span class="plan-slot">${b.start}–${b.end}</span><span>in your calendar</span></div></div></div>`;
    return `<div class="plan-row ${b.on ? '' : 'moving'}"><button class="check ${b.on ? 'done' : ''}" data-act="plan-blk" data-kind="${k}" aria-label="${b.on ? 'No block' : 'Add to calendar'}"></button>
      <div class="plan-main"><div class="plan-t">${name.slice(2)}</div><div class="plan-meta"><span class="blk-time"><input type="time" step="300" data-blk="${k}" data-end="0" value="${b.start}">–<input type="time" step="300" data-blk="${k}" data-end="1" value="${b.end}"></span>
        ${(() => { const c = blockClash(P.draft, mins(b.start), mins(b.end)); return c ? `<span class="d-over">overlaps: ${esc(c.title)} ${c.start}–${c.end}</span>` : `<span>${k === 'love' ? 'family, partner, friends — non-negotiable' : 'no distractions, on your #1'}</span>`; })()}</div></div></div>`;
  };
  const oneChain = P.one?.link ? goalChain(P.one.link) : [];
  return `<div class="plan">
    <div class="plan-cap"><div class="plan-cap-t"><b>${planMins(free.freeMinutes)}</b> free today ${free.from !== wd.start ? `from ${free.from} ` : ''}· ${hh(wd.start)}–${hh(wd.end)}${wd.from === 'protocols' ? ' (between your AM and PM)' : ''}, minus meetings${free.lunch ? ` and lunch ${free.lunch.start}` : ''}${free.lunchToday ? ` · <button class="linkbtn" data-act="lunch-reset">${free.lunchToday === 'off' ? 'no lunch today — add it back' : 'lunch moved today — as usual'}</button>` : ''}${free.calendarError ? (/not connected|No OAuth client|no access to calendars/.test(free.calendarError) ? ' · no calendar connected (Settings → Calendar)' : ' · <span class="d-over">calendar not reachable</span>') : ''}</div>
      <div class="plan-cap-s">${d.pace ? `Your pace over ${d.pace.days} planned days: ${Math.round(d.pace.rate * 100)}% done → take on <b>${planMins(cap)}</b>` : `Take on up to 85% → <b>${planMins(cap)}</b> (your real pace shows after 3 planned days)`}${d.oneStreak ? ` · #1 streak ${d.oneStreak}` : ''}</div>
      <div class="plan-bar"><span style="width:${pct}%" class="${used > cap ? 'over' : ''}"></span></div>
      ${d.estimateError ? '<div class="plan-cap-s d-over">The agent couldn’t estimate this time — 50 min each for now. Tap re-estimate to try again.</div>' : ''}
      <div class="plan-cap-s">${planMins(used)} of ${planMins(cap)} picked below · <button class="linkbtn" data-act="plan-refresh">re-estimate</button> · free: ${free.gaps.map((g) => `${g.start}–${g.end}`).join(' · ') || 'no free window left'}</div></div>
    <div class="section-h">#1 <span class="hint">the one result that makes today a win</span></div>
    <div class="plan-row one-plan"><div class="plan-main"><input id="plan-one" class="one-in" placeholder="Today’s #1" value="${esc(P.one?.text || '')}">
      <div class="plan-meta">${!P.one?.link ? (P.one?.text ? '<span>your own words — a new task on Set</span>' : '') : P.oneFrom === 'win' ? '<span>from this week’s WIN #1</span>' : P.oneFrom === 'set' ? `<span>${d.plan?.setAt ? 'set for today' : 'chosen last night'}</span>` : ''}${oneChain.length ? chainHtml(oneChain) : ''}</div>
      ${onePickerHtml(oneChoices(doIds), P.one, 'plan-one-pick')}</div></div>
    ${calOk && P.blk ? `<div class="section-h">Blocks <span class="hint">to your calendar on Apply</span></div>${blkRow('work')}${blkRow('love')}` : ''}
    ${carry.size ? `<div class="section-h">Decide <span class="c">${carry.size}</span><span class="hint">carried three days — do, split, park or drop</span></div>${[...carry].map(carryRow).join('')}` : ''}
    <div class="section-h">Do today <span class="c">${doIds.filter((id) => !carry.has(id)).length}</span><span class="hint">${calOk ? 'top first · drag ⋮⋮ to reorder · ○ moves it' : 'tap ○ to move a task instead'}</span></div>
    ${!doIds.some((id) => !carry.has(id)) ? '<div class="empty">Nothing picked — tap ○ below to take a task in.</div>' : calOk ? planRailHtml(doIds.filter((id) => !carry.has(id)), slots, row) : doIds.filter((id) => !carry.has(id)).map((id) => row(id, true)).join('')}
    ${planDecisionsHtml()}
    ${comingUpHtml()}
    ${agents.length ? `<div class="section-h">Hand to agents <span class="c">${agents.length}</span>${agents.some((a) => a.state === 'queued' && !isAssistant(a.agent)) ? '<span class="hint">tap ○ to run on Apply</span>' : ''}</div>${agents.map(agentPlanRow).join('')}` : ''}
    ${moveIds.filter((id) => !carry.has(id)).length ? `<div class="section-h">Move <span class="c">${moveIds.filter((id) => !carry.has(id)).length}</span><span class="hint">not today — pick when</span></div>${moveIds.filter((id) => !carry.has(id)).map((id) => row(id, false)).join('')}` : ''}
    <div class="plan-acts"><span class="plan-sum">${nBlocks + nDeep} block${nBlocks + nDeep === 1 ? '' : 's'} to set in calendar${nRun ? ` · ${nRun} agent${nRun === 1 ? '' : 's'}` : ''} · ${moveIds.length} moved</span>
      <button class="btn primary" data-act="plan-apply">Apply</button></div>
  </div>`;
}
// Deep work (for #1: the first free 90 min, the morning first) and deep love (in the evening protocol's window, else the
// last hour of the workday) — proposals; nothing goes to the calendar before Apply. A block already set today is shown as is.
// The calendar event (today, not a task block of ours) a time range runs into, if any.
function blockClash(d, a, z) {
  return (d.free.events || []).find((e) => e.kind !== 'block' && e.kind !== 'focus' && mins(e.start) < z && mins(e.end) > a) || null; // Focus time is room for work
}
// Deep work for #1: as long as #1's task takes (else 90 min), in the first free window that holds it, the morning first
function proposeWork(d, one) {
  const gaps = d.free.gaps.map((g) => ({ a: mins(g.start), z: mins(g.end) }));
  const L = Math.min(240, Math.max(30, d.tasks.find((t) => t.id === one?.link)?.minutes || 90));
  const g = gaps.find((x) => x.z - x.a >= L && x.a < 12 * 60) || gaps.find((x) => x.z - x.a >= L) || [...gaps].sort((a, b) => (b.z - b.a) - (a.z - a.a)).find((x) => x.z - x.a >= 45);
  return g ? { start: hhmm(g.a), end: hhmm(Math.min(g.z, g.a + L)), on: !!one?.text } : null;
}
function proposeBlocks(d, one) {
  const have = d.plan?.blocks || [], out = {};
  const ex = (k) => have.find((b) => b.kind === k);
  if (ex('work')) out.work = { ...ex('work'), exists: true };
  else { const w = proposeWork(d, one); if (w) out.work = w; }
  if (ex('love')) out.love = { ...ex('love'), exists: true };
  else {
    const pm = habitsOn() && (S.data.day?.protocols || []).find((p) => p.window.start >= '12:00');
    const wd = d.free.workday || ME().workday;
    // the first free hour (calendar) from 30 min into the evening protocol's window, else the workday's last hour
    const a0 = pm ? mins(pm.window.start) + 30 : mins(wd.end) - 60, last = pm ? mins(pm.window.end) - 60 : a0;
    let a = a0;
    while (a < last && blockClash(d, a, a + 60)) a += 15;
    if (blockClash(d, a, a + 60)) a = a0; // nothing free: keep the default, the row says what it overlaps
    if (a > 0 && a + 60 < 24 * 60) out.love = { start: hhmm(a), end: hhmm(a + 60), on: !!pm };
  }
  return out;
}
// Coming up: commitments / wants / issues whose time to prepare has come (same rules as the assistant's morning brief).
// + Task files a task under it (then it stops showing), Not yet looks again in 7 days, Done this cycle moves a recurring
// commitment one period on (a one-off one is done and archived).
function comingUpHtml() {
  const items = S.data.attention || [];
  if (!items.length) return '';
  const when = (x) => {
    if (!x.deadline) return x.type === 'want' ? 'time to revisit' : 'time to look at it';
    const n = dayDiff(x.deadline, S.data.today);
    return n < 0 ? `<span class="d-over">${-n} day${n === -1 ? '' : 's'} overdue</span>` : `due ${fromIso(x.deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · in ${n} day${n === 1 ? '' : 's'}`;
  };
  return `<div class="section-h">Coming up <span class="c">${items.length}</span><span class="hint">time to prepare</span></div>
    ${items.map((x) => `<div class="plan-row"><span class="plan-ic">⏳</span><div class="plan-main"><div class="plan-t">${esc(x.title)}${x.to ? ` <span class="plan-to">· ${esc(x.to)}</span>` : ''}</div>
      <div class="plan-meta"><span>${when(x)}</span>${x.recurrence ? `<span>↻ ${esc(x.recurrence)}</span>` : ''}</div>
      <div class="chips plan-moves"><button class="chip on" data-act="cu-task" data-slug="${esc(x.slug)}">+ Task</button>
        <button class="chip" data-act="cu-snooze" data-slug="${esc(x.slug)}">Not yet · 7 days</button>
        ${x.type === 'commitment' ? `<button class="chip" data-act="cu-cycle" data-slug="${esc(x.slug)}" title="${x.period ? 'Done for now: move the dates one period on' : 'Done: close it'}">${x.period ? 'Done this cycle' : 'Done'}</button>` : ''}
        ${ME().obsidian ? `<a class="chip" href="${obsidianPath(x.file)}" title="Open in Obsidian">↗</a>` : ''}</div></div></div>`).join('')}`;
}
// Decisions due within 3 days (or overdue) belong to the day too: decide right here, or push them a week.
function planDecisionsHtml() {
  const soon = moveDate('tomorrow') && (() => { const d = fromIso(S.data.today); d.setDate(d.getDate() + 3); return iso(d); })();
  const due = (S.data.decisions || []).filter((d) => d.status === 'open' && d.decide_by && d.decide_by <= soon).sort((a, b) => a.decide_by.localeCompare(b.decide_by));
  if (!due.length) return '';
  const week = (() => { const d = fromIso(S.data.today); d.setDate(d.getDate() + 7); return iso(d); })();
  return `<div class="section-h">Decide <span class="c">${due.length}</span><span class="hint">due within 3 days</span></div>
    ${due.map((d) => {
      const rec = d.options.find((o) => o.letter === d.rec), [when, cls] = decDue(d), pending = pendingOps.has(`dec:${d.slug}`);
      return `<div class="plan-row dec-plan ${pending ? 'moving' : ''}"><span class="plan-ic">⚖</span><div class="plan-main"><div class="plan-t">${esc(d.question)}</div>
        <div class="plan-meta"><span class="${cls}">${when}</span>${rec ? `<span class="plan-why">Recommended ${d.rec}: ${esc(rec.label)}</span>` : ''}</div>
        ${pending ? '<div class="plan-meta">Recording…</div>' : `<div class="chips plan-moves">${rec ? `<button class="chip on" data-act="dec-accept" data-slug="${d.slug}">✓ ${d.rec} · ${esc(rec.label.slice(0, 24))}</button>` : ''}
          <button class="chip" data-act="dec-park" data-slug="${d.slug}" data-date="${week}">Not now · 1 week</button><a class="chip" href="#/decisions">Open…</a></div>`}</div></div>`;
    }).join('')}`;
}
// A task's time block today as it is in the calendar now: moved there → its new time, deleted there → none. Until the
// calendar is read (or when it can't be) the vault's ## Time blocks line.
// Today's time for a task: its own block in the calendar, else — for #1's task — the day's deep work block (Plan the day →
// Blocks, kept in the daily file, not among the task's blocks). deep: false = only its own (re-planning moves those).
function todayBlock(id, free = S.plan?.draft?.free || S.planFree, { deep = true } = {}) {
  const own = ownTodayBlock(id, free);
  if (own || !deep) return own;
  const w = S.data.day?.one?.link === id && (S.data.day.blocks || []).find((b) => b.kind === 'work');
  return w ? { start: `${S.data.today}T${w.start}`, end: `${S.data.today}T${w.end}`, deep: true } : null;
}
function ownTodayBlock(id, free) {
  const bs = (taskById(id)?.timeblocks || []).filter((b) => b.start.slice(0, 10) === S.data.today);
  if (!bs.length) return null;
  if (!free?.events || free.calendarError) return bs[0];
  for (const b of bs) {
    const e = free.events.find((x) => x.id === b.event);
    if (e) return { ...b, start: `${S.data.today}T${e.start}`, end: `${S.data.today}T${e.end === '00:00' ? '23:59' : e.end}` };
  }
  return null;
}
const hasBlockToday = (id) => !!todayBlock(id);
async function applyPlan() {
  const P = S.plan, slots = planSlots();
  const btn = $('[data-act="plan-apply"]'); if (btn) { btn.disabled = true; btn.textContent = 'Applying…'; }
  const undo = { events: [], dues: [], deep: [], moves: [], gone: [] };
  let blocks = 0, shifted = 0, runs = 0, moved = 0, failed = 0;
  const ahead = planBlocks(P), calOk = !P.draft.free.calendarError && !S.data.local;
  for (const id of P.order) {
    const t = taskById(id);
    if (!t) continue;
    try {
      const sl = slots[id];
      if (P.pick[id] === 'do' && sl?.start && !sl.pinned && !sl.deep && !sl.kept && calOk) {
        if (sl.event) { // re-planned: the block moves
          const b = ahead[id];
          await api('PATCH', `/api/tasks/${id}/timeblock/${encodeURIComponent(sl.event)}`, { start: sl.start, end: sl.end });
          undo.moves.push([id, sl.event, { start: b.start, end: b.end }]); shifted++;
        } else {
          const r = await api('POST', `/api/tasks/${id}/timeblock`, { start: sl.start, end: sl.end });
          undo.events.push([id, r.event.id]); blocks++;
        }
      }
      // moved off today, or no room for it in the new order: its block ahead today goes
      if ((P.pick[id] === 'move' || (P.pick[id] === 'do' && sl === null)) && calOk && ahead[id] && ahead[id].start > nowLocal()) {
        await api('DELETE', `/api/tasks/${id}/timeblock/${encodeURIComponent(ahead[id].event)}`);
        undo.gone.push([id, { start: ahead[id].start, end: ahead[id].end }]);
      }
      if (P.pick[id] === 'move') {
        const k = P.moveTo[id];
        undo.dues.push([id, { due: t.due, priority: t.priority }]);
        await patch(id, k === 'someday' ? { due: null, priority: 'someday' } : { due: moveDate(k) });
        moved++;
      }
    } catch { failed++; }
  }
  for (const a of P.draft.agents) if (P.run[a.id]) { try { await startRun(a.id, '', a.agent === 'codex' ? 'codex' : null); runs++; } catch { failed++; } }
  // the morning plan, fixed in the day's file (plan vs actual in the evening), then deep work / deep love blocks
  const today = S.data.today, doIds = P.order.filter((x) => P.pick[x] === 'do');
  try {
    await api('PUT', '/api/day/plan', { date: today, one: P.one?.text?.trim() ? { text: P.one.text.trim(), link: P.one.link || null, done: !!P.one.done } : null,
      tasks: doIds.map((id) => ({ id, minutes: P.draft.tasks.find((t) => t.id === id)?.minutes || null })) });
  } catch { failed++; }
  if (!P.draft.free.calendarError && !S.data.local) for (const k of ['work', 'love']) {
    const b = P.blk?.[k];
    if (!b?.on || b.exists) continue;
    try { const r = await api('POST', '/api/day/block', { date: today, kind: k, start: b.start, end: b.end }); undo.deep.push(r.blocks.find((x) => x.kind === k && x.start === b.start)?.event); blocks++; } catch { failed++; }
  }
  S.plan = null; S.planFree = null; S.planInfoAt = 0; S.planDay = null;
  location.hash = '#/today';
  await load();
  toast(`Planned: ${blocks} new block${blocks === 1 ? '' : 's'}${shifted ? ` · ${shifted} moved in calendar` : ''} · ${runs} agent${runs === 1 ? '' : 's'} · ${moved} moved${failed ? ` · ${failed} failed` : ''}`, 'Undo', async () => {
    for (const [id, ev] of undo.events) await api('DELETE', `/api/tasks/${id}/timeblock/${encodeURIComponent(ev)}`).catch(() => {});
    for (const [id, ev, was] of undo.moves) await api('PATCH', `/api/tasks/${id}/timeblock/${encodeURIComponent(ev)}`, was).catch(() => {});
    for (const [id, was] of undo.gone) await api('POST', `/api/tasks/${id}/timeblock`, was).catch(() => {});
    for (const ev of undo.deep.filter(Boolean)) await api('DELETE', `/api/day/block/${encodeURIComponent(ev)}?date=${S.data.today}`).catch(() => {});
    for (const [id, was] of undo.dues) await patch(id, was).catch(() => {});
    S.planInfoAt = 0; load();
  }, 8000);
}
// Evening: what's left of today → tomorrow (or another day) in one tap.
function eveningHtml() {
  const left = S.data.tasks.filter((t) => open(t) && t.assigned !== 'agent' && t.due && t.due <= S.data.today).sort(byPri);
  S.plan.moveTo = S.plan.moveTo || {};
  if (!left.length) return '<div class="plan"><div class="empty">Nothing left for today. Well done.</div></div>';
  return `<div class="plan"><p class="win-ask">${left.length} left for today. Move them — tap a day to change it.</p>
    ${left.map((t) => `<div class="plan-row moving"><div class="plan-main"><div class="plan-t">${inline(t.title)}</div>
      <div class="chips plan-moves">${MOVES.map(([k, l]) => `<button class="chip ${(S.plan.moveTo[t.id] || 'tomorrow') === k ? 'on' : ''}" data-act="plan-move" data-id="${t.id}" data-to="${k}">${l}</button>`).join('')}</div></div></div>`).join('')}
    <div class="plan-acts"><span class="sp"></span><button class="btn primary" data-act="plan-evening-apply">Move ${left.length}</button></div></div>`;
}
async function applyEvening() {
  const left = S.data.tasks.filter((t) => open(t) && t.assigned !== 'agent' && t.due && t.due <= S.data.today);
  const was = left.map((t) => [t.id, { due: t.due, priority: t.priority }]);
  for (const t of left) { const k = S.plan.moveTo[t.id] || 'tomorrow'; await patch(t.id, k === 'someday' ? { due: null, priority: 'someday' } : { due: moveDate(k) }).catch(() => {}); }
  await api('POST', '/api/day/close', { date: S.data.today }).catch(() => {}); // the evening line: plan vs actual
  S.plan = null; location.hash = '#/today'; await load();
  toast(`Moved ${left.length}`, 'Undo', async () => { for (const [id, w] of was) await patch(id, w).catch(() => {}); load(); }, 8000);
}

// ---------- wins: up to 3 results by Sunday (05_model/focus.md → "## Week"); the quarter is the assistant's, read-only ----------
S.winEdit = null; // [{text, link, done}] while editing
// this week's wins: the Week section, or a "Next week" planned last week whose week has come (the server rolls it on the next save)
const thisWeek = () => { const f = S.data.focus; const w = f && [f.week, f.next].find((x) => x?.iso === f.current?.iso); return w?.items.length ? w.items : null; };
const nextWeek = () => { const f = S.data.focus; return f?.next && f.next.iso === f.nextWeek?.iso && f.next.items.length ? f.next.items : null; };
S.winTab = 'this'; // last | this | next
// last week's wins: the Week section not rolled yet (its week is over), else Previous week
const lastWeek = () => { const f = S.data.focus; const s = f?.week && f.week.iso !== f.current?.iso && f.week.iso < f.current.iso ? f.week : f?.previous; return s?.items?.length ? s : null; };
function winsLink() {
  const w = thisWeek();
  return hdLink('#/week', 'wins', w ? "This week's wins" : "Set this week's 3 wins", w ? `${w.filter((x) => x.done).length}/${w.length}` : '!', w ? '' : 'accent');
}
// "[[slug]]" → its title, linking inside the app where it can (project, decision, goal).
function winText(t, auto = null) {
  return esc(t).replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, slug, alias) => {
    const s = slug.trim(), p = S.data.projects.find((x) => x.slug === s), d = (S.data.decisions || []).find((x) => x.slug === s), g = (S.data.goalDetails || []).find((x) => x.slug === s);
    const t = taskById(s) || (S.logbook || []).find((x) => x.id === s), h = (S.data.focus?.targets || []).find((x) => x.slug === s);
    const label = esc(alias || p?.title || d?.question || g?.title || t?.title || h?.title || auto?.title || proj(s)?.title || S.data.areas?.find((a) => a.slug === s)?.title || s);
    const href = p ? `#/project/${s}` : d ? '#/decisions' : g ? '#/goals' : t || auto?.kind === 'task' ? `#/task/${encodeURIComponent(s)}` : h ? '#/day' : (obsidianUrl(s) || '#');
    return `<a class="wl" href="${href}">${label}</a>`;
  });
}
const splitLink = (text) => { const m = text.match(/^(.*?)\s*·\s*\[\[([^\]|]+)\]\]\s*$/); return m ? { text: m[1], link: m[2].trim() } : { text, link: '' }; };
function linkOptions(cur) {
  const o = (v, l) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`;
  const ps = S.data.projects.filter((p) => p.status === 'active'), ds = (S.data.decisions || []).filter((d) => d.status === 'open'), gs = S.data.goalDetails || [];
  return `<option value="">No link</option>${ps.length ? `<optgroup label="Projects">${ps.map((p) => o(p.slug, p.title)).join('')}</optgroup>` : ''}
    ${ds.length ? `<optgroup label="Decisions">${ds.map((d) => o(d.slug, d.question.slice(0, 60))).join('')}</optgroup>` : ''}
    ${gs.length ? `<optgroup label="Goals">${gs.map((g) => o(g.slug, g.title)).join('')}</optgroup>` : ''}
    ${winTargetsOptions(cur, o)}`;
}
// a win can also be counted by itself: a task (won when it's done), a protocol or a habit (won when closed / done on N
// days of the week, N from the text: "× 3", "3 days"; lib/wins.js)
function winTargetsOptions(cur, o) {
  const T = S.data.focus?.targets || [];
  const seen = new Set(), tasks = [...S.data.tasks.filter((t) => t.status !== 'done' || t.id === cur), ...(S.logbook || []).slice(0, 40)].filter((t) => !seen.has(t.id) && seen.add(t.id));
  if (cur && !tasks.some((t) => t.id === cur) && !T.some((x) => x.slug === cur) && /^\d{8}-/.test(cur)) tasks.unshift({ id: cur, title: cur });
  return `${T.length ? `<optgroup label="Protocols and habits (counted)">${T.map((x) => o(x.slug, x.title)).join('')}</optgroup>` : ''}
    ${tasks.length ? `<optgroup label="Tasks (won when done)">${tasks.map((t) => o(t.id, `${t.status === 'done' ? '✓ ' : ''}${t.title.slice(0, 60)}`)).join('')}</optgroup>` : ''}`;
}
// what counted a win by itself: its task, or how many days its protocol / habit made it
const winAutoHtml = (a) => (!a ? '' : `<span class="win-auto ${a.done ? 'ok' : ''}" title="Counted from the ${a.kind}${a.title ? `: ${esc(a.title)}` : ''}">${a.kind === 'task' ? (a.done ? '✓ task done' : 'task open') : `${a.have}/${a.need} days`}</span>`);
function weekHtml() {
  const f = S.data.focus;
  if (!f) return '<div class="empty">No 05_model/focus.md yet.</div>'; // also the first paint before /api/state
  const last = lastWeek();
  if (S.winTab === 'last' && !last) S.winTab = 'this';
  const isNext = S.winTab === 'next', isLast = S.winTab === 'last', w = isNext ? nextWeek() : isLast ? last.items : thisWeek();
  if (!w && !S.winEdit) S.winEdit = [0, 1, 2].map(() => ({ text: '', link: '', done: false })); // empty week: ask for the wins
  const edit = S.winEdit;
  const wk = (x) => x.iso.replace(/^\d{4}-/, ''), range = (x) => x.label.replace(/^\d{4}-W\d+,\s*/, '');
  const tabs = `<span class="seg win-tabs">${last ? `<button class="${isLast ? 'on' : ''}" data-act="win-tab" data-tab="last">Last · ${esc(last.iso ? last.iso.replace(/^\d{4}-/, '') : '')}</button>` : ''}<button class="${isNext || isLast ? '' : 'on'}" data-act="win-tab" data-tab="this">${last ? 'This' : 'This week'} · ${esc(wk(f.current))}</button><button class="${isNext ? 'on' : ''}" data-act="win-tab" data-tab="next">${last ? 'Next' : 'Next week'} · ${esc(wk(f.nextWeek))}</button></span>
    <div class="week-h">${esc(isLast ? (last.label || '').replace(/^\d{4}-W\d+,\s*/, '') : range(isNext ? f.nextWeek : f.current))}</div>`;
  // Fri–Sun: nudge to plan the next week once this one is set
  const nudge = !isNext && !edit && !nextWeek() && (new Date().getDay() - (S.settings?.weekStart === 'sunday' ? 0 : 1) + 7) % 7 >= 4 ? '<button class="linkbtn win-next" data-act="win-tab" data-tab="next">Plan next week’s wins →</button>' : '';
  let main;
  if (edit) {
    main = `<div class="win-form">${w ? '' : `<p class="win-ask">${isNext ? 'What will next week’s 3 wins be? Results by Sunday, not activities — #1 matters most.' : 'What are this week’s 3 wins? Results by Sunday, not activities — #1 matters most.'}</p>`}
      ${edit.map((x, i) => `<div class="win-row edit"><span class="win-n">${i + 1}</span><div class="win-fields">
        <input class="win-in" data-i="${i}" value="${esc(x.text)}" placeholder="${['WIN #1 — e.g. Tax return filed', 'e.g. First 5 km run done', 'e.g. Summer holiday booked'][i]}" autocomplete="off">
        <select class="win-link" data-i="${i}">${linkOptions(x.link)}</select></div>
        <span class="win-move">${i ? `<button data-act="win-up" data-i="${i}" title="Move up">↑</button>` : ''}${i < edit.length - 1 ? `<button data-act="win-down" data-i="${i}" title="Move down">↓</button>` : ''}</span></div>`).join('')}
      ${winSuggestions()}
      <div class="win-acts">${w ? '<button class="btn" data-act="win-cancel">Cancel</button>' : ''}<button class="btn primary" data-act="win-save">Commit to these wins</button></div></div>`;
  } else {
    main = `<div class="wins">${w.map((x, i) => `<div class="win-row ${x.done ? 'done' : ''}"><span class="win-n">${i + 1}</span>
        ${isNext ? '' : `<button class="check ${x.done ? 'done' : ''}" data-act="win-check" data-i="${i}" aria-label="${x.done ? 'Not done' : 'Done'}"${x.auto?.done ? ' disabled title="Counted as won"' : ''}></button>`}
        <div class="win-t">${winText(x.text, x.auto)}${winAutoHtml(x.auto)}</div></div>`).join('')}
      ${isLast ? '' : ''}${(isLast ? null : isNext ? f.next : [f.week, f.next].find((x) => x?.iso === f.current.iso))?.committed ? `<div class="win-committed">✓ Committed · ${esc(new Date(`${(isNext ? f.next : [f.week, f.next].find((x) => x?.iso === f.current.iso)).committed}:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }))}</div>` : ''}
      <button class="linkbtn" data-act="win-edit">Edit wins</button>${nudge}</div>`;
  }
  const q = f.quarter?.items?.length ? `<div class="week-q"><div class="lbl">This quarter${f.quarter.label ? ` · ${esc(f.quarter.label)}` : ''}</div>
    <ul>${f.quarter.items.map((x) => `<li>${winText(x.text)}</li>`).join('')}</ul></div>` : '';
  return `<div class="week">${tabs}${main}${isLast ? '' : q}</div>`;
}
// "Commit to these wins" (after Heroic's daily commit): a full-screen oath with the wins and a ring to HOLD for 1.2 s;
// then the screen floods red → COMMITTED, the streak (weeks committed in a row) and wins achieved count up → Let's go.
// Saving happens only when the hold completes. Haptics in the iPhone app; reduced motion: no flood or count-up.
const haptic = (kind) => { window.webkit?.messageHandlers?.gubernos?.postMessage({ op: 'haptic', kind })?.catch?.(() => {}); navigator.vibrate?.(kind === 'success' ? [30, 40, 60] : 10); };
function commitScreen(items, next) {
  const f = S.data.focus, week = next ? f.nextWeek : f.current;
  const plain = (t) => winPlain(splitLink(t).text);
  const el = document.createElement('div');
  el.className = 'commit-screen';
  el.innerHTML = `<div class="cs-top"><button class="cs-later" data-cs="close">Not yet</button></div>
    <div class="cs-body">
      <h1>${next ? 'Next week’s' : 'This week’s'}<br>wins</h1>
      <p class="cs-sub">${esc(week.iso.replace(/^\d{4}-/, ''))} · ${esc(week.label.replace(/^\d{4}-W\d+,\s*/, ''))}</p>
      <ol class="cs-wins">${items.map((x) => `<li>${plain(x.text)}</li>`).join('')}</ol>
      <button class="cs-hold" aria-label="Hold to commit"><svg viewBox="0 0 120 120"><circle class="cs-track" cx="60" cy="60" r="54"/><circle class="cs-ring" cx="60" cy="60" r="54"/></svg><span>${matchMedia('(hover: hover) and (pointer: fine)').matches ? 'CLICK &amp;<br>HOLD' : 'HOLD TO<br>COMMIT'}</span></button>
      <p class="cs-oath">I commit to these results by Sunday.</p>
      ${matchMedia('(hover: hover) and (pointer: fine)').matches ? '<p class="cs-hint">Keep the mouse pressed — or hold Space</p>' : ''}
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 300); };
  el.querySelector('[data-cs="close"]').onclick = close;
  const btn = el.querySelector('.cs-hold'), HOLD = 1200;
  let t0 = 0, raf = 0, done = false;
  const tick = () => {
    const p = Math.min(1, (performance.now() - t0) / HOLD);
    btn.style.setProperty('--p', p);
    if (p >= 1) return finish();
    raf = requestAnimationFrame(tick);
  };
  const start = (e) => { if (done) return; e.preventDefault(); haptic('light'); btn.classList.add('holding'); t0 = performance.now(); raf = requestAnimationFrame(tick); };
  const stop = () => { if (done) return; cancelAnimationFrame(raf); btn.classList.remove('holding'); btn.style.setProperty('--p', 0); };
  btn.addEventListener('pointerdown', start);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, stop));
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  // desktop: hold Space or Enter (key repeat is ignored); Esc = not yet
  const onKey = (e) => {
    if (!el.isConnected) return document.removeEventListener('keydown', onKey), document.removeEventListener('keyup', onKeyUp);
    if (e.key === 'Escape' && !done) return close();
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) start(e);
    else if (e.key === ' ' || e.key === 'Enter') e.preventDefault();
  };
  const onKeyUp = (e) => { if (e.key === ' ' || e.key === 'Enter') stop(); };
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onKeyUp);
  btn.focus({ preventScroll: true });
  async function finish() {
    done = true;
    haptic('success');
    const r = btn.getBoundingClientRect();
    el.style.setProperty('--fx', `${r.left + r.width / 2}px`); el.style.setProperty('--fy', `${r.top + r.height / 2}px`);
    el.classList.add('flood');
    try { await saveWins(items, next, true); } catch { el.classList.remove('flood'); done = false; btn.style.setProperty('--p', 0); return; }
    const st = S.data.focus.commitStats || { streak: 1, achieved: 0 };
    setTimeout(() => {
      el.querySelector('.cs-body').innerHTML = `<p class="cs-kicker">Weekly commitment</p><h1 class="cs-big">Committed!</h1>
        <div class="cs-stats"><div><b data-count="${st.streak}">${st.streak}</b><span>week${st.streak === 1 ? '' : 's'} in a row</span></div><div><b data-count="${st.achieved}">${st.achieved}</b><span>wins achieved</span></div></div>
        <ul class="cs-done">${items.map((x, i) => `<li><small>WIN #${i + 1}</small>${plain(x.text)}<i>✓</i></li>`).join('')}</ul>
        <button class="cs-go" data-cs="close">Let’s go!</button>`;
      el.classList.add('summary');
      el.querySelector('.cs-go').onclick = close;
      el.querySelector('.cs-go').focus({ preventScroll: true });
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
        el.querySelectorAll('[data-count]').forEach((b) => { // count up from one less, like a ticking counter
          const to = +b.dataset.count, from = Math.max(0, to - 1);
          b.textContent = from;
          setTimeout(() => { b.textContent = to; b.classList.add('tick'); }, 650);
        });
      }
    }, 650);
  }
}
// What's typed in the wins form right now (the form re-renders on reorder).
function syncWinEdit() {
  const ins = $$('.win-in'), links = $$('.win-link');
  if (!ins.length) return;
  S.winEdit = ins.map((x, i) => ({ text: x.value, link: links[i]?.value || '', done: S.winEdit?.[i]?.done || false }));
}
// "[[slug]]" → its title as plain text (inside a button a link would navigate away)
const winPlain = (t) => esc(t.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, slug, alias) => alias || S.data.projects.find((x) => x.slug === slug.trim())?.title || slug.trim().replace(/-/g, ' ')));
const suggSplit = (t) => { const m = t.match(/^(.*?)\s*·?\s*\[\[([^\]|]+)\]\]\s*$/); return m ? { text: m[1].replace(/[\s·:—-]+$/, ''), link: m[2] } : { text: t, link: '' }; };
// Suggestions from the weekly review file's "## Focus Next Week" (lib/review.js); tap one → it fills the next empty win.
function winSuggestions() {
  if (S.winSugg === undefined) { S.winSugg = null; api('GET', '/api/focus/suggestions').then((r) => { S.winSugg = r; if (S.view === 'week') renderMain(); }).catch(() => {}); }
  const r = S.winSugg, used = new Set((S.winEdit || []).map((x) => x.text.trim()));
  const items = (r?.items || []).filter((x) => !used.has(suggSplit(x.text).text));
  if (!items.length) return '';
  return `<div class="win-sugg"><div class="lbl">From your weekly review · ${esc(r.file.replace(/^50_reviews\//, '').replace(/\.md$/, ''))}</div>
    ${items.map((x) => `<button class="chip" data-act="win-sugg" data-text="${esc(x.text)}">${x.area ? `<span class="muted">${esc(x.area)} ·</span> ` : ''}${winPlain(x.text)}</button>`).join('')}</div>`;
}
async function saveWins(items, next = false, commit = false, past = null) {
  S.data.focus = await api('PUT', '/api/focus/week', { items, next, commit, past });
  S.winEdit = null;
  render();
}
document.addEventListener('input', (e) => { if (e.target.matches('.win-in')) syncWinEdit(); });
document.addEventListener('change', (e) => { if (e.target.matches('.win-link')) syncWinEdit(); });

// ---------- weekly review: get clear, get current, look ahead; notes go to 50_reviews/ (lib/review.js) ----------
async function loadWeekly() { S.weekly = await api('GET', '/api/weekly').catch(() => null); if (S.view === 'weekly') renderMain(); }
function weeklyHtml() {
  const r = S.weekly;
  if (!r) return '<div class="empty">Loading the week…</div>';
  const day = (d) => fromIso(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  // open tasks open in place; done ones (archived) are plain text
  const tl = (t) => (taskById(t.id) ? `<a href="#" data-act="wr-open" data-id="${esc(t.id)}">${inline(t.title)}</a>` : inline(t.title));
  const step = (n, title, ok, inner) => `<section class="wr-step ${ok ? 'ok' : ''}"><div class="wr-h"><span class="wr-n">${ok ? '✓' : n}</span>${title}</div>${inner ? `<div class="wr-b">${inner}</div>` : ''}</section>`;
  const list = (xs, f, more = 6) => xs.length ? `<ul>${xs.slice(0, more).map((x) => `<li>${f(x)}</li>`).join('')}${xs.length > more ? `<li class="muted">+${xs.length - more} more</li>` : ''}</ul>` : '';
  const done = r.done.filter((t) => !t.dropped), dropped = r.done.length - done.length, byAgents = r.done.filter((t) => t.agent).length;
  const wins = r.wins ? `<ul class="wr-wins">${r.wins.map((x) => `<li class="${x.done ? 'done' : ''}">${x.done ? '✓' : '✗'} ${winText(x.text)}</li>`).join('')}</ul>` : '<p class="muted">No wins were set for this week.</p>';
  const looked = `${done.length} done${dropped ? ` · ${dropped} dropped` : ''}${byAgents ? ` · ${byAgents} by agents` : ''}`;
  const n = r.notes || {};
  const ta = (k, label, ph) => `<label class="wr-note"><span>${label}</span><textarea data-wr="${k}" rows="2" placeholder="${ph}">${esc(S.wrDraft?.[k] ?? n[k] ?? '')}</textarea></label>`;
  return `<div class="wr"><div class="week-h">${esc(r.week.label.replace(/^\d{4}-W(\d+),\s*/, 'Week $1 · '))}</div>
    ${step(1, `Look back · ${looked}`, false, `<div class="wr-lbl">Wins</div>${wins}${weekDaysHtml(r.days)}${done.length ? `<div class="wr-lbl">Done</div>${list(done, tl, 8)}` : ''}${(r.reflections || []).length ? `<div class="wr-lbl">Daily reflections · ${r.reflections.length}</div>${r.reflections.map((x) => `<details class="wr-refl"><summary>${esc(fromIso(x.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }))}</summary>${x.items.map((i) => `<p><b>${esc(i.label)}</b> ${esc(i.text)}</p>`).join('')}</details>`).join('')}` : ''}`)}
    ${step(2, `Inbox to zero · ${r.inbox + r.unfiled ? `${r.inbox} notes, ${r.unfiled} tasks without a project` : 'empty'}`, !(r.inbox + r.unfiled), r.inbox + r.unfiled ? '<a class="btn" href="#/inbox">Open Inbox</a> <button class="btn" data-act="mode-inbox">Process one by one</button>' : '')}
    ${step(3, `Overdue · ${r.overdue.length || 'none'}`, !r.overdue.length, r.overdue.length ? `<p class="muted">Do, move or drop each — swipe left to move.</p>${list(r.overdue, (t) => `${tl(t)} <span class="muted">· ${day(t.due)}</span>`)}<a class="btn" href="#/today">Open Today</a>` : '')}
    ${step(4, `Waiting for others · ${r.waiting.length || 'none'}`, !r.waiting.length, list(r.waiting, (t) => `${tl(t)} <span class="muted">· nudge them?</span>`))}
    ${step(5, `Agent work to review · ${r.toReview || 'none'}`, !r.toReview, r.toReview ? '<button class="btn" data-act="mode-review">Review one by one</button>' : '')}
    ${step(6, `Projects without a next action · ${r.stuck.length || 'none'}`, !r.stuck.length, r.stuck.length ? `<p class="muted">Add the next step, or close the project.</p>${list(r.stuck, (p) => `<a href="#/project/${encodeURIComponent(p.slug)}">${esc(p.title)}</a>`, 10)}` : '')}
    ${step(7, `Decisions waiting · ${r.decisions.length || 'none'}`, !r.decisions.length, r.decisions.length ? `${list(r.decisions, (d) => `${esc(d.question)}${d.decide_by ? ` <span class="muted">· by ${day(d.decide_by)}</span>` : ''}`, 4)}<a class="btn" href="#/decisions">Open Decisions</a>` : '')}
    ${step(8, `Next two weeks · ${r.deadlines.length + r.comingUp.length || 'nothing due'}`, false, list([...r.deadlines.map((t) => `${tl(t)} <span class="muted">· deadline ${day(t.deadline)}</span>`), ...r.comingUp.map((x) => `${esc(x.title)} <span class="muted">· ${x.type} · ${day(x.date)}</span>`)], (h) => h, 10))}
    ${step(9, `Someday · ${r.someday}`, false, r.someday ? '<p class="muted">Skim it: anything to start now, or to drop?</p><a class="btn" href="#/someday">Open Someday</a>' : '')}
    ${step(10, 'Next week’s wins', false, `<a class="btn" href="${r.week.iso === S.data.focus?.current?.iso ? '#/week/next' : '#/week'}">Set next week’s wins</a>`)}
    <section class="wr-step notes"><div class="wr-h"><span class="wr-n">✎</span>Notes</div><div class="wr-b">
      ${ta('well', 'What went well', 'Small things count')}${ta('didnt', 'What didn’t go well', 'And why')}${ta('change', 'What to change next week', 'One or two things')}
      <div class="win-acts"><span class="muted wr-file">${r.exists ? 'Saved in' : 'Saves to'} ${esc(r.file)}</span><button class="btn primary" data-act="wr-save">Save review</button></div></div></section></div>`;
}
// The week's days (#1 done → won, the plan, the score) and habits: done of the days they were due
function weekDaysHtml(w) {
  if (!w) return '';
  const lvl = (v) => (v == null ? '' : scoreLevel(v)?.[1] || '');
  const won = w.days.filter((d) => d.one).length, withOne = w.days.filter((d) => d.one != null).length;
  const mp = w.days.filter((d) => d.score != null && d.score >= 9).length;
  const planned = w.days.reduce((n, d) => n + d.planned, 0), done = w.days.reduce((n, d) => n + d.done, 0);
  const days = `<div class="wr-lbl">My days · won ${won}/${withOne || 7}${mp ? ` · best ${mp}` : ''}${planned ? ` · plan ${done}/${planned}` : ''}</div>
    <div class="wr-days">${w.days.map((d) => `<a class="wr-day ${d.one ? 'won' : ''}" href="#/day/${d.date}"><b>${esc(fromIso(d.date).toLocaleDateString('en-GB', { weekday: 'short' }))}</b>
      <span>${d.one == null ? '·' : d.one ? '#1 ✓' : '#1 ✗'}</span><span>${d.planned ? `${d.done}/${d.planned}` : ''}</span><small>${esc(lvl(d.score))}</small></a>`).join('')}</div>`;
  const good = w.habits.filter((h) => h.good), needs = w.habits.filter((h) => !h.good);
  const hl = (h) => `${esc(h.title)} <span class="muted">${h.done}/${h.due}${h.perWeek ? ' a week' : ''}</span>`;
  const habits = w.habits.length ? `<div class="wr-lbl">Habits · on track ${good.length}/${w.habits.length}</div>
    <div class="wr-habits"><div><b>On track</b>${good.map((h) => `<div>${hl(h)}</div>`).join('') || '<div class="muted">—</div>'}</div><div><b>Needs work</b>${needs.map((h) => `<div>${hl(h)}</div>`).join('') || '<div class="muted">—</div>'}</div></div>` : '';
  return days + habits;
}
document.addEventListener('input', (e) => { if (e.target.matches('[data-wr]')) (S.wrDraft ||= {})[e.target.dataset.wr] = e.target.value; });
async function saveWeeklyNotes() {
  const notes = Object.fromEntries($$('[data-wr]').map((x) => [x.dataset.wr, x.value]));
  if (!Object.values(notes).some((v) => v.trim())) return toast('Write at least one note');
  S.weekly = await api('PUT', '/api/weekly', { notes });
  S.wrDraft = null;
  toast('Review saved');
  renderMain();
}

// ---------- feedback about the app: from any screen (menu, ⌘K, voice "баг: …"); lib/feedback.js ----------
const FEEDBACK_RE = /^\s*(баг|ошибка в приложении|фидб[еэ]к|bug|feedback|иде[яю] для приложения|app idea)\s*[:,.—-]?\s*/i;
function screenContext() {
  const t = taskById(S.openId), ua = navigator.userAgent;
  return { url: location.hash, view: S.view, arg: S.arg,
    screen: S.view === 'project' ? `Project “${proj(S.arg)?.title || S.arg}”` : VIEWS[S.view]?.title || S.view,
    openId: S.openId || null, openTitle: t?.title || null, focus: S.focus?.mode || null,
    viewport: `${innerWidth}x${innerHeight}`, device: /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Mac/.test(ua) ? 'Mac' : 'other',
    standalone: matchMedia('(display-mode: standalone)').matches || !!navigator.standalone,
    scroll: [$('#main')?.scrollTop || 0, Math.round(scrollY), $('#drawer')?.scrollTop || 0], theme: document.documentElement.dataset.theme || 'auto', bodyClass: document.body.className.replace(/\bside-open\b/, '').trim(), ua };
}
// The page as it looks now (minus dialogs and the open menu): the developer renders it again with app.css.
function screenSnapshot() {
  const b = document.body.cloneNode(true);
  b.querySelectorAll('script, #modal > *, #toast > *').forEach((x) => x.remove());
  const live = [...document.body.querySelectorAll('input, textarea')], copies = [...b.querySelectorAll('input, textarea')];
  live.forEach((x, i) => { if (copies[i] && x.type !== 'file') copies[i].setAttribute('value', x.value); }); // what was typed
  return b.innerHTML;
}
// share: someone else's install publishes screenshots and the snapshot when ticked: on by default (otherwise nobody sends
// them), and the form says they show their tasks.
// There the report is a public GitHub issue, so a voice report opens the form (with the warning) instead of sending.
function reportByVoice(kind, text) {
  if (!ME().feedbackRemote) return sendFeedback({ kind, text });
  closeModal(); reportModal(kind, text);
}
async function sendFeedback({ kind = 'bug', text = '', images = [], snapshot = screenSnapshot(), context = screenContext(), share = false }) {
  await api('POST', '/api/feedback', { kind, text, images, snapshot, context, errors: ERRS, share });
  toast(ME().feedbackRemote ? `${kind === 'idea' ? 'Idea' : 'Bug'} sent to the developer — answers come back to the task` : `${kind === 'idea' ? 'Idea' : 'Bug'} sent — Claude sees it with this screen`);
  load();
}
// A screenshot from Photos, downsized to a JPEG (≤1600 px) so it travels light.
const shrinkImage = (file) => new Promise((ok, no) => {
  const img = new Image();
  img.onload = () => {
    const k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(img.src); ok(c.toDataURL('image/jpeg', 0.85));
  };
  img.onerror = () => no(new Error('cannot read the image'));
  img.src = URL.createObjectURL(file);
});
function reportModal(kind = 'bug', text = '') {
  document.body.classList.remove('side-open');
  const snapshot = screenSnapshot(), context = screenContext(); // the screen as it was, before the dialog
  let images = [];
  $('#modal').innerHTML = `<div class="overlay" data-act="qa-close"><div class="qa pm fb">
    <div class="bd-h">Report a bug or idea</div>
    <span class="seg fb-kind"><button type="button" data-k="bug">Bug</button><button type="button" data-k="idea">Idea</button></span>
    <textarea id="fb-text" rows="4" placeholder="What happened, or what would be better? (the keyboard mic dictates)">${esc(text)}</textarea>
    ${ME().feedbackRemote ? `<div class="fb-ctx fb-public">🌐 <b>Public:</b> it becomes an issue in <a href="https://github.com/${esc(ME().feedbackRepo || '')}/issues" target="_blank" rel="noopener">${esc(ME().feedbackRepo || 'the app’s repo')}</a> under your GitHub account, and anyone can read it. Leave out private details. It holds your text, the screen name (${esc(context.screen)}), the device and errors.</div>`
      : `<div class="fb-ctx">📍 ${esc(context.screen)}${context.openTitle ? ` · ${esc(context.openTitle.slice(0, 50))}` : ''} — a snapshot of this screen goes along</div>`}
    <div class="fb-imgs"><label class="btn ghost">+ Screenshot<input type="file" id="fb-files" accept="image/*" multiple hidden></label><span id="fb-n" class="fb-ctx"></span></div>
    ${ME().feedbackRemote ? `<label class="fb-ctx fb-share"><input type="checkbox" id="fb-share" checked> Publish screenshots with it: this screen, and the ones you add. They show your tasks, and anyone with the link can see them. Untick to send only the text.</label>` : ''}
    <div class="foot"><span class="sp"></span><button class="btn" data-act="qa-close">Cancel</button><button class="btn primary" id="fb-send">Send</button></div></div></div>`;
  const setKind = (k) => { kind = k; $$('.fb-kind button').forEach((b) => b.classList.toggle('on', b.dataset.k === k)); };
  $$('.fb-kind button').forEach((b) => { b.onclick = () => setKind(b.dataset.k); });
  setKind(kind);
  $('#fb-files').onchange = async (e) => {
    try { images = [...images, ...(await Promise.all([...e.target.files].slice(0, 3).map(shrinkImage)))].slice(0, 3); } catch (err) { toast(err.message); }
    $('#fb-n').textContent = images.length ? `${images.length} screenshot${images.length > 1 ? 's' : ''} attached${ME().feedbackRemote ? ' — published unless you untick below' : ''}` : '';
  };
  $('#fb-text').focus(); $('#fb-text').setSelectionRange(text.length, text.length);
  $('#fb-send').onclick = async () => {
    const text = $('#fb-text').value.trim();
    if (!text && !images.length) return $('#fb-text').focus();
    $('#fb-send').disabled = true;
    try { await sendFeedback({ kind, text, images, snapshot, context, share: !!$('#fb-share')?.checked }); closeModal(); } catch { $('#fb-send').disabled = false; }
  };
}

// ---------- daily reflection: three short answers at the end of the day (lib/reflection.js → 50_reviews/daily/) ----------
const REFLECT_FORMATS = {
  esp: [['effort', 'Effort', 'Your moment of honest, hard work today — what you could control and the energy you put in.'],
    ['success', 'Success', 'A moment you got something right, however small.'],
    ['progress', 'Progress', 'How you got better compared to past attempts.']],
  journal: [['well', 'What went well', ''], ['needs', 'What needs work', ''], ['tomorrow', 'What to improve tomorrow', '']],
};
async function loadReflection(date) {
  S.reflect = { loading: true, date };
  try { S.reflect = { ...(await api('GET', `/api/reflection?date=${date}`)) }; } catch { S.reflect = { date, answers: {}, error: true }; }
  if (!S.reflect.format) S.reflect.format = S.settings?.reflectionFormat || 'esp';
  if (S.view === 'reflect') renderMain();
}
function reflectHtml() {
  const R = S.reflect;
  if (!R || R.loading) return '<div class="empty">…</div>';
  const day = fromIso(R.date), shift = (n) => { const d = new Date(day); d.setDate(d.getDate() + n); return iso(d); };
  const isToday = R.date === S.data.today;
  const fields = REFLECT_FORMATS[R.format] || REFLECT_FORMATS.esp;
  return `<div class="rf">
    <div class="rf-day"><a class="icon-btn" href="#/reflect/${shift(-1)}" aria-label="Previous day">‹</a>
      <b>${isToday ? 'Today' : esc(day.toLocaleDateString('en-GB', { weekday: 'long' }))}</b> · ${esc(day.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}
      ${isToday ? '' : `<a class="icon-btn" href="#/reflect/${shift(1)}" aria-label="Next day">›</a>`}</div>
    ${reflectDayHtml(R.date)}
    <span class="seg rf-format">${[['esp', 'E-S-P'], ['journal', 'Journal']].map(([k, l]) => `<button data-act="rf-format" data-val="${k}" class="${R.format === k ? 'on' : ''}">${l}</button>`).join('')}</span>
    ${fields.map(([k, label, hint]) => `<label class="rf-q"><span class="rf-l">${label}</span>${hint ? `<small>${hint}</small>` : ''}
      <span class="rf-in"><textarea id="rf-${k}" data-rf="${k}" rows="3" placeholder="${isToday ? 'Type, or hold the mic and speak' : ''}">${esc(R.draft?.[k] ?? R.answers?.[k] ?? '')}</textarea>
      <button type="button" class="rf-mic" data-voice data-dictate="rf-${k}" aria-label="Dictate"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4"/></svg></button></span></label>`).join('')}
    <label class="rf-q"><span class="rf-l">Three thank-yous</span><small>Who or what are you grateful for today? Name the person or the moment, and what it gave you. One is enough.</small>
      ${[0, 1, 2].map((i) => { const k = `g${i}`; return `<span class="rf-in rf-g"><textarea id="rf-${k}" data-rfg="${i}" rows="1" placeholder="Thank you, …">${esc(R.gdraft?.[i] ?? R.gratitude?.[i] ?? '')}</textarea>
      <button type="button" class="rf-mic" data-voice data-dictate="rf-${k}" aria-label="Dictate"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4"/></svg></button></span>`; }).join('')}</label>
    <div class="win-acts"><span class="muted rf-saved">${R.exists ? `Saved in ${esc(R.file)}` : 'Under five minutes. Saved to 50_reviews/daily/.'}</span><button class="btn primary" data-act="rf-save">${R.exists ? 'Update' : 'Save reflection'}</button></div>
  </div>`;
}
// The day at a glance above the answers: plan vs actual, #1, habits — and the evening protocol to tick off.
function reflectDayHtml(date) {
  const D = S.day;
  if (!D || D.loading || D.error || D.date !== date) return '';
  const p = D.plan, bits = [];
  if (p?.tasks.length) bits.push(`Plan ${p.tasks.filter((x) => x.done).length}/${p.tasks.length}${p.line?.moved ? ` · ${p.line.moved} moved` : ''}${p.added.length ? ` · +${p.added.length} added later` : ''}`);
  if (p?.one) bits.push(D.oneDone ? `<span class="d-today">Day won ✓</span> #1 done${D.oneStreak ? ` · streak ${D.oneStreak}` : ''}` : '#1 not done');
  const hs = (D.summary || []).map((g) => `${esc(g.name)} ${g.done}/${g.total}`).join(' · ');
  if (hs) bits.push(`<a href="#/day/${date}">${hs}</a>`);
  const close = closeDayHtml(D);
  if (!bits.length && !close) return '';
  return `<div class="day rf-dayline">${bits.length ? `<div class="day-line">${bits.join('<br>')}</div>` : ''}${close}</div>`;
}
// Closing the day on Daily reflection: the habits checked here (e.g. Score your day) and tomorrow's #1 — choosing it is the
// "plan the next day" habit (checkin: next-one); in the morning Plan the day starts from it.
function closeDayHtml(D) {
  const here = D.habits.filter((h) => h.checkin === 'reflection' || h.checkin === 'by-reflection'), next = D.habits.find((h) => h.checkin === 'next-one');
  const isToday = D.date === S.data.today;
  if (!here.length && !next && !isToday) return '';
  const tm = (() => { const d = fromIso(D.date); d.setDate(d.getDate() + 1); return iso(d); })();
  let one = '';
  if (isToday) {
    const chosen = D.tomorrowOne;
    if (chosen && !S.tmEdit) one = `<div class="plan-row"><span class="check done" aria-hidden="true"></span><div class="plan-main"><div class="plan-t"><b class="one-n">#1</b> tomorrow: ${inline(chosen.text)}</div>
      <div class="plan-meta">${chainHtml(goalChain(chosen.link))}<span>Plan the day starts from it</span><button class="linkbtn" data-act="tm-edit">change</button></div></div></div>`;
    else {
      if (!S.tmPick) S.tmPick = chosen ? { text: chosen.text, link: chosen.link } : { text: '', link: null };
      one = `<div class="one-card edit"><b class="one-n">#1</b><div class="plan-main">
        <input id="tm-in" class="one-in" placeholder="Tomorrow’s #1 — the one result that will make it a win" value="${esc(S.tmPick.text || '')}">
        <div class="plan-meta">${S.tmPick.link ? chainHtml(goalChain(S.tmPick.link)) : S.tmPick.text ? '<span>your own words — a new task on Set</span>' : `<span>${next ? esc(next.title) : 'Choose it tonight'} — pick or type</span>`}</div>
        ${onePickerHtml(oneChoices(D.plan?.tasks?.filter((x) => !x.done).map((x) => x.id) || [], tm), S.tmPick, 'tm-pick')}</div>
        <div class="one-btns"><button class="btn primary" data-act="tm-set">Set for tomorrow</button>${chosen ? '<button class="btn ghost" data-act="tm-cancel">Cancel</button>' : ''}</div></div>`;
    }
  }
  return `<div class="section day-sec"><div class="section-h day-h">Close the day${D.reflection?.total ? ` <span class="c">${D.reflection.done}/${D.reflection.total}</span>` : ''}</div>
    ${here.map((h) => habitRow(h, D)).join('')}${one}</div>`;
}
document.addEventListener('input', (e) => { if (['tm-in', 'one-in', 'plan-one'].includes(e.target.id)) oneSearch(e.target); });
document.addEventListener('input', (e) => {
  if (e.target.id === 'tm-in' && S.tmPick) { S.tmPick = { text: e.target.value, link: e.target.value.trim() === (S.tmPick.picked ?? S.tmPick.text).trim() ? S.tmPick.link : null, picked: S.tmPick.picked ?? S.tmPick.text }; return; }
  if (e.target.id === 'one-in' && S.onePick) { S.onePick = { text: e.target.value, link: e.target.value.trim() === S.onePick.picked ? S.onePick.link : null, picked: S.onePick.picked ?? S.onePick.text }; return; }
  if (!S.plan?.draft) return;
  // your own words for #1: no longer linked to the task / win it came from (unless typed back exactly)
  if (e.target.id === 'plan-one') { const v = e.target.value, P = S.plan, was = P.onePicked ?? P.one?.text; P.onePicked = was; P.one = v.trim() ? { text: v, link: v.trim() === was?.trim() ? P.one?.link || P.oneLink || null : null } : null; if (P.one?.link) P.oneLink = P.one.link; }
});
document.addEventListener('input', (e) => {
  if (e.target.matches('[data-rf]') && S.reflect) (S.reflect.draft ||= {})[e.target.dataset.rf] = e.target.value;
  if (e.target.matches('[data-rfg]') && S.reflect) (S.reflect.gdraft ||= [...(S.reflect.gratitude || [])])[+e.target.dataset.rfg] = e.target.value;
});
async function saveReflection() {
  const R = S.reflect;
  const answers = Object.fromEntries($$('[data-rf]').map((x) => [x.dataset.rf, x.value]));
  const gratitude = $$('[data-rfg]').map((x) => x.value);
  if (![...Object.values(answers), ...gratitude].some((v) => v.trim())) return toast('Write at least one answer');
  S.reflect = { ...(await api('PUT', '/api/reflection', { date: R.date, format: R.format, answers, gratitude })) };
  if (R.date === S.data.today) { S.data.reflectedToday = true; S.remindersSent = null; syncNativeReminders(); }
  toast('Reflection saved');
  loadDay(R.date);
  renderMain();
}

// ---------- the day (Masterpiece Day): #1, AM / PM protocols, the plan, habits — vault 50_reviews/daily/<date>.md ----------
// Habits and protocols come from 05_model/habits/ and 05_model/protocols/; the module can be switched off in Settings.
S.day = null; S.dayTab = 'today'; S.hbOpen = new Set(); S.protoOpen = new Set(); S.oneEdit = false;
async function loadDay(date = S.data.today) {
  if (!S.day || S.day.date !== date) S.day = { loading: true, date };
  try { S.day = await api('GET', `/api/day?date=${date}`); } catch (e) { S.day = { date, error: e.message }; }
  if (['day', 'reflect'].includes(S.view)) renderMain();
}
const habitsOn = () => S.data.day?.enabled !== false && S.settings?.habits !== false;
const nowHM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const fmtNum = (n) => (n == null ? '' : Number(n).toLocaleString('en-GB').replace(/,/g, ' '));
// What something leads up to: a task → its project → the project's goal → the longer goals that goal serves; a want too.
function goalChain(slug, depth = 0) {
  const goals = S.data.goalDetails || [], out = [], seen = new Set();
  if (!slug || depth > 3) return out;
  const t = taskById(slug);
  if (t) return t.project ? goalChain(t.project, depth + 1) : out;
  const p = S.data.projects.find((x) => x.slug === slug);
  let g = p ? p.goal : goals.some((x) => x.slug === slug) ? slug : null;
  if (!p && !g) { const c = S.data.containers?.find((x) => x.slug === slug); if (c?.type === 'want') out.push({ slug, title: c.title, kind: 'want' }); return out; }
  while (g && !seen.has(g)) {
    seen.add(g);
    const gd = goals.find((x) => x.slug === g);
    if (!gd) break;
    out.push({ slug: g, title: gd.title, kind: 'goal' });
    g = (gd.serves || []).find((s) => goals.some((x) => x.slug === s));
  }
  return out;
}
const chainHtml = (c) => (c.length ? `<span class="goal-chain">→ ${c.map((x) => esc(x.title)).join(' → ')}</span>` : '');
// Today's #1 by default: this week's WIN #1 (the first win not achieved yet), without its link.
function winOne() {
  const w = thisWeek(), x = w?.find((i) => !i.done);
  if (!x) return null;
  const m = x.text.match(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/);
  return { text: x.text.replace(/\s*·?\s*\[\[[^\]]+\]\]/g, '').replace(/\s+by Sunday\b/i, '').trim(), link: m ? m[1].trim() : null };
}

// Today, on top: the day's #1 (tick it here; the title opens its task), or a nudge to set one.
function todayOneHtml() {
  const b = S.data.day;
  if (!b) return '';
  const one = b.one, t = one?.link ? taskById(one.link) : null;
  if (!one) return `<a class="one-card today-one unset" href="#/day"><b class="one-n">#1</b><span class="muted">Set today’s #1 — the one result that makes today a win</span></a>`;
  const title = one.text || t?.title || one.link;
  // Focus on #1; a #1 in your own words (or a win) becomes a task first (the server makes it, PUT /api/day/one)
  const go = b.oneDone || (t && !open(t)) ? '' : `<button class="s-focus" data-act="${t ? 'focus-start' : 'one-focus'}" ${t ? `data-id="${esc(t.id)}"` : ''} title="Focus on it" aria-label="Focus on it">${ICON.focus}</button>`;
  return `<div class="one-card today-one ${b.oneDone ? 'done' : ''}"><button class="check ${b.oneDone ? 'done' : ''}" data-act="today-one-done" aria-label="${b.oneDone ? 'Not done yet' : '#1 done'}"></button>
    <div class="plan-main">${t ? `<button class="plan-t" data-act="open-id" data-id="${esc(t.id)}">` : '<a class="plan-t" href="#/day">'}<b class="one-n">#1</b> ${inline(title)}${t ? '</button>' : '</a>'}
      ${t?.woop?.plan && !b.oneDone ? `<div class="one-woop">↯ ${woopPlanHtml(t.woop.plan)}</div>` : ''}
      <div class="plan-meta">${chainHtml(goalChain(one.link))}${b.oneStreak ? `<span>#1 streak ${b.oneStreak} day${b.oneStreak === 1 ? '' : 's'}</span>` : ''}${b.oneDone ? '<span class="d-today">day won</span>' : ''}</div></div>${go}</div>`;
}

// AICODE-NOTE: the Focus view of Today (Settings → Today → Focus view; was "Simple Today", setting `simple`; option B of the mockups, 2026-10-14): only the #1 and the tasks
// due today or overdue that aren't an agent's — waiting ones too, last (2026-10-20: they got lost) — in time order
// (today's blocks by their time, then the rest by priority), titles only, each with a Focus button. Deadlines stay on
// the full Today. No sidebar sections, chips, protocol, agents or day calendar; the header toggle switches it (saved).
const simpleOn = () => !!S.settings?.simple;
// the header toggle (same as Settings → Focus view; it is saved, so the iPhone follows)
// one button, pressed while the Focus view is on (a two-way switch made the header too wide on the phone)
const simpleBtn = () => hdBtn('simple-toggle', 'vfocus', simpleOn() ? 'Focus view is on: tap for the full Today' : 'Focus view: only the #1 and your tasks for today', `aria-pressed="${simpleOn()}"`, `vf${simpleOn() ? ' on' : ''}`);
function simpleTodayHtml() {
  flat = [];
  const today = S.data.today, oneId = S.data.day?.one?.link;
  const at = (t) => todayBlock(t.id, S.planFree)?.start?.slice(11) || '';
  const waits = (t) => t.status === 'wait';
  const T = S.data.tasks.filter((t) => (open(t) || pendingDone.has(t.id)) && t.assigned !== 'agent' && t.due && t.due <= today && t.id !== oneId)
    .sort((a, b) => waits(a) - waits(b) || (waits(a) ? 0 : (at(a) || '99').localeCompare(at(b) || '99')) || byPri(a, b));
  const row = (t) => {
    flat.push(t);
    const pend = pendingDone.get(t.id);
    return `<div class="row srow ${pend ? 'is-done' : ''} ${S.openId === t.id ? 'open' : ''}" data-id="${t.id}" data-i="${flat.length - 1}">
      <span class="s-tm">${waits(t) ? 'wait' : at(t)}</span><button class="check p-${t.priority} ${pend ? 'done' : ''}" data-act="complete" title="${pend ? 'Undo' : 'Complete'}"></button>
      <div class="row-main"><div class="row-title">${inline(t.title)}</div></div>
      ${pend ? `<button class="undo" data-act="undo" data-id="${t.id}">Undo <span class="cd">${Math.max(0, Math.ceil((pend.until - Date.now()) / 1000))}</span></button>`
        : `<button class="s-focus" data-act="focus-start" data-id="${t.id}" title="Focus on it" aria-label="Focus on it">${ICON.focus}</button>`}</div>`;
  };
  const n = `<span class="s-sub">${T.length} task${T.length === 1 ? '' : 's'}</span>`;
  if (wideUI()) $('#tb-tools').innerHTML = pomoLiveHtml(true) + simpleBtn(); // wide screens: the actions sit in the top bar (renderTop)
  return `<div class="page has-cal simple"><div class="page-h"><h1>Today</h1>${wideUI() ? n : `<div class="tools">${pomoLiveHtml(true)}${n}
      ${simpleBtn()}</div>`}</div>
    ${timerPillsHtml()}${todayOneHtml()}
    <div class="s-list">${T.map(row).join('') || '<div class="empty">Nothing else for today.</div>'}</div></div>`;
}
// Today: the protocol whose window is on now (or starts within the hour) — its progress and the next habit to tick;
// otherwise a quiet line to the Protocol screen.
function todayProtoHtml() {
  if (!habitsOn()) return '';
  const pills = timerPillsHtml();
  return pills + todayProtoLine();
}
function todayProtoLine() {
  const now = nowHM(), b = S.data.day;
  const p = (b?.protocols || []).find((x) => now < x.window.end && mins(x.window.start) - mins(now) <= 60);
  const g = p && (b.summary || []).find((x) => x.protocol === p.slug);
  if (!g || !g.total || g.done >= g.total) {
    // between the windows: one quiet line — the day's habits and the next protocol
    const d = (b?.summary || []).find((x) => !x.protocol), later = (b?.protocols || []).find((x) => x.window.start > now);
    const bits = [d?.total ? `Day habits ${d.done}/${d.total}` : '', later ? `${esc(later.title)} at ${later.window.start}` : ''].filter(Boolean);
    return bits.length ? `<a class="today-proto slim" href="#/day"><span class="tp-n">◐ Protocol</span> <span class="day-win">${bits.join(' · ')}</span></a>` : '';
  }
  const on = now >= p.window.start, nx = p.next;
  return `<div class="today-proto"><a class="tp-h" href="#/day"><span class="tp-n">◐ ${esc(p.title)}</span> <span class="day-win">${p.window.start}–${p.window.end}</span>
      <span class="c">${g.done}/${g.total}</span><span class="hint ${on ? 'd-today' : ''}">${on ? 'now' : `in ${planMins(mins(p.window.start) - mins(now))}`}</span></a>
    <div class="plan-bar day-bar"><span style="width:${Math.round((g.done / g.total) * 100)}%"></span></div>
    ${nx ? `<div class="tp-next"><button class="check" data-act="tp-check" data-slug="${esc(nx.slug)}" data-quit="${nx.quit ? 1 : ''}" aria-label="${nx.quit ? 'Kept' : 'Done'}"></button>
      <span>Next: <b>${esc(nx.title)}</b>${nx.cue ? ` · ${esc(nx.cue)}` : ''}</span></div>` : ''}</div>`;
}

function dayHtml() {
  const D = S.day;
  if (!D || D.loading) return '<div class="empty">…</div>';
  if (D.error) return `<div class="empty">Couldn’t read the day: ${esc(D.error)}</div>`;
  const day = fromIso(D.date), isToday = D.date === S.data.today, shift = (n) => { const d = new Date(day); d.setDate(d.getDate() + n); return iso(d); };
  const nav = `<div class="rf-day"><a class="icon-btn" href="#/day/${shift(-1)}" aria-label="Previous day">‹</a>
      <b>${isToday ? 'Today' : esc(day.toLocaleDateString('en-GB', { weekday: 'long' }))}</b> · ${esc(day.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}
      ${isToday ? '' : `<a class="icon-btn" href="#/day/${shift(1)}" aria-label="Next day">›</a>`}
      ${D.habits.length ? `<span class="seg day-tabs">${[['today', 'Day'], ['week', 'Week']].map(([k, l]) => `<button data-act="day-tab" data-val="${k}" class="${S.dayTab === k ? 'on' : ''}">${l}</button>`).join('')}</span>` : ''}</div>`;
  if (S.dayTab === 'week' && D.habits.length) return `<div class="day">${nav}${dayWeekHtml(D)}</div>`;
  // the protocols and habits only: the day's plan is on Today (its tasks) and Plan the day
  const parts = (D.summary || []).map((g) => protocolHtml(g, D));
  const none = !D.enabled ? '' : !D.habits.length ? '<div class="empty">No habits yet — they live in 05_model/habits/ (one file each), the AM / PM protocols in 05_model/protocols/. <button class="linkbtn" data-act="hb-new" data-proto="">+ New habit</button></div>' : '';
  const paused = (D.paused || []).length ? `<div class="day-sub">Paused · ${D.paused.map((h) => `${esc(h.title)} <button class="linkbtn" data-act="hb-resume" data-slug="${esc(h.slug)}">resume</button>`).join(' · ')}</div>` : '';
  // off work (a vacation, Settings → Off work): the work habits are off these days
  const ow = D.offWork ? (() => { const n = D.habits.filter((h) => h.offWork).length; return `<div class="day-sub">🏖 Off work ${D.offWork.to === '9999-12-31' ? 'until further notice' : `through ${esc(fromIso(D.offWork.to).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }))}`}${D.offWork.why ? ` · ${esc(D.offWork.why)}` : ''}${n ? ` · ${n} work habit${n === 1 ? '' : 's'} paused` : ''} · <a class="linkbtn" href="#/settings">change</a></div>`; })() : '';
  return `<div class="day">${nav}${ow}${oneHtml(D)}${parts.join('')}${none}${paused}
    ${isToday ? `<div class="day-foot"><a class="linkbtn" href="#/reflect">Daily reflection →</a>${D.habits.some((h) => h.checkin) ? ` <span class="muted">${D.habits.filter((h) => h.checkin).map((h) => esc(h.title)).join(' · ')} — checked there</span>` : ''}</div>` : ''}</div>`;
}

function oneHtml(D) {
  const one = D.plan?.one, isToday = D.date === S.data.today;
  if (one && !S.oneEdit) {
    const title = one.text || D.tasks?.[one.link]?.title || one.link;
    return `<div class="one-card ${D.oneDone ? 'done' : ''}"><button class="check ${D.oneDone ? 'done' : ''}" data-act="one-done" aria-label="${D.oneDone ? 'Not done yet' : '#1 done'}"></button>
      <div class="plan-main"><div class="plan-t"><b class="one-n">#1</b> ${inline(title)}</div>
      <div class="plan-meta">${chainHtml(goalChain(one.link))}${D.oneStreak ? `<span>#1 streak ${D.oneStreak} day${D.oneStreak === 1 ? '' : 's'}</span>` : ''}${D.oneDone ? '<span class="d-today">day won</span>' : ''}
        <button class="linkbtn" data-act="one-edit">change</button></div></div></div>`;
  }
  if (!isToday && !S.oneEdit) return '';
  if (!S.onePick) S.onePick = one ? { text: one.text || D.tasks?.[one.link]?.title || '', link: one.link } : winOne() || { text: '', link: null };
  const cur = S.onePick, choices = oneChoices(D.plan?.tasks?.map((x) => x.id) || []);
  return `<div class="one-card edit"><b class="one-n">#1</b><div class="plan-main">
      <input id="one-in" class="one-in" placeholder="The one result that makes today a win — or pick below" value="${esc(cur.text || '')}">
      <div class="plan-meta">${cur.link ? chainHtml(goalChain(cur.link)) || '<span>linked to the task</span>' : '<span>your own words — a new task on Set</span>'}</div>
      ${onePickerHtml(choices, cur, 'one-pick')}</div>
      <div class="one-btns"><button class="btn primary" data-act="one-set">Set</button>${one ? '<button class="btn ghost" data-act="one-cancel">Cancel</button>' : ''}</div></div>`;
}
// What can be today's #1: this week's open wins, then today's own tasks (the plan's first). {text, link, kind}
function oneChoices(planIds = [], upto = S.data.today) {
  const out = [], seen = new Set();
  const key = (x) => String(x || '').trim().toLowerCase().replace(/\s+/g, ' ');
  for (const w of (thisWeek() || []).filter((x) => !x.done)) {
    const m = w.text.match(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/);
    const text = w.text.replace(/\s*·?\s*\[\[[^\]]+\]\]/g, '').replace(/\s+by Sunday\b/i, '').trim();
    // a win that already has its task (picked as #1 before): the chip is that task, so picking it again doesn't copy it
    const t = S.data.tasks.find((x) => open(x) && key(x.title) === key(text));
    if (t) seen.add(t.id);
    out.push({ kind: 'win', text, link: t ? t.id : m ? m[1].trim() : null });
  }
  const mine = S.data.tasks.filter((x) => open(x) && x.assigned !== 'agent' && x.due && x.due <= upto).sort(byPri);
  for (const x of [...planIds.map(taskById).filter(Boolean).filter(open), ...mine]) {
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    out.push({ kind: 'task', text: x.title, link: x.id });
  }
  return out.slice(0, 10);
}
function onePickerHtml(choices, cur, act) {
  S.oneChoices = choices; S.oneDefault = choices;
  return `<div class="one-pick" data-pick="${act}">${oneChips(choices, cur, act)}</div>`;
}
const oneChips = (choices, cur, act) => choices.map((c, i) => `<button class="chip ${cur?.link && cur.link === c.link && cur.text === c.text ? 'on' : ''}" data-act="${act}" data-i="${i}" title="${c.kind === 'win' ? 'this week’s win' : 'a task for today'}">${c.kind === 'win' ? '★' : '○'} ${esc(c.text.length > 48 ? `${c.text.slice(0, 47)}…` : c.text)}</button>`).join('');
// Typing a #1: the chips become the open tasks (and wins) that match the words; nothing matches → it becomes a new task.
function oneSearch(input) {
  const box = input.closest('.plan-main')?.querySelector('.one-pick'), meta = input.closest('.plan-main')?.querySelector('.plan-meta');
  if (!box) return;
  const q = input.value.trim().toLowerCase(), words = q.split(/\s+/).filter((w) => w.length > 1);
  let list = S.oneDefault || [];
  if (words.length && !list.some((c) => c.text.toLowerCase() === q)) {
    const has = (t) => words.every((w) => t.toLowerCase().includes(w));
    const wins = (S.oneDefault || []).filter((c) => c.kind === 'win' && has(c.text));
    const tasks = S.data.tasks.filter((t) => open(t) && t.assigned !== 'agent' && has(t.title)).sort(byPri).slice(0, 8).map((t) => ({ kind: 'task', text: t.title, link: t.id }));
    list = [...wins, ...tasks];
    if (meta && !list.length) meta.innerHTML = '<span>no task like this — it becomes a new task</span>';
  }
  S.oneChoices = list;
  box.innerHTML = oneChips(list, null, box.dataset.pick);
}

function protocolHtml(g, D) {
  const key = g.protocol || 'day', isToday = D.date === S.data.today, now = nowHM();
  const habits = D.habits.filter((h) => h.protocol === g.protocol && !h.checkin); // checkin habits: on Daily reflection
  let status = '';
  if (g.window && isToday) status = now >= g.window.end ? '' : now >= g.window.start ? 'now' : `in ${planMins(mins(g.window.start) - mins(now))}`;
  // later protocols today stay folded until an hour before they start (tap to open)
  const folded = isToday && g.window && mins(g.window.start) - mins(now) > 60 ? !S.protoOpen.has(key) : S.protoOpen.has(`-${key}`);
  const pct = Math.round((g.done / Math.max(1, g.total)) * 100);
  return `<div class="section day-sec" data-proto="${esc(g.protocol || '')}"><div class="section-h day-h" data-act="proto-toggle" data-key="${key}">
      <span class="day-fold">${folded ? '›' : '⌄'}</span>${esc(g.name)}${g.window ? ` <span class="day-win">${g.window.start}–${g.window.end}</span>` : ''}
      <span class="c">${g.done}/${g.total}</span>${status ? `<span class="hint ${status === 'now' ? 'd-today' : ''}">${status}</span>` : ''}</div>
    ${(() => { const nx = isToday && status === 'now' ? habits.find((h) => h.due !== false && h.state !== 'done' && h.state !== 'min' && h.state !== 'skip') : null; return nx ? `<div class="day-next">Next: <b>${esc(nx.title)}</b>${nx.cue ? ` · ${esc(nx.cue)}` : ''}</div>` : ''; })()}
    <div class="plan-bar day-bar"><span style="width:${pct}%"></span></div>
    ${folded ? '' : habits.map((h) => habitRow(h, D)).join('')}${folded || D.date !== S.data.today ? '' : `<div class="add-row" data-act="hb-new" data-proto="${esc(g.protocol || '')}"><span class="plus">+</span>Habit</div>`}</div>`;
}

// Score your day as a quality, not a number (Masterpiece Days): four levels, stored as 10 / 8 / 6 / 4 so averages and
// the old 1–10 history still compare (a 9 shows as Good day). The day's data suggests one; the owner decides.
const SCORE_LEVELS = [[10, 'Best day', 'the day I meant to live'], [8, 'Good day', 'mostly on target'], [6, 'Could be better', 'something slipped'], [4, 'Needs work', 'reset tomorrow']];
const scoreLevel = (v) => (v == null ? null : SCORE_LEVELS.find(([n]) => v >= n - 1) || SCORE_LEVELS[SCORE_LEVELS.length - 1]);
// Masterpiece criteria from the day itself: #1 done · the morning protocol held (80%) · the plan done (75%) · habits (70%)
function scoreCriteria(D) {
  const p = D.plan, am = (D.summary || []).find((g) => g.window && g.window.end <= '12:00');
  const habitsDone = D.habits.filter((h) => !h.checkin && (h.state === 'done' || h.state === 'min')).length;
  const out = [];
  if (p?.one) out.push(['#1 done', D.oneDone]);
  if (am?.total) out.push([`${am.name} ${am.done}/${am.total}`, am.done / am.total >= 0.8]);
  if (p?.tasks?.length) { const d = p.tasks.filter((x) => x.done).length; out.push([`plan ${d}/${p.tasks.length}`, d / p.tasks.length >= 0.75]); }
  const all = D.habits.filter((h) => !h.checkin).length;
  if (all) out.push([`habits ${habitsDone}/${all}`, habitsDone / all >= 0.7]);
  return out;
}
function scoreHtml(h, D) {
  const cur = scoreLevel(h.entry?.value ?? null), crit = scoreCriteria(D), met = crit.filter(([, ok]) => ok).length;
  // all criteria → Masterpiece; one missing → Good day; two → Could be better; more → Needs work
  const sug = crit.length ? SCORE_LEVELS[Math.min(3, crit.length - met)] : null;
  return `<div class="hb-score">${SCORE_LEVELS.map(([v, label, hint]) => `<button class="${cur?.[0] === v ? 'on' : ''} ${!cur && sug?.[0] === v ? 'sug' : ''}" data-act="hb-score" data-slug="${esc(h.slug)}" data-v="${v}" title="${esc(hint)}"><b>${label}</b><small>${hint}</small></button>`).join('')}</div>
    ${crit.length ? `<div class="hb-crit">${crit.map(([l, ok]) => `<span class="${ok ? 'ok' : ''}">${ok ? '✓' : '·'} ${esc(l)}</span>`).join('')}${sug && !cur ? `<span class="muted">→ looks like <b>${sug[1]}</b></span>` : ''}</div>` : ''}`;
}
// "every day", "Mon–Fri", "Mon Wed Fri", "2× a week"
function scheduleLabel(h) {
  if (h.perWeek) return `${h.perWeek}× a week`;
  if (!h.days) return 'every day';
  const N = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };
  if (h.days.join() === 'mon,tue,wed,thu,fri') return 'Mon–Fri';
  if (h.days.join() === 'sun,sat') return 'weekends';
  return h.days.map((d) => N[d]).join(' ');
}
function habitRow(h, D) {
  const st = h.state, done = st === 'done' || st === 'min', quit = h.kind === 'quit', open = S.hbOpen.has(h.slug);
  const skipped = st === 'skip', notToday = !done && !skipped && h.due === false; // off its schedule, or a times-a-week habit already met
  const dots = `<span class="hb-dots" title="this week: ${h.weekDone ?? 0} day${h.weekDone === 1 ? '' : 's'}">${h.week.map((s, i) => `<i class="${s || 'none'}${D.week?.[i] === D.date ? ' today' : ''}"></i>`).join('')}</span>`;
  const ctl = quit ? '<span class="hb-q" aria-hidden="true">⊘</span>'
    : skipped ? `<button class="check skip" data-act="hb-clear" data-slug="${esc(h.slug)}" aria-label="Skipped — tap to undo" title="Skipped — tap to undo">↷</button>`
    : `<button class="check ${done ? 'done' : ''} ${st === 'min' ? 'min' : ''}" data-act="hb-check" data-slug="${esc(h.slug)}" aria-label="${done ? 'Not done' : 'Done'}" title="${done ? 'Not done' : 'Done'}"></button>`;
  const score = !quit && /score/i.test(h.unit || '');
  const val = score ? scoreHtml(h, D)
    : !quit && h.target != null ? `<span class="hb-val"><input type="number" inputmode="decimal" min="0" step="any" data-hb-val="${esc(h.slug)}" value="${h.entry?.value ?? ''}" placeholder="–" aria-label="${esc(h.title)}: ${esc(h.unit || 'value')}"> / ${fmtNum(h.target)} ${esc(h.unit || '')}</span>` : '';
  const quitCtl = quit ? `<span class="hb-qc"><button class="chip ${h.entry?.kept ? 'on' : ''}" data-act="hb-kept" data-slug="${esc(h.slug)}">kept</button><button class="chip ${h.entry?.slipped ? 'on slip' : ''}" data-act="hb-slipped" data-slug="${esc(h.slug)}">slipped</button></span>` : '';
  const unit = h.streakUnit === 'week' ? 'week' : 'day';
  const sched = h.perWeek ? `<span class="${h.weekDone >= h.perWeek ? 'd-today' : ''}">${h.weekDone}/${h.perWeek} this week</span>` : '';
  const meta = [dots, sched, h.streak ? `<span class="hb-streak" title="${unit === 'week' ? 'weeks in a row with the times a week met' : 'streak: one missed day is a gap, two in a row end it; days off the schedule and skipped days don’t count'}">${fmtNum(h.streak)} ${unit}${h.streak === 1 ? '' : 's'}</span>` : '',
    skipped ? '<span class="pill">skipped today</span>' : '', h.checkin === 'by-reflection' && !done ? '<span>ticks itself when you save the reflection</span>' : '', h.auto ? `<span title="filled in automatically">⟲ ${h.auto.source === 'health' ? 'Health' : 'Oura'}</span>` : '', notToday && !h.perWeek ? `<span class="pill">not today · ${esc(scheduleLabel(h))}</span>` : '',
    h.keystone ? '<span class="pill" title="keystone habit">🔑 keystone</span>' : '', st === 'min' ? '<span class="pill">minimum</span>' : '',
    !quit && !score && h.entry?.note && h.target == null && st !== 'min' ? `<span>${esc(h.entry.note)}</span>` : ''].filter(Boolean).join('');
  const nmt = (h.nmt || h.behind) && !done && !skipped && D.date === S.data.today
    ? `<div class="hb-nmt">⚠ ${h.behind ? `${h.weekDone} of ${h.perWeek} this week — today counts` : 'missed last time — don’t miss twice'}${h.minimum && !quit ? ` · <button class="linkbtn" data-act="hb-min" data-slug="${esc(h.slug)}">do the minimum: ${esc(h.minimum)}</button>` : ''}</div>` : '';
  const why = h.supports.length ? `→ ${h.supports.map((s) => esc(s.title)).join(', ')}` : '';
  const detail = open ? `<div class="hb-detail">
      ${h.why || why ? `<div><span class="hb-k">Why</span>${why ? `<b>${why}</b> ` : ''}${h.why ? esc(h.why.replace(/\s*\n+\s*/g, ' ')) : ''}</div>` : ''}
      ${h.cue ? `<div><span class="hb-k">If-then</span>${esc(h.cue)}</div>` : ''}
      ${h.minimum ? `<div><span class="hb-k">Minimum</span>${esc(h.minimum)}</div>` : ''}
      <div><span class="hb-k">Schedule</span>${esc(scheduleLabel(h))}</div>
      ${h.phase ? `<div><span class="hb-k">Phase</span>${{ unbearable: 'Unbearable — the first two weeks: just show up', uncomfortable: 'Uncomfortable — keep going, it gets easier', unstoppable: 'Unstoppable — on autopilot' }[h.phase]} <span class="muted">· day ${fmtNum(h.age)}</span></div>` : ''}
      ${h.obstacle || h.plan ? `<div><span class="hb-k">If…</span>${esc(h.obstacle || '…')} → ${esc(h.plan || '…')}</div>` : ''}
      ${h.rate != null ? `<div><span class="hb-k">${h.perWeek ? '12 weeks' : '4 weeks'}</span>${h.rate}% of ${h.perWeek ? 'weeks met' : 'scheduled days'}</div>` : ''}
      ${h.total ? `<div><span class="hb-k">All time</span>since ${esc(fromIso(h.total.since).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }))} · ${fmtNum(h.total.done)} of ${fmtNum(h.total.days)} ${h.perWeek ? 'weeks met' : 'days'} (${Math.round((h.total.done / Math.max(1, h.total.days)) * 100)}%) · best streak ${fmtNum(h.total.best)} ${unit}${h.total.best === 1 ? '' : 's'}</div>` : ''}
      <div class="chips"><button class="chip" data-act="hb-edit" data-slug="${esc(h.slug)}">Edit…</button>${!quit && h.minimum && st !== 'min' ? `<button class="chip" data-act="hb-min" data-slug="${esc(h.slug)}">✓ Minimum</button>` : ''}
        ${!h.entry ? `<button class="chip" data-act="hb-skip" data-slug="${esc(h.slug)}" title="Not today, on purpose: neither done nor missed (or swipe left)">↷ Skip today</button>` : ''}
        ${h.entry ? `<button class="chip" data-act="hb-clear" data-slug="${esc(h.slug)}">${skipped ? 'Undo skip' : 'Clear today’s mark'}</button>` : ''}
        ${ME().obsidian ? `<a class="chip" href="${obsidianPath(h.file)}">Open in Obsidian ↗</a>` : ''}</div></div>` : '';
  return `<div class="plan-row hb-row ${done ? 'is-done' : ''} ${skipped || notToday ? 'is-off' : ''} ${h.twice && !done && !skipped && !notToday ? 'twice' : ''}" data-slug="${esc(h.slug)}" data-proto="${esc(h.protocol || '')}"><span class="hb-drag" data-drag="${esc(h.slug)}" aria-label="Drag to move" title="Drag to move">⋮⋮</span>${ctl}
    <div class="plan-main"><div class="hb-top"><button class="plan-t hb-t" data-act="hb-open" data-slug="${esc(h.slug)}">${esc(h.title)}</button>${val}${quitCtl}${habitTimerHtml(h, D)}</div>
      ${meta ? `<div class="plan-meta">${meta}</div>` : ''}${S.htOpen === h.slug ? habitTimerPick(h) : ''}${why && !open ? `<div class="plan-meta hb-why">${why}</div>` : ''}${nmt}${detail}</div></div>`;
}

// A countdown for a habit measured in minutes (h.timer; lib/timers.js on the Mac): ⏱ → its length → it runs here, on the
// iPhone and on the watch alike; the Mac counts the minutes at the end. Finish = the minutes so far count; Discard (asks
// first) = nothing counts.
// Needs the Mac (the offline app has no timers: S.data.timers is missing there).
const timersOn = () => Array.isArray(S.data?.timers);
const runningTimers = () => (S.data?.timers || []).filter((t) => t.state === 'running');
function leftOf(end) {
  const s = Math.max(0, Math.ceil((Date.parse(end) - Date.now()) / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s % 60).padStart(2, '0')}`;
}
function habitTimerHtml(h, D) {
  if (!h.timer || h.kind === 'quit' || D.date !== S.data.today || !timersOn()) return '';
  const run = runningTimers().find((t) => t.slug === h.slug);
  if (run && S.htAsk === run.id) return `<span class="ht-run"><span class="muted">Nothing counts —</span><button class="chip" data-act="ht-cancel" data-id="${esc(run.id)}">Discard</button><button class="chip" data-act="ht-keep">Keep</button></span>`;
  if (run) return `<span class="ht-run"><b class="ht-left" data-end="${esc(run.end)}">${leftOf(run.end)}</b><button class="chip" data-act="ht-stop" data-id="${esc(run.id)}" title="Stop now: the minutes so far count">✓ Finish</button><button class="linkbtn ht-x" data-act="ht-ask" data-id="${esc(run.id)}" title="Stop without counting anything">Discard</button></span>`;
  return `<button class="chip ht-go ${S.htOpen === h.slug ? 'on' : ''}" data-act="ht-open" data-slug="${esc(h.slug)}" title="Start a countdown"><span class="ht-ic">${ICON.timer}</span>${h.timer}m</button>`;
}
function habitTimerPick(h) {
  const min = Number(String(h.minimum || '').match(/^\s*(\d{1,3})\s*(?:m|min|minutes?)?\s*$/i)?.[1]) || null;
  const lens = [...new Set([h.timer, min, 5, 10, 15, 20, 30, 45, 60].filter((n) => n >= 1 && n <= 240))].sort((a, b) => a - b);
  return `<div class="chips ht-pick"><span class="muted">Timer</span>${lens.map((n) => `<button class="chip ${n === h.timer ? 'on' : ''}" data-act="ht-start" data-slug="${esc(h.slug)}" data-min="${n}">${n} min${n === min && n !== h.timer ? ' · minimum' : ''}</button>`).join('')}</div>`;
}
// running timers on Today: one line each, tap → Protocol
const timerPillsHtml = () => runningTimers().map((t) => `<a class="ht-pill" href="#/day"><span class="ht-ic">${ICON.timer}</span>${esc(t.title)} <b class="ht-left" data-end="${esc(t.end)}">${leftOf(t.end)}</b></a>`).join('');
async function timerAct(a) {
  const act = a.dataset.act;
  if (act === 'ht-open') { S.htOpen = S.htOpen === a.dataset.slug ? null : a.dataset.slug; return renderMain(); }
  if (act === 'ht-ask') { S.htAsk = a.dataset.id; return renderMain(); }
  if (act === 'ht-keep') { S.htAsk = null; return renderMain(); }
  S.htAsk = null;
  try {
    if (act === 'ht-start') { S.htOpen = null; await api('POST', `/api/habits/${encodeURIComponent(a.dataset.slug)}/timer`, { minutes: +a.dataset.min, from: 'app' }); }
    if (act === 'ht-stop') await api('POST', `/api/timers/${encodeURIComponent(a.dataset.id)}/stop`, {});
    if (act === 'ht-cancel') await api('POST', `/api/timers/${encodeURIComponent(a.dataset.id)}/cancel`, {});
  } catch { return; }
  await load();
  if (act === 'ht-stop' || act === 'ht-cancel') syncHealth(true); // a mindfulness timer → Apple Health (the iPhone app)
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-act^="ht-"]');
  if (!a) return;
  e.preventDefault(); e.stopPropagation();
  timerAct(a);
}, true);
// the countdowns tick; at zero: a beep, and the Mac's finished check-in is fetched
setInterval(() => {
  for (const el of document.querySelectorAll('.ht-left[data-end]')) {
    el.textContent = leftOf(el.dataset.end);
    if (Date.parse(el.dataset.end) > Date.now() || (S.htRang ||= new Set()).has(el.dataset.end)) continue;
    S.htRang.add(el.dataset.end);
    beep(); toast('⏱ Time’s up — counted for today');
    setTimeout(() => { load(); syncHealth(true); }, 2500);
  }
}, 1000);

// Week tab: every habit × the last 7 days.
function dayWeekHtml(D) {
  const days = (D.week || []).map(fromIso);
  const groups = D.summary || [];
  const sym = (s, quit) => (s === 'done' ? (quit ? '✓' : '●') : s === 'min' ? '◐' : s === 'miss' ? (quit ? '✗' : '○') : s === 'skip' ? '↷' : s === 'off' ? '–' : s === 'future' || s === 'free' ? '' : '·');
  const pick = `<div class="hb-pick"><button class="linkbtn" data-act="ks-pick">🔑 Pick the keystone…</button> <span class="muted">— the one habit that changes the most right now</span></div>`;
  return `${pick}<div class="hb-grid"><div class="hb-gh"><span></span>${days.map((d) => `<span class="${iso(d) === D.date ? 'today' : ''}">${esc(d.toLocaleDateString('en-GB', { weekday: 'narrow' }))}</span>`).join('')}<span></span></div>
    ${groups.map((g) => `<div class="hb-gg">${esc(g.name)}</div>${D.habits.filter((h) => h.protocol === g.protocol).map((h) => `<div class="hb-gr" data-act="hb-week-open" data-slug="${esc(h.slug)}">
      <span class="hb-gn">${esc(h.title)}${h.keystone ? ' 🔑' : ''}</span>${h.week.map((s) => `<span class="hb-c ${s || 'none'}">${sym(s, h.kind === 'quit')}</span>`).join('')}
      <span class="hb-gf">${h.twice ? '<span class="d-over" title="missed two days in a row">⚠</span>' : ''}${h.weekDone ? `<b title="done this week">${h.weekDone}</b>` : ''}</span></div>`).join('')}`).join('')}
    <div class="muted hb-legend">● done · ◐ minimum · ○ missed · ✓ kept · ✗ slipped · ↷ skipped · – not on its schedule · · no mark — the number: days done this week (${S.settings?.weekStart === 'sunday' ? 'Sun–Sat' : 'Mon–Sun'}, Settings)</div></div>`;
}

async function dayAct(a) {
  const D = S.day, date = D?.date || S.data.today, slug = a.dataset.slug;
  const checkin = async (body) => {
    try {
      S.day = await api('PUT', `/api/habits/${encodeURIComponent(slug)}/checkin`, { date, ...body });
      if (date === S.data.today && S.data.day) { S.data.day.summary = S.day.summary; syncNativeReminders(); }
    } catch (e) { toast(e.message); }
    renderMain();
  };
  switch (a.dataset.act) {
    case 'day-tab': S.dayTab = a.dataset.val; return renderMain();
    case 'proto-toggle': {
      const k = a.dataset.key, g = (D.summary || []).find((x) => (x.protocol || 'day') === k);
      const later = D.date === S.data.today && g?.window && mins(g.window.start) - mins(nowHM()) > 60;
      const set = S.protoOpen, id = later ? k : `-${k}`;
      if (set.has(id)) set.delete(id); else set.add(id);
      return renderMain();
    }
    case 'hb-open': case 'hb-week-open':
      if (a.dataset.act === 'hb-week-open') S.dayTab = 'today';
      if (S.hbOpen.has(slug)) S.hbOpen.delete(slug); else S.hbOpen.add(slug);
      return renderMain();
    case 'hb-check': { const h = D.habits.find((x) => x.slug === slug); return checkin(h?.state === 'done' || h?.state === 'min' ? { clear: true } : { done: true }); }
    case 'hb-min': return checkin({ minimum: true });
    case 'hb-kept': return checkin(D.habits.find((x) => x.slug === slug)?.entry?.kept ? { clear: true } : { kept: true });
    case 'hb-slipped': return checkin(D.habits.find((x) => x.slug === slug)?.entry?.slipped ? { clear: true } : { slipped: true });
    case 'hb-clear': return checkin({ clear: true });
    case 'hb-skip': return checkin({ skip: true });
    case 'hb-edit': return habitModal(D.habits.find((x) => x.slug === slug));
    case 'hb-new': return habitModal(null, { protocol: a.dataset.proto || null });
    case 'ks-pick': return keystoneModal();
    case 'hb-score': return checkin(scoreLevel(D.habits.find((x) => x.slug === slug)?.entry?.value ?? null)?.[0] === +a.dataset.v ? { clear: true } : { value: +a.dataset.v });
    case 'tm-edit': S.tmEdit = true; S.tmPick = null; return renderMain();
    case 'tm-cancel': S.tmEdit = false; S.tmPick = null; return renderMain();
    case 'tm-pick': { const c = S.oneChoices?.[+a.dataset.i]; if (c) S.tmPick = { text: c.text, link: c.link }; return renderMain(); }
    case 'tm-set': {
      const text = $('#tm-in')?.value.trim();
      if (!text) return toast('Write tomorrow’s #1 or pick one');
      const link = S.tmPick?.text?.trim() === text ? S.tmPick.link || null : null;
      const tm = (() => { const d = fromIso(date); d.setDate(d.getDate() + 1); return iso(d); })();
      try { await api('PUT', '/api/day/one', { date: tm, text, link }); } catch (e) { return toast(e.message); }
      S.tmEdit = false; S.tmPick = null; await loadDay(date); toast('Tomorrow’s #1 is set'); return load();
    }
    case 'hb-resume': await api('PATCH', `/api/habits/${encodeURIComponent(slug)}`, { status: 'active' }); return loadDay(date);
    case 'one-edit': S.oneEdit = true; S.onePick = null; return renderMain();
    case 'one-cancel': S.oneEdit = false; S.onePick = null; return renderMain();
    case 'one-pick': { const c = S.oneChoices?.[+a.dataset.i]; if (c) S.onePick = { text: c.text, link: c.link }; return renderMain(); }
    case 'one-set': {
      const text = $('#one-in')?.value.trim();
      if (!text) return toast('Write today’s #1 or pick one');
      // typed words of your own are not linked to the old task / win
      const link = S.onePick?.text?.trim() === text ? S.onePick.link || null : null;
      await api('PUT', '/api/day/one', { date, text, link });
      S.oneEdit = false; S.onePick = null; await loadDay(date); return load();
    }
    case 'one-done': await api('PUT', '/api/day/one', { date, done: !D.oneDone }); await loadDay(date); return load();
  }
}
// Edit a habit: its name (the file name stays, so links keep working), what it leads to (goals, projects, wants), its
// area, block, target, minimum, if-then cue, why, keystone, status. Changes are logged in the habit's ## Log.
// filled in automatically (lib/habits.js applyAuto): Apple Health on the iPhone; Oura on the Mac (once it has a token)
const AUTO_OPTS = [['', 'By hand'], ['app:focus', 'Gubernos · focus sprints (min)'], ['health:steps', 'Apple Health · steps'], ['health:energy', 'Apple Health · active energy (Cal)'], ['health:water', 'Apple Health · water (ml)'],
  ['health:daylight', 'Apple Health · time in daylight (min)'], ['health:mindful', 'Apple Health · mindful minutes'], ['health:workout', 'Apple Health · workout minutes'],
  ['health:wake', 'Apple Health · woke up by…'], ['health:bedtime', 'Apple Health · asleep by…'],
  ['oura:steps', 'Oura · steps'], ['oura:energy', 'Oura · active calories'], ['oura:mindful', 'Oura · meditation minutes'], ['oura:workout', 'Oura · workout minutes'],
  ['oura:wake', 'Oura · woke up by…'], ['oura:bedtime', 'Oura · asleep by…']];
// Habits 101: pick the keystone — rate candidates 1–10 on Excited, Impact, Commitment; the highest sum is the one.
function keystoneModal() {
  const hs = (S.day?.habits || []).filter((h) => h.kind !== 'quit');
  S.ks = S.ks || {};
  const sum = (s) => { const v = S.ks[s] || {}; return (v.e || 0) + (v.i || 0) + (v.c || 0); };
  const render = () => {
    const order = [...hs].sort((a, b) => sum(b.slug) - sum(a.slug) || (b.keystone - a.keystone));
    const best = order.find((h) => sum(h.slug) > 0);
    $('#ks-list').innerHTML = order.map((h) => `<div class="ks-row ${best === h ? 'best' : ''}"><span class="ks-t">${h.keystone ? '🔑 ' : ''}${esc(h.title)}</span>
      ${['e', 'i', 'c'].map((k) => `<input type="number" min="1" max="10" inputmode="numeric" data-ks="${esc(h.slug)}" data-k="${k}" value="${S.ks[h.slug]?.[k] ?? ''}" placeholder="–" aria-label="${{ e: 'Excited', i: 'Impact', c: 'Commitment' }[k]}">`).join('')}
      <b class="ks-sum">${sum(h.slug) || ''}</b></div>`).join('');
    $('#ks-save').disabled = !best;
    $('#ks-save').textContent = best ? `Make “${best.title.slice(0, 28)}” the keystone` : 'Rate a few first';
    $('#ks-save').dataset.slug = best?.slug || '';
  };
  $('#modal').innerHTML = `<div class="overlay" data-act="qa-close"><div class="qa pm ks">
    <div class="bd-h">Pick the keystone</div>
    <p class="muted">Rate the candidates 1–10: how <b>excited</b> you are, the <b>impact</b> on your life, your <b>commitment</b> (“nothing can stop me” = 10). The highest sum is your keystone — install one at a time.</p>
    <div class="ks-head"><span></span><span title="Excited">Exc</span><span title="Impact">Imp</span><span title="Commitment">Com</span><span>Σ</span></div>
    <div id="ks-list"></div>
    <div class="foot"><span class="sp"></span><button class="btn" data-act="qa-close">Cancel</button><button class="btn primary" id="ks-save">Rate a few first</button></div></div></div>`;
  render();
  // the order follows the sums once typing pauses (the field being typed in keeps its focus)
  $('#ks-list').oninput = (e) => {
    const x = e.target.closest('[data-ks]');
    if (!x) return;
    const v = Math.max(0, Math.min(10, +x.value || 0));
    (S.ks[x.dataset.ks] ||= {})[x.dataset.k] = v || undefined;
    clearTimeout(S.ksT);
    S.ksT = setTimeout(() => { const f = document.activeElement?.dataset || {}; render(); if (f.ks) $(`[data-ks="${CSS.escape(f.ks)}"][data-k="${f.k}"]`)?.focus(); }, 700);
  };
  $('#ks-save').onclick = async () => {
    const slug = $('#ks-save').dataset.slug;
    if (!slug) return;
    try { await api('PATCH', `/api/habits/${encodeURIComponent(slug)}`, { keystone: true }); } catch (e) { return toast(e.message); }
    closeModal(); await loadDay(S.day?.date || S.data.today); toast('🔑 Keystone set');
  };
}
const weekOrder = () => (S.settings?.weekStart === 'sunday' ? ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] : ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
function habitModal(h, opts = {}) {
  const isNew = !h; // a new habit: the same form, empty, in the block it was added from
  if (!h) h = { slug: null, title: '', supports: [], serves: [], kind: 'build', protocol: opts.protocol || null, days: null, perWeek: null,
    target: null, unit: null, minimum: null, cue: null, why: '', keystone: false, checkin: null };
  const goals = S.data.goalDetails || [], projects = S.data.projects.filter((p) => p.status === 'active');
  const wants = (S.data.containers || []).filter((c) => c.type === 'want' && !c.archived), areas = S.data.areas || [];
  const name = (s) => goals.find((x) => x.slug === s)?.title || projects.find((x) => x.slug === s)?.title || wants.find((x) => x.slug === s)?.title || h.supports.find((x) => x.slug === s)?.title || s;
  let sup = h.supports.map((s) => s.slug);
  const opt = (label, list) => (list.length ? `<optgroup label="${label}">${list.map((x) => `<option value="${esc(x.slug)}">${esc(x.title)}</option>`).join('')}</optgroup>` : '');
  const supHtml = () => `${sup.map((s) => `<span class="pill hm-sup">${esc(name(s))} <button type="button" data-rm="${esc(s)}" aria-label="Remove">✕</button></span>`).join('') || '<span class="muted">nothing yet</span>'}`;
  const blocks = [...(S.day?.protocols || []).map((p) => [p.slug, p.title]), ['', 'Day (no protocol)']];
  $('#modal').innerHTML = `<div class="overlay" data-act="qa-close"><div class="qa pm hm">
    <div class="bd-h">${isNew ? 'New habit' : 'Edit habit'}</div>
    <input class="q" id="hm-title" autocomplete="off" value="${esc(h.title)}" placeholder="Habit">
    <div class="tri"><div class="lbl">Leads to</div><div><div class="hm-sups" id="hm-sups">${supHtml()}</div>
      <select id="hm-add" class="pm-select"><option value="">+ Link a goal, project or want…</option>${opt('Goals', goals)}${opt('Projects', projects)}${opt('Wants', wants)}</select></div></div>
    ${areas.length ? `<div class="tri"><div class="lbl">Area</div><select id="hm-area" class="pm-select"><option value="">— none —</option>${areas.map((a) => `<option value="${esc(a.slug)}" ${h.serves.includes(a.slug) ? 'selected' : ''}>${esc(a.title)}</option>`).join('')}</select></div>` : ''}
    <div class="tri"><div class="lbl">Block</div><select id="hm-block" class="pm-select">${blocks.map(([v, l]) => `<option value="${esc(v)}" ${(h.protocol || '') === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
    <div class="tri"><div class="lbl">Schedule</div><div><select id="hm-sched" class="pm-select"><option value="every" ${!h.days && !h.perWeek ? 'selected' : ''}>Every day</option><option value="days" ${h.days ? 'selected' : ''}>On some days</option><option value="week" ${h.perWeek ? 'selected' : ''}>Times a week, any days</option></select>
      <div class="hm-days" id="hm-days" ${h.days ? '' : 'hidden'}>${weekOrder().map((d) => `<button type="button" class="chip ${(h.days || ['mon', 'tue', 'wed', 'thu', 'fri']).includes(d) ? 'on' : ''}" data-day="${d}">${d[0].toUpperCase() + d.slice(1, 2)}</button>`).join('')}</div>
      <div class="hm-row" id="hm-week" ${h.perWeek ? '' : 'hidden'}><input id="hm-perweek" type="number" min="1" max="6" step="1" value="${h.perWeek || 2}"><span class="muted">times a week — the other days aren’t misses</span></div></div></div>
    <div class="tri"><div class="lbl">Days off work</div><select id="hm-offwork" class="pm-select"><option value="" ${h.offWork ? '' : 'selected'}>Keep — on vacation too</option><option value="pause" ${h.offWork ? 'selected' : ''}>Pause — a work habit (Settings → Off work)</option></select></div>
    <div class="tri"><div class="lbl">Auto</div><div class="hm-row"><select id="hm-auto" class="pm-select">${AUTO_OPTS.map(([v, l]) => `<option value="${v}" ${(h.auto ? `${h.auto.source}:${h.auto.metric}` : '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <input id="hm-auto-at" type="time" step="300" value="${h.auto?.at != null ? `${String(Math.floor(h.auto.at / 60)).padStart(2, '0')}:${String(h.auto.at % 60).padStart(2, '0')}` : '06:30'}" ${h.auto?.at != null ? '' : 'hidden'}></div></div>
    <div class="tri"><div class="lbl">Checked on</div><select id="hm-checkin" class="pm-select"><option value="" ${!h.checkin ? 'selected' : ''}>Protocol screen</option><option value="reflection" ${h.checkin === 'reflection' ? 'selected' : ''}>Daily reflection</option><option value="next-one" ${h.checkin === 'next-one' ? 'selected' : ''}>Daily reflection — by choosing tomorrow’s #1</option><option value="by-reflection" ${h.checkin === 'by-reflection' ? 'selected' : ''}>Daily reflection — by saving it</option></select></div>
    <div class="tri"><div class="lbl">Kind</div><select id="hm-kind" class="pm-select"><option value="build" ${h.kind !== 'quit' ? 'selected' : ''}>Build — do it</option><option value="quit" ${h.kind === 'quit' ? 'selected' : ''}>Quit — kept / slipped</option></select></div>
    <div class="tri"><div class="lbl">Target</div><div class="hm-row"><input id="hm-target" type="number" inputmode="decimal" min="0" step="any" placeholder="none = done / not done" value="${h.target ?? ''}"><input id="hm-unit" placeholder="unit: min, steps, ml" value="${esc(h.unit || '')}"></div></div>
    <div class="tri"><div class="lbl">Minimum</div><input id="hm-min" class="pm-select" placeholder="the version for a bad day" value="${esc(h.minimum || '')}"></div>
    <div class="tri"><div class="lbl">If-then</div><input id="hm-cue" class="pm-select" placeholder="after coffee → …" value="${esc(h.cue || '')}"></div>
    <div class="tri"><div class="lbl">Obstacle → plan</div><div class="hm-row"><input id="hm-obstacle" class="pm-select" placeholder="if… (what gets in the way)" value="${esc(h.obstacle || '')}"><input id="hm-plan" class="pm-select" placeholder="then… (what I do)" value="${esc(h.plan || '')}"></div></div>
    <div class="tri"><div class="lbl">Why</div><textarea id="hm-why" rows="3" placeholder="What it gives you">${esc(h.why || '')}</textarea></div>
    <div class="tri"><div class="lbl"></div><label class="hm-check"><input type="checkbox" id="hm-key" ${h.keystone ? 'checked' : ''}> 🔑 Keystone — the one habit that matters most now (only one)</label></div>
    <div class="foot">${isNew ? '<span class="sp muted">Creates 05_model/habits/&lt;name&gt;.md</span>' : '<select id="hm-status" class="pm-select hm-status"><option value="active">Active</option><option value="paused">Pause</option><option value="retired">Retire</option></select><span class="sp"></span>'}
      <button class="btn" data-act="qa-close">Cancel</button><button class="btn primary" id="hm-save">${isNew ? 'Create habit' : 'Save'}</button></div></div></div>`;
  if (isNew) $('#hm-title').focus();
  autosize($('#hm-why'));
  $('#hm-auto').onchange = (e) => { $('#hm-auto-at').hidden = !/:(wake|bedtime)$/.test(e.target.value); if (/:bedtime$/.test(e.target.value)) $('#hm-auto-at').value = '22:00'; };
  $('#hm-sched').onchange = (e) => { $('#hm-days').hidden = e.target.value !== 'days'; $('#hm-week').hidden = e.target.value !== 'week'; };
  $('#hm-days').onclick = (e) => { const b = e.target.closest('[data-day]'); if (b) b.classList.toggle('on'); };
  $('#hm-add').onchange = (e) => { const v = e.target.value; if (v && !sup.includes(v)) sup.push(v); e.target.value = ''; $('#hm-sups').innerHTML = supHtml(); };
  $('#hm-sups').onclick = (e) => { const b = e.target.closest('[data-rm]'); if (b) { sup = sup.filter((s) => s !== b.dataset.rm); $('#hm-sups').innerHTML = supHtml(); } };
  $('#hm-save').onclick = async () => {
    const title = $('#hm-title').value.trim();
    if (!title) return $('#hm-title').focus();
    const area = $('#hm-area')?.value;
    const body = { title, supports: sup, kind: $('#hm-kind').value, protocol: $('#hm-block').value || null, target: $('#hm-target').value, unit: $('#hm-unit').value,
      checkin: $('#hm-checkin').value || null,
      auto: $('#hm-auto').value ? `${$('#hm-auto').value}${/:(wake|bedtime)$/.test($('#hm-auto').value) ? `<=${$('#hm-auto-at').value}` : ''}` : null,
      days: $('#hm-sched').value === 'days' ? $$('#hm-days .chip.on').map((b) => b.dataset.day) : [],
      perWeek: $('#hm-sched').value === 'week' ? +$('#hm-perweek').value || null : null, minimum: $('#hm-min').value, cue: $('#hm-cue').value, obstacle: $('#hm-obstacle').value, plan: $('#hm-plan').value, why: $('#hm-why').value, keystone: $('#hm-key').checked, offWork: $('#hm-offwork').value === 'pause', ...(isNew ? {} : { status: $('#hm-status').value }),
      ...(area !== undefined ? { serves: [area, ...h.serves.filter((s) => !areas.some((a) => a.slug === s))].filter(Boolean) } : {}) };
    try { await api(isNew ? 'POST' : 'PATCH', isNew ? '/api/habits' : `/api/habits/${encodeURIComponent(h.slug)}`, body); } catch (e) { return toast(e.message); }
    closeModal(); await loadDay(S.day?.date || S.data.today); load();
    toast(isNew ? `Created “${title}”` : body.status === 'active' ? 'Habit saved' : `“${title}” ${body.status === 'paused' ? 'paused' : 'retired'}`);
  };
}

// Drag a habit by its ⋮⋮ handle: up / down in its block, or into another block (AM, Day, PM). Pointer events, so it works
// with a finger too. The drop rewrites the block's order (05_model/protocols/*.md; Day: protocols/day.md) and the habit's protocol.
let hbDrag = null;
const clearDrop = () => $$('.drop-before, .drop-after, .drop-into').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-into'));
document.addEventListener('pointerdown', (e) => {
  const hd = e.target.closest('[data-drag]');
  if (!hd || !hd.closest('.day')) return;
  e.preventDefault();
  const row = hd.closest('.hb-row');
  hbDrag = { slug: hd.dataset.drag, row, y0: e.clientY, target: null };
  row.classList.add('dragging');
  try { hd.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
});
document.addEventListener('pointermove', (e) => {
  if (!hbDrag) return;
  e.preventDefault();
  const d = hbDrag;
  d.row.style.transform = `translateY(${e.clientY - d.y0}px)`;
  d.row.style.pointerEvents = 'none';
  const el = document.elementFromPoint(e.clientX, e.clientY);
  d.row.style.pointerEvents = '';
  clearDrop();
  const r = el?.closest('.hb-row[data-slug]'), sec = el?.closest('.day-sec[data-proto]');
  if (r && r !== d.row) {
    const b = r.getBoundingClientRect(), after = e.clientY > b.top + b.height / 2;
    r.classList.add(after ? 'drop-after' : 'drop-before');
    d.target = { to: r.dataset.proto, slug: r.dataset.slug, after };
  } else if (sec && !r) { sec.classList.add('drop-into'); d.target = { to: sec.dataset.proto, slug: null }; } else if (!r) d.target = null;
  const m = $('#main'), mb = m.getBoundingClientRect(); // near the edges: scroll the list
  if (e.clientY < mb.top + 60) m.scrollTop -= 14; else if (e.clientY > mb.bottom - 60) m.scrollTop += 14;
}, { passive: false });
async function endHbDrag() {
  if (!hbDrag) return;
  const d = hbDrag, t = d.target;
  hbDrag = null;
  d.row.classList.remove('dragging'); d.row.style.transform = '';
  clearDrop();
  if (!t || t.slug === d.slug) return;
  // dropped on a row: before it, or before the next one when in its lower half; on a block's header: at its end
  let before = null;
  if (t.slug) {
    if (!t.after) before = t.slug;
    else { const hs = S.day.habits.filter((h) => (h.protocol || '') === (t.to || '')); before = hs.slice(hs.findIndex((h) => h.slug === t.slug) + 1).find((h) => h.slug !== d.slug)?.slug || null; }
  }
  const h = S.day.habits.find((x) => x.slug === d.slug);
  if ((h?.protocol || '') === (t.to || '')) { // same block: show the new order at once
    const hs = S.day.habits.filter((x) => x.slug !== d.slug), i = before ? hs.findIndex((x) => x.slug === before) : -1;
    const lastOfBlock = hs.map((x) => (x.protocol || '') === (t.to || '')).lastIndexOf(true);
    hs.splice(i >= 0 ? i : lastOfBlock + 1, 0, h); S.day.habits = hs; renderMain();
  }
  try { await api('POST', `/api/habits/${encodeURIComponent(d.slug)}/move`, { to: t.to || null, before }); } catch (err) { toast(err.message); }
  await loadDay(S.day.date);
  if (S.data.day) load();
}
document.addEventListener('pointerup', endHbDrag);
document.addEventListener('pointercancel', endHbDrag);

const DAY_ACTS = new Set(['ks-pick', 'hb-new', 'hb-skip', 'hb-score', 'tm-edit', 'tm-cancel', 'tm-pick', 'tm-set', 'hb-edit', 'hb-resume', 'day-tab', 'proto-toggle', 'hb-open', 'hb-week-open', 'hb-check', 'hb-min', 'hb-kept', 'hb-slipped', 'hb-clear', 'one-edit', 'one-cancel', 'one-pick', 'one-set', 'one-done']);
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]');
  if (!a || !DAY_ACTS.has(a.dataset.act) || !e.target.closest('.day, .rf-dayline')) return;
  e.preventDefault(); e.stopPropagation();
  dayAct(a);
}, true);
document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-act="today-one-done"]')) return;
  e.preventDefault(); e.stopPropagation();
  try { await api('PUT', '/api/day/one', { date: S.data.today, done: !S.data.day?.oneDone }); } catch (err) { return toast(err.message); }
  load();
}, true);
// Today's protocol card: tick the next habit (a quit habit → kept), with Undo
document.addEventListener('click', async (e) => {
  const a = e.target.closest('[data-act="tp-check"]');
  if (!a) return;
  e.preventDefault(); e.stopPropagation();
  const slug = a.dataset.slug, date = S.data.today, url = `/api/habits/${encodeURIComponent(slug)}/checkin`;
  a.classList.add('done');
  try { await api('PUT', url, { date, ...(a.dataset.quit ? { kept: true } : { done: true }) }); } catch (err) { a.classList.remove('done'); return toast(err.message); }
  const title = a.nextElementSibling?.querySelector('b')?.textContent || 'Habit';
  await load(); syncNativeReminders();
  toast(`${title.slice(0, 40)} — ${a.dataset.quit ? 'kept' : 'done'}`, 'Undo', async () => { await api('PUT', url, { date, clear: true }); load(); }, GRACE_MS);
}, true);
// a value (steps, minutes, ml) is saved when the field is left or Enter is pressed; an empty field clears the mark
document.addEventListener('change', (e) => {
  const slug = e.target.dataset?.hbVal;
  if (!slug) return;
  const v = e.target.value.trim();
  (async () => {
    try {
      S.day = await api('PUT', `/api/habits/${encodeURIComponent(slug)}/checkin`, v === '' ? { date: S.day.date, clear: true } : { date: S.day.date, value: Number(v) });
      if (S.day.date === S.data.today && S.data.day) S.data.day.summary = S.day.summary;
    } catch (err) { toast(err.message); }
    renderMain();
  })();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.target.dataset?.hbVal || e.target.id === 'one-in' || e.target.id === 'tm-in')) { e.preventDefault(); if (e.target.id === 'one-in') $('[data-act="one-set"]')?.click(); else if (e.target.id === 'tm-in') $('[data-act="tm-set"]')?.click(); else e.target.blur(); } });

// ---------- decisions: the queue the assistant (or a chat here) prepares; the owner decides in one tap (vault AGENTS.md → "Decision queue") ----------
S.decOpen = new Set(); S.decided = []; S.decPick = {}; // expanded cards · recorded this session · card in "choose / not now" mode
function decDue(d) {
  if (!d.decide_by) return ['', ''];
  const n = dayDiff(d.decide_by, S.data.today);
  return [n < 0 ? `⚠ ${-n} day${n === -1 ? '' : 's'} overdue` : n === 0 ? 'decide today' : `by ${fromIso(d.decide_by).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`,
    n < 0 ? 'd-over' : n <= 3 ? 'd-tom' : ''];
}
// "**D**, provisionally. It turns an open-ended choice into…" → "It turns an open-ended choice into…" (the why, one sentence)
// A sentence ends at a word of 2+ letters, so "a.s.r." or "e.g." don't cut it.
const recWhy = (r) => { const t = r.replace(/^\*\*[A-Z]\*\*\s*[,:.—-]?\s*/, '').replace(/^provisional(ly)?\s*[,.:;]?\s*/i, ''); return (t.match(/^.+?[\p{L}\d)\]]{2}[.!?](?=\s|$)/su) || [t])[0]; };
function decisionCard(d) {
  const pending = pendingOps.has(`dec:${d.slug}`);
  const recd = d.options.find((o) => o.letter === d.rec);
  const [due, cls] = decDue(d);
  const expanded = S.decOpen.has(d.slug), mode = S.decPick[d.slug];
  const opt = (o) => `<div class="dec-opt ${o.letter === d.rec ? 'is-rec' : ''}"><b>${o.letter}</b><div><div class="dec-ol">${inline(o.label)}${o.letter === d.rec ? ' <span class="pill agent">recommended</span>' : ''}</div>${o.text ? `<div class="dec-ot">${inline(o.text)}</div>` : ''}</div></div>`;
  const plus = (n) => { const x = fromIso(S.data.today); x.setDate(x.getDate() + n); return iso(x); };
  let acts;
  if (pending) acts = '<div class="dec-acts"><span class="dec-note">Recording…</span></div>';
  else if (mode === 'drop') acts = `<div class="dec-acts wrap"><input class="dec-why" id="dec-drop-${d.slug}" placeholder="Why not (optional)" autocomplete="off">
      <button class="btn" data-act="dec-drop" data-slug="${d.slug}">Not a decision</button><button class="linkbtn" data-act="dec-back" data-slug="${d.slug}">Back</button></div>`;
  else if (mode === 'choose') acts = `<div class="dec-acts wrap">${d.options.map((o) => `<button class="btn ${o.letter === d.rec ? 'primary' : ''}" data-act="dec-choose" data-slug="${d.slug}" data-letter="${o.letter}">${o.letter} · ${esc(o.label.slice(0, 32))}</button>`).join('')}
      <input class="dec-why" id="dec-why-${d.slug}" placeholder="Why (optional)" autocomplete="off"><button class="linkbtn" data-act="dec-back" data-slug="${d.slug}">Back</button></div>`;
  else if (mode === 'park') acts = `<div class="dec-acts wrap"><span class="dec-note">Not now, until</span>${[['1 week', 7], ['1 month', 30], ['3 months', 91]].map(([l, n]) => `<button class="btn" data-act="dec-park" data-slug="${d.slug}" data-date="${plus(n)}">${l}</button>`).join('')}
      <input type="date" class="dec-date" data-slug="${d.slug}" min="${plus(1)}"><button class="linkbtn" data-act="dec-back" data-slug="${d.slug}">Back</button></div>`;
  else acts = `<div class="dec-acts">${recd ? `<button class="btn primary" data-act="dec-accept" data-slug="${d.slug}" title="Record the recommendation">✓ ${d.rec} · ${esc(recd.label.slice(0, 28))}</button>` : ''}
      <button class="btn" data-act="dec-other" data-slug="${d.slug}">${recd ? 'Other…' : 'Choose…'}</button><button class="btn" data-act="dec-notnow" data-slug="${d.slug}">Not now</button>
      <button class="btn agentish" data-act="dec-discuss" data-slug="${d.slug}" title="Talk it through with the agent">Discuss</button></div>
    <div class="dec-alt"><button class="linkbtn" data-act="dec-notone" data-slug="${d.slug}" title="Nothing to choose here: close it (kept in the archive)">Not a decision</button>
      <span>·</span><span class="dec-note">it’s really a</span>${['task', 'project', 'goal'].map((k) => `<button class="linkbtn" data-act="dec-to" data-slug="${d.slug}" data-kind="${k}">${k}</button>`).join('')}</div>`;
  return `<section class="dec-card ${pending ? 'pending' : ''}">
    <div class="dec-q" data-act="dec-toggle" data-slug="${d.slug}"><div class="dec-qt">${esc(d.question)}</div>${due ? `<span class="dec-due ${cls}">${due}</span>` : ''}</div>
    ${d.rec && !expanded ? `<div class="dec-rec"><span class="lbl">Recommended ${d.rec}</span> ${inline(recWhy(d.recommendation))}</div>` : ''}
    ${expanded ? `<div class="dec-body">
      <div class="dec-opts">${d.options.map(opt).join('')}</div>
      ${d.recommendation ? `<div class="dec-sec"><div class="lbl">Recommendation</div><div class="md">${md(d.recommendation, false)}</div></div>` : ''}
      ${d.missing ? `<div class="dec-sec"><div class="lbl">Missing info</div><div class="md">${md(d.missing, false)}</div></div>` : ''}
      ${d.criteria ? `<details class="dec-sec"><summary class="lbl">Criteria</summary><div class="md">${md(d.criteria, false)}</div></details>` : ''}
      ${d.fallback ? `<div class="dec-sec"><div class="lbl">If nobody decides</div><div class="md">${md(d.fallback, false)}</div></div>` : ''}
      ${ME().obsidian ? `<a class="dec-file" href="${obsidianPath(d.file)}">Open in Obsidian ↗</a>` : ''}</div>` : `<button class="linkbtn dec-more" data-act="dec-toggle" data-slug="${d.slug}">Options, missing info…</button>`}
    ${acts}</section>`;
}
function decisionsHtml() {
  const all = S.data.decisions || [];
  const openD = all.filter((d) => d.status === 'open').sort((a, b) => (a.decide_by || '9').localeCompare(b.decide_by || '9'));
  const parked = all.filter((d) => d.status === 'parked').sort((a, b) => (a.review_at || '9').localeCompare(b.review_at || '9'));
  const done = S.decided.map((x) => `<div class="dec-done"><span>✓ <b>${esc(x.question)}</b> → ${esc(x.choice)}</span>
    ${x.task ? '<span class="dec-note">next action added</span>' : `<button class="btn" data-act="dec-next" data-slug="${esc(x.slug)}">+ Next action</button>`}</div>`).join('');
  return `<div class="decs">${done ? `<div class="dec-dones">${done}</div>` : ''}
    ${openD.map(decisionCard).join('') || '<div class="empty">No decisions waiting. They appear when a choice comes up — ask your assistant, or capture one in a chat.</div>'}
    ${parked.length ? `<div class="section-h dec-parked-h">Not now <span class="c">${parked.length}</span></div>${parked.map((d) => `<div class="dec-parked" data-act="dec-toggle" data-slug="${d.slug}">
      <span>${esc(d.question)}</span><span class="dec-note">back ${d.review_at ? fromIso(d.review_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</span></div>
      ${S.decOpen.has(d.slug) ? decisionCard(d) : ''}`).join('')}` : ''}</div>`;
}
// Close a decision without a choice ("not a decision"), or after it became a task / project / goal.
function dropDecision(d, reason = '', became = null) {
  delete S.decPick[d.slug];
  deferOp(`dec:${d.slug}`, became ? `Decision → ${became.kind}` : 'Not a decision — closed', async (leaving) => {
    const r = await post(`/api/decisions/${encodeURIComponent(d.slug)}/drop`, { reason, became }, leaving);
    if (!leaving && !r.ok) throw new Error((await r.json()).error);
  });
}
// The decision is really a task / project / goal: open that dialog prefilled; once created, the decision closes with a link.
function decisionTo(d, kind) {
  const title = d.question.replace(/\?\s*$/, '');
  const summary = [d.options.length ? `Options considered:\n${d.options.map((o) => `- ${o.letter}. ${o.label}${o.letter === d.rec ? ' (recommended)' : ''}`).join('\n')}` : '', `From the decision [[${d.slug}]].`].filter(Boolean).join('\n\n');
  const done = (slug) => dropDecision(d, '', { kind, slug });
  const home = d.about.find((a) => isProject(a.slug))?.slug;
  if (kind === 'task') return quickAdd(home ? { project: home } : {}, { title, notes: summary, source: 'decision', onSaved: (t) => done(t.id) });
  if (kind === 'project') return projectModal(null, { title, outcome: summary, onCreated: (np) => done(np.slug) });
  return goalModal(null, { title, description: summary, onCreated: (g) => done(g.slug) });
}
function recordDecision(d, letter, reason = '') {
  const o = d.options.find((x) => x.letter === letter);
  delete S.decPick[d.slug];
  deferOp(`dec:${d.slug}`, `Decided: ${letter} · ${o.label.slice(0, 36)}`, async (leaving) => {
    const r = await post(`/api/decisions/${encodeURIComponent(d.slug)}/decide`, { letter, reason }, leaving);
    if (leaving) return;
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    S.decided.push(j); // stays on screen this session with "+ Next action"
  });
}
function askAboutDecision(d) {
  S.chat = { key: `d:${d.slug}`, context: { decision: d.slug }, label: `⚖ ${d.question}`, session: null, msgs: [], busy: false, deep: S.chat?.deep || false };
  S.chatPin = S.chat.key;
  openChat();
}
document.addEventListener('change', async (e) => {
  if (!e.target.matches('.dec-date') || !e.target.value) return;
  const slug = e.target.dataset.slug;
  delete S.decPick[slug];
  await api('POST', `/api/decisions/${encodeURIComponent(slug)}/park`, { review_at: e.target.value });
  await load(); toast(`Not now — back ${fromIso(e.target.value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`);
});

// ---------- goals: success condition, horizon, area, and the projects that serve each goal ----------
const niceDate = (d) => fromIso(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const horizonLabel = (h) => (!h ? '' : /^\d{4}-\d{2}-\d{2}$/.test(h) ? `by ${niceDate(h)}` : h);
function goalsHtml() {
  const goals = S.data.goalDetails || [];
  const openCount = (slug) => S.data.tasks.filter((t) => open(t) && t.project === slug).length;
  const active = S.data.projects.filter((p) => p.status === 'active');
  return `<div class="goals">${goals.map((g) => {
    const ps = active.filter((p) => p.goal === g.slug);
    const free = active.filter((p) => p.goal !== g.slug);
    return `<section class="goal-card">
      <div class="goal-h" id="goal-${esc(g.slug)}"><h2>${esc(g.title)}<button class="goal-edit" data-act="goal-edit" data-slug="${esc(g.slug)}" title="Edit goal" aria-label="Edit goal">✎</button></h2>
        <div class="goal-meta">${g.area ? `<span><span class="dot cat-${g.area.category || 'none'}"></span> ${esc(g.area.title)}</span>` : ''}${g.horizon ? `<span>◷ ${esc(horizonLabel(g.horizon))}</span>` : ''}
          ${ME().obsidian ? `<a href="${obsidianPath(g.file)}" title="Open in Obsidian">Obsidian ↗</a>` : ''}</div></div>
      ${g.success ? `<div class="goal-sc"><div class="lbl">Done when</div><div class="md">${md(g.success, false)}</div></div>` : g.description ? `<p class="goal-desc">${inline(g.description)}</p>` : ''}
      <div class="goal-ps">${ps.map((p) => `<div class="goal-p"><span class="dot cat-${p.category || 'none'}"></span><a href="#/project/${p.slug}">${esc(p.title)}</a>
          <span class="n">${openCount(p.slug) || ''}${openCount(p.slug) ? ' open' : 'no open tasks'}</span>
          <button class="goal-x" data-act="goal-unlink" data-slug="${esc(p.slug)}" title="Unlink from this goal" aria-label="Unlink">✕</button></div>`).join('') || '<div class="empty">No projects yet.</div>'}
        ${free.length ? `<select class="goal-link" data-goal="${esc(g.slug)}" aria-label="Link a project"><option value="">+ Link a project…</option>${free.map((p) => `<option value="${esc(p.slug)}">${esc(p.title)}${p.goal ? ` (now: ${esc(p.goal)})` : ''}</option>`).join('')}</select>` : ''}
      </div></section>`;
  }).join('')}
  <button class="linkbtn goal-new" data-act="goal-new">+ New goal</button></div>`;
}
// New goal (g = null) or edit one: title, area, by when, done when; editing can also mark it achieved.
function goalModal(g = null, prefill = {}) {
  const areas = S.data.areas || [];
  $('#modal').innerHTML = `<div class="overlay" data-act="qa-close"><div class="qa pm">
    <div class="bd-h">${g ? 'Edit goal' : 'New goal'}</div>
    <input class="q" id="gm-title" autocomplete="off" placeholder="Goal — a result, e.g. Financial independence" value="${esc(g?.title || prefill.title || '')}">
    ${areas.length ? `<div class="tri"><div class="lbl">Area</div><select id="gm-area" class="pm-select"><option value="">— none —</option>${areas.map((a) => `<option value="${esc(a.slug)}" ${g?.area?.slug === a.slug ? 'selected' : ''}>${esc(a.title)}</option>`).join('')}</select></div>` : ''}
    <div class="tri"><div class="lbl">By when</div><input id="gm-horizon" class="pm-select" placeholder="2029-05-16 · 3-5 years" autocomplete="off" value="${esc(g?.horizon || '')}"></div>
    <div class="tri"><div class="lbl">Done when</div><textarea id="gm-success" rows="3" placeholder="What makes it done — numbers if you can">${esc(g?.success || prefill.success || '')}</textarea></div>
    <div class="foot">${g ? '<button class="btn ghost" id="gm-done" title="The goal is reached: archive it">✓ Achieved</button>' : ''}<span class="sp">${g ? '' : 'Creates 30_goals/&lt;slug&gt;.md from the template.'}</span>
      <button class="btn" data-act="qa-close">Cancel</button><button class="btn primary" id="gm-save">${g ? 'Save' : 'Create goal'}</button></div></div></div>`;
  autosize($('#gm-success'));
  $('#gm-title').focus();
  $('#gm-save').onclick = async () => {
    const title = $('#gm-title').value.trim();
    if (!title) return $('#gm-title').focus();
    const body = { title, area: $('#gm-area')?.value || null, horizon: $('#gm-horizon').value.trim() || null, success: $('#gm-success').value };
    if (g) { await api('PATCH', `/api/goals/${encodeURIComponent(g.slug)}`, body); closeModal(); await load(); return toast('Goal saved'); }
    const n = await api('POST', '/api/goals', { ...body, description: prefill.description || '' });
    closeModal(); await load(); toast(`Created “${n.title}”`);
    prefill.onCreated?.(n);
  };
  if (g) $('#gm-done').onclick = async () => {
    await api('PATCH', `/api/goals/${encodeURIComponent(g.slug)}`, { status: 'done' });
    closeModal(); await load(); toast(`“${g.title}” achieved — archived`);
  };
}
document.addEventListener('change', async (e) => {
  if (!e.target.matches('.goal-link') || !e.target.value) return;
  const p = proj(e.target.value);
  await api('PATCH', `/api/projects/${encodeURIComponent(e.target.value)}`, { goal: e.target.dataset.goal });
  await load(); toast(`Linked “${p?.title || e.target.value}”`);
});

// ---------- drawer ----------
function taskById(id) { return S.data.tasks.find((t) => t.id === id) || S.logbook?.find((t) => t.id === id); }

function renderDrawer(force) {
  const dr = $('#drawer');
  const t = S.openId && taskById(S.openId);
  document.body.classList.toggle('drawer-open', !!t);
  if (!t) { dr.classList.remove('on'); dr.innerHTML = ''; delete dr.dataset.id; delete dr.dataset.sig; return; }
  dr.classList.add('on');
  // Don't clobber what the user is typing; refresh only the non-input parts.
  const active = document.activeElement;
  // Keep what's being typed — unless the task itself changed state (accepted, sent back, done, reassigned):
  // then the whole card must change, typing or not. (iOS keeps focus in a textarea even after a button tap.)
  const core = `${t.status}|${t.assigned}|${agentState(t)}`;
  if (!force && dr.dataset.id === t.id && dr.dataset.core === core && dr.contains(active) && active.matches('input, textarea, select')) {
    const ab = $('.agent-strip', dr); if (ab) ab.outerHTML = agentStrip(t);
    return;
  }
  dr.dataset.core = core;
  // Skip identical re-renders (background reloads) and keep the scroll position when we do re-render.
  if (dr.dataset.id !== t.id) S.drShow = new Set();
  const sig = JSON.stringify([t, S.editingBody, agentState(t), runFor(t.id)?.id || null, S.data.projects.length, [...S.drShow]]);
  if (!force && dr.dataset.id === t.id && dr.dataset.sig === sig && dr.firstElementChild) return;
  const keepScroll = dr.dataset.id === t.id ? $('.dr-body', dr)?.scrollTop || 0 : 0;
  dr.dataset.id = t.id;
  dr.dataset.sig = sig;
  const done = t.status === 'done';
  const seg = (field, opts) => `<span class="seg">${opts.map((o) => `<button data-set="${field}" data-val="${o}" class="${t[field] === o ? `on ${o}` : ''}">${o}</button>`).join('')}</span>`;
  dr.innerHTML = `
    <div class="dr-top"><span class="sp dr-path">${esc(t.file)}</span>
      ${done ? '' : `${iconBtn('focus-start', 'focus', 'Focus on this task (f)', `data-id="${t.id}"`)}
      ${iconBtn('tb-open', 'block', 'Block time in your calendar', `data-id="${t.id}"`)}
      ${iconBtn('drop', 'drop', 'Drop — not done, no longer relevant (⌫)', `data-id="${t.id}"`)}`}
      ${ME().obsidian ? `<a class="icon-btn" href="${obsidianPath(t.file)}" title="Open in Obsidian" aria-label="Open in Obsidian">${ICON.obsidian}</a>` : ''}
      ${iconBtn('close', 'close', 'Close (Esc)')}</div>
    <div class="dr-body">
      <div class="dr-title"><button class="check p-${t.priority} ${done ? 'done' : ''}" data-act="${done ? 'reopen' : 'complete'}"></button>
        <textarea class="title-in" id="f-title" rows="1">${esc(t.title)}</textarea></div>
      <div class="props">${propsHtml(t, done, seg)}</div>
      ${t.woop || S.drShow.has('woop') ? woopHtml(t, done) : ''}
      ${t.checklist ? checklistHtml(t, done) : ''}
      ${taskChatHtml(t)}
      <div class="body-h"><span>${t.assigned === 'agent' ? 'BRIEF & NOTES' : 'NOTES'}</span><button class="btn ghost" data-act="edit-body">${S.editingBody ? 'Done' : 'Edit'}</button></div>
      ${S.editingBody ? `<textarea class="body-edit" id="f-body">${esc(t.body)}</textarea>`
        : `<div class="md" data-act="edit-body-click">${notesOf(t).trim() ? md(notesOf(t), !t.checklist) : '<p class="placeholder">Add notes… (for agents: outcome, constraints, where to put results)</p>'}</div>`}
      ${t.checklist ? '' : `<div class="sub-add"><span>+</span><input id="f-sub" placeholder="Add subtask">`}${done ? '' : `<button class="linkbtn sub-bd" data-act="breakdown" data-id="${t.id}" title="The agent suggests 3–7 concrete steps; you pick which to add">✦ Break down</button>`}${t.checklist ? '' : '</div>'}
    </div>`;
  autosize($('#f-title'));
  if ($('#f-items')) autosize($('#f-items'));
  dr.querySelectorAll('[data-woop]').forEach(autosize);
  if (S.editingBody) { const b = $('#f-body'); b.style.height = Math.max(240, b.scrollHeight + 4) + 'px'; }
  if (keepScroll) $('.dr-body', dr).scrollTop = keepScroll;
  watchTaskComposer();
}

// AICODE-NOTE: checklist tasks (`checklist: true`, shopping / packing): the items are the task's ## Subtasks, shown
// as the card's main block — open items first, ticked ones below; the box takes one item or a whole pasted list.
// Templates: 91_templates/checklists/ (lib/vault.js → "checklists").
const SUBTASKS_SECTION = /^##\s+Subtasks\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m;
const notesOf = (t) => withoutChat(t.checklist ? t.body.replace(SUBTASKS_SECTION, '') : t.body).replace(WOOP_SECTION, '');

// AICODE-NOTE: WOOP (Gabriele Oettingen) on a task: Wish · Outcome · Obstacle · Plan in its ## WOOP section (lib/vault.js
// parseWoop). Shown under the props once set (or "+ WOOP"); the plan ("If … → then …") shows as a chip in lists, on the #1
// card and in Focus. A task whose due date was pushed later 3+ times (t.moved) gets a "WOOP it?" chip. ✦ Discuss talks it
// through in the task chat: the agent offers options for each line as set_woop buttons.
const WOOP_SECTION = /^##\s+WOOP\s*$[\s\S]*?(?=^## |(?![\s\S]))/m;
const WOOP_FIELDS = [['wish', 'W', 'Wish', 'What exactly, by when'], ['outcome', 'O', 'Outcome', 'The best thing about having it done'],
  ['obstacle', 'O', 'Obstacle', 'What in me gets in the way'], ['plan', 'P', 'Plan', 'If … → then I …']];
function woopHtml(t, done) {
  const w = t.woop || {};
  return `<div class="woop-box"><div class="body-h"><span>WOOP <a class="woop-src" href="https://woopmylife.org" target="_blank" rel="noopener" title="WOOP — Wish, Outcome, Obstacle, Plan: Gabriele Oettingen's mental contrasting with implementation intentions">· Oettingen ↗</a></span>${done ? '' : `<button class="btn ghost" data-act="woop-chat" title="Talk it through with the agent: it offers options for each line">✦ Discuss</button>`}</div>
    <div class="woop">${WOOP_FIELDS.map(([k, l, label, ph]) => `<div class="wrow ${k}"><span class="wl">${l}</span><div class="wf"><span class="wk">${label}</span>
      <textarea rows="1" data-woop="${k}" placeholder="${esc(ph)}" ${done ? 'disabled' : ''}>${esc(w[k] || '')}</textarea></div></div>`).join('')}</div></div>`;
}
const woopShort = (plan) => { const p = plan.replace(/^if\s+/i, ''); return p.length > 38 ? `${p.slice(0, 37)}…` : p; };
const woopPlanHtml = (plan) => esc(plan).replace(/^(If)\b/i, '<b>$1</b>').replace(/\s*(→\s*then|→|then)\s+/i, ' <b>→ then</b> ');
function checklistHtml(t, done) {
  const items = t.subtasks, got = items.filter((x) => x.done);
  const row = (x) => `<div class="cl-row ${x.done ? 'done' : ''}" data-ck="${x.i}"><span class="cl-box"></span><span class="cl-t">${inline(x.text)}</span>
    ${done ? '' : `<button class="cl-x" data-act="cl-remove" data-rm="${x.i}" title="Remove" aria-label="Remove">✕</button>`}</div>`;
  return `<div class="cl"><div class="body-h"><span>CHECKLIST${items.length ? ` · ${got.length}/${items.length}` : ''}</span><span class="cl-acts">
      ${got.length && !done ? '<button class="btn ghost" data-act="cl-reset">Uncheck all</button>' : ''}${items.length ? '<button class="btn ghost" data-act="cl-template" title="Start new lists from these items (in Add task → ☑ List)">Save as template</button>' : ''}</span></div>
    ${items.filter((x) => !x.done).map(row).join('')}${got.length ? `<div class="cl-got">${got.map(row).join('')}</div>` : ''}
    ${done ? '' : '<div class="sub-add"><span>+</span><textarea id="f-items" rows="1" placeholder="Add items — one per line, or paste a list"></textarea></div>'}</div>`;
}

// iOS date pickers have no way to empty a set date: a ✕ next to it does.
const clearBtn = (t, k, done) => (t[k] && !done ? `<button class="prop-clear" data-act="prop-clear" data-k="${k}" title="Clear" aria-label="Clear ${k}">✕</button>` : '');

// Task fields: the everyday ones always; the rest only when set, or when revealed from the "+ …" line.
S.drShow = new Set(); // fields revealed in the open task (reset when another task opens)
function propsHtml(t, done, seg) {
  const projects = S.data.projects.filter((p) => p.status === 'active' || p.slug === t.project);
  const cont = !isProject(t.project) && proj(t.project); // filed under a model container: keep it selectable as is
  const rows = [
    ['project', 'Project', true, `<select id="f-project"><option value="">— Inbox —</option>${cont ? `<option value="${esc(cont.slug)}" selected>${esc(cont.title)}</option>` : ''}${projects.map((p) => `<option value="${p.slug}" ${p.slug === t.project ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}
      <option value="__new__">+ New project…</option></select>`],
    ['due', 'Due', true, `<input type="date" id="f-due" value="${t.due || ''}">${clearBtn(t, 'due', done)}`],
    ['priority', 'Priority', true, seg('priority', ['urgent', 'planned', 'someday'])],
    ['assigned', 'Owner', true, seg('assigned', ['me', 'agent', 'someone'])],
    ['agent', 'Agent', t.assigned === 'agent' && !done, `<span class="seg seg-wrap">${[['', 'Any'], ...agentList().filter((x) => (x.on && agentReady(x)) || x.id === t.agent).map((x) => [x.id, x.name])].map(([v, l]) => `<button data-set="agent" data-val="${v}" class="${(t.agent || '') === v ? 'on agent' : ''}" title="${esc(agentHint(v || 'any'))}">${esc(l)}</button>`).join('')}</span>`],
    ['deadline', 'Deadline', !!t.deadline, `<input type="date" id="f-deadline" value="${t.deadline || ''}">${clearBtn(t, 'deadline', done)}`],
    ['reminder', 'Remind', !!t.reminder, `<input type="datetime-local" id="f-reminder" value="${(t.reminder || '').slice(0, 16)}" step="300">${clearBtn(t, 'reminder', done)}`],
    ['status', 'Status', t.status === 'wait' || done, done ? '<span class="pill">done</span>' : seg('status', ['new', 'wait'])],
    ['time', 'Time', !!t.timeblocks?.length, `<div class="tb-row">${(t.timeblocks || []).map((b) => `<span class="tb-chip ${b.end < nowLocal() ? 'past' : ''}">⏱ ${tbLabel(b)}${b.label ? ` · ${esc(b.label.slice(0, 30))}` : ''}
      <button class="tb-x" data-act="tb-remove" data-ev="${esc(b.event)}" title="Remove from calendar">✕</button></span>`).join('')}</div>`],
    ['estimate', 'Takes', !!t.estimate || (!done && t.assigned !== 'agent' && S.planEst?.[t.id] != null), done ? (t.estimate ? `<span>~${planMins(t.estimate)}</span>` : '') : estPickerHtml(t.id, t.estimate, t.estimate ? null : S.planEst?.[t.id])],
    ['labels', 'Labels', !!t.labels.length, `<input id="f-labels" value="${esc(t.labels.join(', '))}" placeholder="comma-separated">`],
    ['checklist', 'Checklist', t.checklist, '<button class="linkbtn" data-act="cl-off" title="Back to a plain task: items stay as subtasks">Turn off</button>'],
    ['woop', 'WOOP', !!t.woop, ''], // its own block under the props (woopHtml)
    ['recurrence', 'Repeat', !!t.recurrence, `<input id="f-recurrence" value="${esc(describeRepeat(t.recurrence || ''))}" placeholder="every monday · каждый месяц 1-го" title="${esc(t.recurrence || '')}">`],
  ];
  const shown = rows.filter(([k, , on]) => on || S.drShow.has(k));
  const hidden = rows.filter(([k, , on]) => !on && !S.drShow.has(k) && k !== 'time' && k !== 'agent');
  return shown.filter(([k]) => k !== 'woop').map(([, label, , html]) => `<label>${label}</label><div>${html}</div>`).join('')
    + (hidden.length && !done ? `<span></span><div class="props-more">${hidden.map(([k, label]) => `<button class="linkbtn" data-act="${k === 'checklist' ? 'cl-on' : 'prop-show'}" data-k="${k}">+ ${k === 'status' ? 'Waiting' : label}</button>`).join('')}</div>` : '');
}

// One line above the task chat: the agent's state and the buttons that belong to it. Replies go through the chat box.
// AICODE-NOTE: Ask, task chat and Run are one conversation now (option A, 2026-09-28): the agent's reports come from
// ## Agent log into the same feed, and "▶ Do it" starts a run from the chat.
// Agents come from Settings → Agents (lib/settings.js agentList): name, how it starts (run), shown in the picker (on).
// run: claude / codex / gemini = started here with that CLI (▶ Run); queue = it takes its own queue (an assistant, a session
// elsewhere); dev = the app developer's Claude Code session in the app's code (only on the developer's own install).
const agentList = () => S.settings?.agentList || [{ id: 'claude', name: 'Claude', run: 'claude', on: true },
  ...(ME().assistant ? [{ id: ME().assistant.id, name: ME().assistant.name, run: 'queue', on: true }] : []), { id: 'codex', name: 'Codex', run: 'codex', on: true }, { id: 'gemini', name: 'Gemini', run: 'gemini', on: true }];
const agentOf = (id) => agentList().find((a) => a.id === id);
// a built-in model agent whose CLI isn't on this Mac (or not signed in) stays out of the task's picker
const agentReady = (a) => !(MODEL_CLI[a.run] && S.data.agents?.[a.run] === false);
const agentNames = () => Object.fromEntries(agentList().map((a) => [a.id, a.name]));
const agentName = (id) => agentOf(id)?.name || (id ? id[0].toUpperCase() + id.slice(1) : 'agent');
// the model the app uses (Settings → Agents → Model, lib/llm.js): a task with no agent runs with it
const MODEL_CLI = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI' };
const appModel = () => S.data.agents?.provider || 'claude';
// started here (when that model's CLI is on this Mac) or not: then it takes its own queue
const agentRun = (id) => { const r = agentOf(id)?.run || appModel(); return MODEL_CLI[r] && S.data.agents?.[r] === false ? 'queue' : r; };
const isAssistant = (id) => !!id && ['queue', 'dev'].includes(agentRun(id)); // takes its own queue
const RUN_HINT = { claude: 'Claude Code, run from this app', codex: 'Codex, run from this app', gemini: 'Gemini CLI, run from this app', queue: 'picks it up on their own', dev: 'the app’s developer session (Claude Code in the app’s code): fixes, tests, deploys' };
const agentHint = (id) => (id === 'any' ? 'Any agent — you start it (▶ Run now) or one takes it' : `${agentName(id)}: ${RUN_HINT[agentRun(id)] || ''}`);
function agentStrip(t) {
  if (t.status === 'done') return '';
  const st = agentState(t), run = runFor(t.id);
  if (t.assigned !== 'agent' && !run) return '';
  const lastRun = [...S.data.runs].reverse().find((r) => r.taskId === t.id);
  const events = (run || lastRun) ? S.runLog[(run || lastRun).id] : null;
  const back = '<button class="linkbtn" data-set="assigned" data-val="me" title="Take the task back from the agent">Take back</button>';
  const noBrief = !t.body.replace(/^##\s+Subtasks\s*$/m, '').replace(/^\s*- \[ \]\s*$/gm, '').trim();
  let line, btns;
  if (!run && st === 'running' && t.agent === 'dev') { line = 'The dev session is working on it'; btns = ''; }
  else if (run || st === 'running') { line = `${agentName(run?.who) || 'The agent'} is working… <span id="strip-now">${esc(runNow(events))}</span>`; btns = '<button class="btn" data-act="stop">■ Stop</button>'; }
  else if (st === 'review') {
    line = 'Done — check the result above';
    btns = `<button class="btn primary" data-act="accept" title="Approve; the task stays open and comes back to you">✓ Accept</button>
      <button class="btn" data-act="accept-close" title="Approve and complete the task">Accept & close</button>
      <button class="btn" data-act="sendback-run" title="Write what to change in the box below, then tap">↺ Send back</button>`;
  } else if (st === 'blocked') { line = 'Needs your answer — reply below'; btns = `<button class="btn agent" data-act="sendback-run" title="Send your answer from the box below and run again">Reply & run</button>${back}`; }
  else {
    const mode = t.agent ? agentRun(t.agent) : appModel(), queued = t.agent_state === 'queued';
    const who = mode === 'dev' ? (queued ? 'Queued for the dev session — it takes the queue in order' : 'For the dev session — ▶ Queue it')
      : mode === 'queue' ? (queued ? `Queued for ${agentName(t.agent)} — picks it up on their own` : `For ${agentName(t.agent)} — ▶ Queue it`)
      : mode !== appModel() ? `Queued for ${agentName(t.agent)}` : t.agent ? `For ${agentName(t.agent)}` : 'Queued for an agent';
    line = `${who}${noBrief ? ' · no brief yet, it only sees the title' : ''}`;
    const now = `<button class="linkbtn" data-act="run" data-now="1" title="Don't wait: run ${MODEL_CLI[appModel()]} on it now">Run with ${esc(S.data.agents?.providerName || 'Claude')} now</button>`;
    btns = mode === 'dev' ? (queued ? back : `<button class="btn agent" data-act="run" title="Put it in the dev session's queue">▶ Queue</button>${back}`)
      : mode === 'queue' ? `${queued ? '' : `<button class="btn agent" data-act="run" title="Put it in ${esc(agentName(t.agent))}'s queue">▶ Queue</button>`}${now}${back}`
      : mode !== appModel() ? `<button class="btn agent" data-act="run" title="Run ${MODEL_CLI[mode]} on this task now (writes only in the vault)">▶ Run ${esc(agentName(t.agent))}</button>${back}`
      : `<button class="btn agent" data-act="run" title="Run ${MODEL_CLI[mode]} on this task now">▶ Run now</button>${back}`;
  }
  const con = events?.length ? `<details class="run-log" ${run ? 'open' : ''}><summary>${run ? 'Live' : `Last run · ${lastRun?.state || ''}`}</summary><div class="console" id="console">${events.map(evHtml).join('')}</div></details>` : '';
  return `<div class="agent-strip ${st}"><div class="as-line"><span class="as-who">✦</span><span class="as-text">${line}</span></div><div class="as-btns">${btns}</div>${con}</div>`;
}
// The latest thing a running agent did, for the strip.
function runNow(events) {
  const ev = [...(events || [])].reverse().find((e) => e.kind === 'tool' || e.kind === 'text');
  return ev ? `${ev.kind === 'tool' ? `${ev.name} ` : ''}${ev.text || ''}`.replace(/\s+/g, ' ').slice(0, 80) : 'starting';
}

function evHtml(e) {
  if (e.kind === 'tool') return `<div class="tool">→ ${esc(e.name)} ${esc(e.text)}</div>`;
  if (e.kind === 'text') return `<div>${esc(e.text)}</div>`;
  if (e.kind === 'error') return `<div class="err">${esc(e.text)}</div>`;
  if (e.kind === 'result') return `<div class="res">■ ${e.error ? 'error' : 'done'}${e.cost != null ? ` · $${e.cost.toFixed(2)}` : ''}${e.turns ? ` · ${e.turns} turns` : ''}</div>`;
  if (e.kind === 'end') return `<div class="res">— run ${esc(e.state)}</div>`;
  return '';
}

function autosize(el) { if (!el) return; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }

// ---------- markdown (small, vault-aware) ----------
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
    // attachments: ![[photo.jpg]] → thumbnail, [[doc.pdf]] → opens the file; other [[links]] → Obsidian
    .replace(/!\[\[([^\]|]+\.(?:png|jpe?g|gif|webp))\]\]/gi, (_, n) => `<a href="/api/attachment-by-name?name=${encodeURIComponent(n)}" target="_blank" rel="noopener"><img class="att-img" loading="lazy" src="/api/attachment-by-name?name=${encodeURIComponent(n)}" alt="${n}"></a>`)
    .replace(/!?\[\[([^\]|]+\.(?:pdf|png|jpe?g|gif|webp|heic|txt|csv|docx?|xlsx?))\]\]/gi, (_, n) => `<a class="att-file" href="/api/attachment-by-name?name=${encodeURIComponent(n)}" target="_blank" rel="noopener">📎 ${n}</a>`)
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => (obsidianUrl(target) ? `<a class="wl" href="${obsidianUrl(target)}">${alias || target}</a>` : `<span class="wl">${alias || target}</span>`))
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
}

function md(src, interactive) {
  const lines = src.replace(/<!--[\s\S]*?-->/g, (m) => (m.includes('\n') ? '\n'.repeat(m.split('\n').length - 1) : '')).split('\n');
  let html = '', fence = null, list = false, para = [], ck = 0;
  const flushP = () => { if (para.length) { html += `<p>${para.map(inline).join('<br>')}</p>`; para = []; } };
  const closeList = () => { if (list) { html += '</ul>'; list = false; } };
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (fence !== null) { html += `<pre>${esc(fence)}</pre>`; fence = null; } else { flushP(); closeList(); fence = ''; }
      continue;
    }
    if (fence !== null) { fence += line + '\n'; continue; }
    let m;
    if ((m = line.match(/^\s*[-*+] \[([ xX])\]\s?(.*)$/))) {
      flushP(); closeList();
      const i = ck++;
      if (!m[2].trim()) continue;
      const done = m[1] !== ' ';
      html += `<div class="ck ${done ? 'done' : ''}"><input type="checkbox" ${done ? 'checked' : ''} ${interactive ? `data-ck="${i}"` : 'disabled'}><span>${inline(m[2])}</span></div>`;
    } else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flushP(); closeList();
      html += `<h${Math.min(m[1].length + 1, 4)}>${inline(m[2])}</h${Math.min(m[1].length + 1, 4)}>`;
    } else if ((m = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/))) {
      flushP();
      if (!list) { html += '<ul>'; list = true; }
      html += `<li>${inline(m[1])}</li>`;
    } else if (list && /^\s{2,}\S/.test(line)) {
      html = html.replace(/<\/li>$/, `<br>${inline(line.trim())}</li>`);
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      flushP(); closeList();
      html += `<blockquote>${inline(m[1])}</blockquote>`;
    } else if (!line.trim()) {
      flushP(); closeList();
    } else {
      closeList(); para.push(line);
    }
  }
  flushP(); closeList();
  if (fence !== null) html += `<pre>${esc(fence)}</pre>`;
  return html;
}

// Obsidian links only when an Obsidian vault is configured (~/.config/gubernos/config.json → obsidian)
const obsidianUrl = (file) => { const o = ME().obsidian; return o ? `obsidian://open?vault=${encodeURIComponent(o.vault)}&file=${encodeURIComponent(o.path ? `${o.path}/${file}` : file)}` : null; };
function obsidianPath(file) { return (file && obsidianUrl(file)) || '#'; }

// ---------- theme ----------
// system → light → dark; stored per browser, applied before first paint by index.html.
const THEMES = { system: ['◐', 'Theme: system'], light: ['☀', 'Theme: light'], dark: ['☾', 'Theme: dark'] };
function currentTheme() { try { return localStorage.getItem('theme') || 'system'; } catch { return 'system'; } }
function applyTheme(t) {
  if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  try { t === 'system' ? localStorage.removeItem('theme') : localStorage.setItem('theme', t); } catch { /* private mode */ }
  document.querySelector('meta[name=theme-color]').content = getComputedStyle(document.body).getPropertyValue('--bg').trim();
}
function cycleTheme() {
  const order = Object.keys(THEMES);
  const next = order[(order.indexOf(currentTheme()) + 1) % order.length];
  applyTheme(next);
  toast(THEMES[next][1]);
  renderMain();
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(currentTheme()));
// Colours (Settings → Colours): palette 0–4 for all devices (settings.palette), cached per device so index.html paints it at once
const PALETTES = [['Classic', '#e5372b', '#131111'], ['Helm', '#111111', '#d0142f'], ['Oxblood', '#8e1c2c', '#0d0d0d'], ['Navy', '#163e70', '#d9a441'], ['Teal', '#0f766e', '#0b2b29']];
function applyPalette(n) {
  n = [1, 2, 3, 4].includes(Number(n)) ? Number(n) : 0;
  if (n) document.documentElement.dataset.palette = String(n); else delete document.documentElement.dataset.palette;
  try { n ? localStorage.setItem('palette', String(n)) : localStorage.removeItem('palette'); } catch { /* private mode */ }
  document.querySelector('meta[name=theme-color]').content = getComputedStyle(document.body).getPropertyValue('--bg').trim();
}

// ---------- actions ----------
async function patch(id, body) {
  const t = await api('PATCH', `/api/tasks/${id}`, body);
  replaceTask(t);
  return t;
}
function replaceTask(t) {
  const i = S.data.tasks.findIndex((x) => x.id === t.id);
  if (i >= 0) S.data.tasks[i] = t; else if (t.folder === 'tasks') S.data.tasks.push(t);
}

// ---------- completion with a grace period ----------
// AICODE-NOTE: completing is deferred GRACE_MS so a mis-tap can be undone right in the row. Nothing is written
// to the vault (so Todoist sync can't see it) until the grace period ends; leaving the page commits immediately.
let GRACE_MS = 5000; // Settings → Undo window
const pendingDone = new Map(); // id -> { timer, until, committing }

function complete(id, { drop = false, carry } = {}) {
  const p = pendingDone.get(id);
  if (p) return p.committing ? undefined : undoComplete(id);
  const t = taskById(id);
  const left = t?.checklist && !t.recurrence ? t.subtasks.filter((x) => !x.done) : [];
  if (!drop && left.length && carry === undefined) return checklistLeft(t, left);
  pendingDone.set(id, { timer: setTimeout(() => commitComplete(id), GRACE_MS), until: Date.now() + GRACE_MS, drop, carry: !!carry });
  if (S.openId === id) { S.openId = null; S.editingBody = false; }
  toast(`${drop ? 'Dropped' : 'Completed'} “${(t?.title || '').slice(0, 40)}”${carry ? ` · ${left.length} left → new list` : ''}`, 'Undo', () => undoComplete(id), GRACE_MS);
  render();
  countdown();
}

// A checklist done with items still open (the shop didn't have them): keep those in a new list, or just complete.
function checklistLeft(t, left) {
  $('#modal').innerHTML = `<div class="overlay" data-act="qa-close"><div class="qa cl-left">
    <div class="cl-left-h">${left.length} item${left.length === 1 ? '' : 's'} not ticked</div>
    <div class="cl-left-l">${left.slice(0, 8).map((x) => esc(x.text)).join(' · ')}${left.length > 8 ? ` · +${left.length - 8}` : ''}</div>
    <div class="foot"><span class="sp"></span><button class="btn" data-act="qa-close">Cancel</button><button class="btn" id="cl-plain">Just complete</button><button class="btn primary" id="cl-carry">Move to a new list</button></div></div></div>`;
  $('#cl-plain').onclick = () => { closeModal(); complete(t.id, { carry: false }); };
  $('#cl-carry').onclick = () => { closeModal(); complete(t.id, { carry: true }); };
  $('#cl-carry').focus();
}

function undoComplete(id) {
  const p = pendingDone.get(id);
  if (!p || p.committing) return;
  clearTimeout(p.timer);
  pendingDone.delete(id);
  hideToast();
  if (S.focus) { S.focus.id = id; saveFocus(); }
  render();
}

async function commitComplete(id, leaving = false) {
  const p = pendingDone.get(id);
  if (!p || p.committing) return;
  clearTimeout(p.timer);
  p.committing = true;
  try {
    const r = await fetch(`/api/tasks/${id}/${p.drop ? 'drop' : 'complete'}`, { method: 'POST', keepalive: leaving,
      ...(p.carry ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ carry: true }) } : {}) });
    if (leaving) return;
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    if (j.recurred) toast(`Next: ${dateLabel(j.recurred)[0]}`);
    await load();
  } catch (e) {
    toast(`Could not complete: ${e.message || 'network error'}`);
  } finally {
    if (!leaving) { pendingDone.delete(id); render(); }
  }
}

const dropTask = (id) => complete(id, { drop: true });
function flushPending() { for (const id of pendingDone.keys()) commitComplete(id, true); }
window.addEventListener('pagehide', flushPending);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushPending(); });

let countdownTimer;
function countdown() {
  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    if (!pendingDone.size) return clearInterval(countdownTimer);
    for (const el of document.querySelectorAll('.undo[data-id]')) {
      const p = pendingDone.get(el.dataset.id);
      const cd = el.querySelector('.cd');
      if (p && cd) cd.textContent = Math.max(0, Math.ceil((p.until - Date.now()) / 1000));
    }
  }, 250);
}

// ---------- swipe right to complete, swipe left to reschedule (touch) ----------
// Also on the Protocol screen (and Close the day): a habit row (.hb-row → done; a quit habit → kept), right only;
// Score your day (needs a level) and the drag handle don't swipe.
// AICODE-NOTE: rows are touch-action: pan-y, so the browser keeps vertical scrolling and hands horizontal drags to us
// (a vertical scroll fires pointercancel). Past SWIPE_AT of the row width it commits via complete() — same grace/Undo
// as the check button. Mouse is ignored (desktop has x), as are starts at the screen edge (iOS Safari back gesture).
const SWIPE_AT = 0.35, SWIPE_LEFT_AT = 0.25;
let swipe = null; // { row, id, pid, x0, y0, on, armed, left }
let swallowClickUntil = 0;

document.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' || !e.isPrimary || e.clientX < 20) return;
  if (e.target.closest('[data-drag], input, .hb-score, .hb-qc')) return;
  const row = e.target.closest('#main .row, #main .day .hb-row');
  if (!row || row.classList.contains('is-done') || row.querySelector('.hb-score')) return;
  const kind = row.classList.contains('hb-row') ? 'habit' : 'task';
  swipe = { row, id: row.dataset.id || row.dataset.slug, kind, pid: e.pointerId, x0: e.clientX, y0: e.clientY, on: false, armed: false };
});

document.addEventListener('pointermove', (e) => {
  if (!swipe || e.pointerId !== swipe.pid) return;
  const dx = e.clientX - swipe.x0, dy = e.clientY - swipe.y0;
  if (!swipe.on) {
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { swipe = null; return; }
    if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0 && swipe.kind === 'plan') { swipe = null; return; } // the day's plan: right only; a habit: left = skip the day
    swipe.on = true;
    swipe.left = dx < 0;
    swipe.row.classList.remove('snap');
    swipe.row.classList.add('swiping');
    swipe.row.classList.toggle('left', swipe.left);
  }
  const w = swipe.row.offsetWidth;
  const d = swipe.left ? Math.min(Math.max(0, -dx), w * 0.6) : Math.min(Math.max(0, dx), w);
  swipe.row.style.setProperty('--sw', `${swipe.left ? -d : d}px`);
  swipe.row.style.setProperty('--swa', `${d}px`);
  const armed = d > w * (swipe.left ? SWIPE_LEFT_AT : SWIPE_AT);
  if (armed !== swipe.armed) { swipe.armed = armed; swipe.row.classList.toggle('armed', armed); if (armed) navigator.vibrate?.(10); }
});

function endSwipe(e) {
  if (!swipe || e.pointerId !== swipe.pid) return;
  const { row, id, on, armed, left, kind } = swipe;
  swipe = null;
  if (!on) return;
  swallowClickUntil = Date.now() + 400; // the lifted finger must not also open the drawer
  row.classList.add('snap');
  if (left) { // snap back and offer the new date
    row.style.setProperty('--sw', '0px'); row.style.setProperty('--swa', '0px');
    setTimeout(() => row.classList.remove('swiping', 'armed', 'snap', 'left'), 200);
    if (armed && e.type === 'pointerup') { if (kind === 'habit') swipeHabit(id, true); else moveSheet(id); }
    return;
  }
  if (armed && e.type === 'pointerup') {
    row.style.setProperty('--sw', `${row.offsetWidth}px`);
    setTimeout(() => (kind === 'habit' ? swipeHabit(id) : complete(id)), 160); // complete() re-renders the row as done with Undo
  } else {
    row.style.setProperty('--sw', '0px');
    setTimeout(() => row.classList.remove('swiping', 'armed', 'snap'), 200);
  }
}
// a habit swiped right: done (a target habit records its target), a quit habit kept — with Undo
async function swipeHabit(slug, skip = false) {
  const h = S.day?.habits.find((x) => x.slug === slug);
  if (!h) return;
  const date = S.day.date;
  try { S.day = await api('PUT', `/api/habits/${encodeURIComponent(slug)}/checkin`, { date, ...(skip ? { skip: true } : h.kind === 'quit' ? { kept: true } : { done: true }) }); } catch (e) { renderMain(); return toast(e.message); }
  if (date === S.data.today && S.data.day) { S.data.day.summary = S.day.summary; syncNativeReminders(); }
  renderMain();
  toast(`${h.title.slice(0, 40)} — ${skip ? 'skipped today' : h.kind === 'quit' ? 'kept' : 'done'}`, 'Undo', async () => { S.day = await api('PUT', `/api/habits/${encodeURIComponent(slug)}/checkin`, { date, clear: true }); renderMain(); }, GRACE_MS);
}
document.addEventListener('pointerup', endSwipe);
document.addEventListener('pointercancel', endSwipe);
document.addEventListener('click', (e) => { if (Date.now() < swallowClickUntil) { e.stopPropagation(); e.preventDefault(); } }, true);

// Reschedule sheet (swipe left): Tomorrow / Weekend / Next week / a picked date, with Undo.
function moveSheet(id) {
  const t = taskById(id);
  if (!t) return;
  const td = fromIso(S.data.today), dow = td.getDay();
  const plus = (n) => { const x = new Date(td); x.setDate(x.getDate() + n); return iso(x); };
  const opts = [
    ['Tomorrow', plus(1)],
    ['Weekend', plus(dow === 6 ? 1 : (6 - dow + 7) % 7 || 7)], // the coming Saturday (Sunday if it's Saturday already)
    ['Next week', plus(((8 - dow) % 7) || 7)], // next Monday
  ];
  const day = (d) => fromIso(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  $('#modal').innerHTML = `<div class="overlay sheet-ov" data-act="qa-close"><div class="qa move-sheet">
    <div class="bd-h">Move to</div><div class="bd-t">${inline(t.title)}</div>
    <div class="move-opts">${opts.map(([l, d]) => `<button class="move-opt" data-due="${d}"><b>${l}</b><span>${day(d)}</span></button>`).join('')}
      <label class="move-opt pick"><b>Pick a date</b><input type="date" id="move-date" value="${t.due || ''}"></label></div>
    <div class="foot"><span class="sp">${t.due ? `Now: ${dateLabel(t.due)[0]}` : 'No date yet'}</span><button class="btn" data-act="qa-close">Cancel</button></div></div></div>`;
  const go = async (due) => {
    closeModal();
    const old = t.due;
    await patch(id, { due });
    render();
    toast(`“${t.title.slice(0, 36)}” → ${dateLabel(due)[0]}`, 'Undo', async () => { await patch(id, { due: old }); render(); }, GRACE_MS);
  };
  $('.move-sheet').onclick = (e) => { const b = e.target.closest('[data-due]'); if (b) go(b.dataset.due); };
  $('#move-date').onchange = (e) => { if (e.target.value) go(e.target.value); };
}

async function startRun(id, brief = '', agent = null, now = false) {
  const run = await api('POST', `/api/tasks/${id}/run`, brief || agent || now ? { brief, agent, now } : undefined);
  if (run.state === 'running') { S.data.runs.push(run); follow(run.id); } // dev: queued for the session, nothing to follow
  await load();
}

function follow(runId) {
  S.runLog[runId] = [];
  const es = new EventSource(`/api/runs/${runId}/stream`);
  es.onmessage = (m) => {
    const ev = JSON.parse(m.data);
    S.runLog[runId].push(ev);
    const con = $('#console');
    if (con) { con.insertAdjacentHTML('beforeend', evHtml(ev)); con.scrollTop = con.scrollHeight; const now = $('#strip-now'); if (now) now.textContent = runNow(S.runLog[runId]); }
    else renderDrawer();
    if (ev.kind === 'end') { es.close(); load(); }
  };
  es.onerror = () => es.close();
}

let toastTimer;
function hideToast() { clearTimeout(toastTimer); $('#toast').innerHTML = ''; }
function toast(msg, label, fn, ms = 5000) {
  const el = $('#toast');
  el.innerHTML = `<div class="toast">${esc(msg)}${label ? `<button>${esc(label)}</button>` : ''}</div>`;
  // The latest Undo stays reachable by voice ("undo") for as long as its toast is up.
  S.lastUndo = label === 'Undo' && fn ? { fn, until: Date.now() + ms } : S.lastUndo;
  if (fn) el.querySelector('button').onclick = () => { el.innerHTML = ''; if (S.lastUndo?.fn === fn) S.lastUndo = null; fn(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.innerHTML = ''), ms);
}

// ---------- quick add ----------
const tplOf = (slug) => S.data.checklists?.find((x) => x.slug === slug);
function quickAdd(defaults = {}, prefill = {}, opts = {}) {
  document.body.classList.remove('side-open');
  const ctx = { ...(S.view === 'project' ? { project: S.arg } : {}), ...(S.view === 'agent' ? { assigned: 'agent' } : {}), ...(S.view === 'today' ? { due: S.data.today } : {}), ...defaults };
  $('#modal').innerHTML = `<div class="overlay" data-act="qa-close"><div class="qa qa-add">
    <input class="q" id="qa-in" autocomplete="off" placeholder="Task name — try: draft SSI report fri p1 #personal-os @agent">
    <div class="sugg" id="qa-sugg" hidden></div>
    <textarea id="qa-notes" rows="1" placeholder="Description"></textarea>
    <div class="qa-tools" id="qa-tools"></div>
    <div class="qa-pop" id="qa-pop" hidden></div>
    <div class="chips" id="qa-chips"></div>
    <div id="qa-voice" hidden></div>
    <div class="foot"><button class="btn mic" data-act="qa-mic" title="Dictate (v)">${MIC_SVG}</button><span class="sp">or type: fri · завтра · every monday · p1 · #project · @agent · {deadline}</span>
      <label class="run" id="qa-runwrap" hidden><input type="checkbox" id="qa-run"> run now</label>
      <button class="btn" data-act="qa-close">Cancel</button><button class="btn" data-act="qa-note" title="Keep it in the Inbox as a note and decide later">Save as note</button><button class="btn primary" data-act="qa-save" id="qa-savebtn">Add task</button></div>
  </div></div>`;
  const input = $('#qa-in'), notes = $('#qa-notes');
  if (matchMedia('(max-width: 800px)').matches) input.placeholder = 'Task name';
  input.value = prefill.title || '';
  notes.value = prefill.notes || '';
  autosize(notes);
  let sugg = [], suggI = 0;
  // Values picked with the buttons under the title. The latest wins: typing "fri" after picking Tomorrow → Friday.
  const picked = {};
  let prevTyped = {};
  let pop = null;
  const parsed = () => {
    const p = parseQuick(input.value, { projects: S.data.projects.filter((x) => x.status === 'active'), today: S.data.today, assistant: ME().assistant?.id });
    for (const k of ['due', 'priority', 'assigned', 'project']) {
      if (k in picked) p[k] = picked[k];
      else if (p[k] == null && ctx[k] != null) p[k] = ctx[k];
    }
    if (p.time && p.due) p.reminder = `${p.due}T${p.time}`; // a typed time rings on the final date (also one picked with a button)
    return p;
  };
  const PRIO = { urgent: 'P1', planned: 'P2', someday: 'P4' };
  const drawTools = (p) => {
    const on = (x) => (x ? 'on' : '');
    $('#qa-tools').innerHTML = `
      <button class="qt ${on(p.due)} ${p.due ? dateLabel(p.due)[1] : ''} ${pop === 'date' ? 'open' : ''}" data-qt="date">◷ ${p.due ? dateLabel(p.due)[0] : 'Date'}</button>
      <button class="qt ${on(p.project)} ${pop === 'project' ? 'open' : ''}" data-qt="project"># ${p.project ? esc(proj(p.project)?.title || p.project) : 'Inbox'}</button>
      <button class="qt ${on(p.priority && p.priority !== 'planned')} p-${p.priority || 'planned'} ${pop === 'prio' ? 'open' : ''}" data-qt="prio">⚑ ${PRIO[p.priority || 'planned']}</button>
      <button class="qt ${p.assigned === 'agent' ? 'on agent' : ''}" data-qt="agent" title="Give it to an agent">✦ Agent</button>
      <button class="qt ${on(picked.checklist)} ${pop === 'list' ? 'open' : ''}" data-qt="list" title="A checklist: shopping, packing… paste the items into the description">☑ ${picked.template ? esc(tplOf(picked.template)?.title || 'List') : 'List'}</button>`;
    const box = $('#qa-pop');
    box.hidden = !pop;
    if (!pop) return;
    const opt = (k, v, label, cur) => `<button class="chip ${cur ? 'on' : ''}" data-pk="${k}" data-pv="${esc(v)}">${label}</button>`;
    const td = S.data.today, d = (n) => { const x = fromIso(td); x.setDate(x.getDate() + n); return iso(x); };
    const dow = fromIso(td).getDay();
    if (pop === 'date') box.innerHTML = `<div class="chips">${opt('due', td, 'Today', p.due === td)}${opt('due', d(1), 'Tomorrow', p.due === d(1))}
      ${opt('due', d(((6 - dow + 7) % 7) || 7), 'Weekend', false)}${opt('due', d(((8 - dow) % 7) || 7), 'Next week', false)}${opt('due', '', 'No date', !p.due)}
      <input type="date" id="qa-date" value="${p.due || ''}"></div>`;
    if (pop === 'project' && newProj) box.innerHTML = `<div class="np">
      <input id="qa-np-title" placeholder="New project name" autocomplete="off" value="${esc(newProj.title)}">
      <div class="chips">${cats().map((c) => `<button class="chip ${newProj.cat === c ? 'on' : ''}" data-np-cat="${c}"><span class="dot cat-${c}"></span> ${c}</button>`).join('')}</div>
      <div class="np-acts"><button class="btn ghost" data-np="back">Back</button><button class="btn primary" data-np="create">Create project</button></div></div>`;
    else if (pop === 'project') box.innerHTML = `<div class="chips">${opt('project', '', 'Inbox', !p.project)}${S.data.projects.filter((x) => x.status === 'active')
      .map((x) => opt('project', x.slug, `<span class="dot cat-${x.category || 'none'}"></span> ${esc(x.title)}`, p.project === x.slug)).join('')}
      <button class="chip np-add" data-np="open">+ New project</button></div>`;
    if (pop === 'list') box.innerHTML = `<div class="chips">${opt('list', '', 'Empty checklist', picked.checklist && !picked.template)}${(S.data.checklists || [])
      .map((x) => opt('list', x.slug, `☑ ${esc(x.title)} <span class="c">${x.items.length}</span>`, picked.template === x.slug)).join('')}${picked.checklist ? opt('list', '-', 'Not a list', false) : ''}</div>`;
    if (pop === 'prio') box.innerHTML = `<div class="chips">${opt('priority', 'urgent', 'P1 · urgent', p.priority === 'urgent')}${opt('priority', 'planned', 'P2 · planned', (p.priority || 'planned') === 'planned')}${opt('priority', 'someday', 'P4 · someday', p.priority === 'someday')}</div>`;
  };
  const setPick = (k, v) => { picked[k] = v || null; pop = null; newProj = null; update(); input.focus(); };
  // "+ New project" right in the dialog: name + category, created on the spot and picked for this task.
  let newProj = null;
  const createProject = async () => {
    const title = $('#qa-np-title').value.trim();
    if (!title) return $('#qa-np-title').focus();
    if (!newProj.cat) return toast('Pick a category');
    const np = await api('POST', '/api/projects', { title, category: newProj.cat });
    await load();
    toast(`Created “${np.title}”`);
    setPick('project', np.slug);
  };
  $('#qa-tools').onclick = (e) => {
    const b = e.target.closest('[data-qt]');
    if (!b) return;
    if (b.dataset.qt === 'agent') { const cur = parsed().assigned; picked.assigned = cur === 'agent' ? 'me' : 'agent'; return update(); }
    if (b.dataset.qt === 'list' && !S.data.checklists?.length) { picked.checklist = !picked.checklist; return update(); } // no templates yet: just a switch
    pop = pop === b.dataset.qt ? null : b.dataset.qt;
    update();
  };
  $('#qa-pop').onclick = (e) => {
    const n = e.target.closest('[data-np], [data-np-cat]');
    if (n) {
      if (n.dataset.npCat) { newProj.title = $('#qa-np-title').value; newProj.cat = n.dataset.npCat; update(); return $('#qa-np-title').focus(); }
      if (n.dataset.np === 'open') { newProj = { title: '', cat: proj(parsed().project)?.category || null }; update(); return $('#qa-np-title').focus(); }
      if (n.dataset.np === 'back') { newProj = null; return update(); }
      if (n.dataset.np === 'create') return createProject();
    }
    const b = e.target.closest('[data-pk]');
    if (b?.dataset.pk === 'list') { // ☑ List: empty / from a template / not a list
      const v = b.dataset.pv;
      picked.checklist = v !== '-'; picked.template = v && v !== '-' ? v : null;
      if (picked.template && !input.value.trim()) input.value = tplOf(v)?.title || '';
      pop = null; update(); return input.focus();
    }
    if (b) setPick(b.dataset.pk, b.dataset.pv);
  };
  $('#qa-pop').onkeydown = (e) => { if (e.target.id === 'qa-np-title' && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); createProject(); } };
  $('#qa-pop').onchange = (e) => { if (e.target.id === 'qa-date' && e.target.value) setPick('due', e.target.value); };
  const update = () => {
    // a value typed in the text replaces the one picked with a button
    const typed = parseQuick(input.value, { projects: S.data.projects.filter((x) => x.status === 'active'), today: S.data.today, assistant: ME().assistant?.id });
    for (const k of ['due', 'priority', 'assigned', 'project']) if (typed[k] != null && typed[k] !== prevTyped[k]) delete picked[k];
    prevTyped = typed;
    const p = parsed();
    drawTools(p);
    const chips = [];
    if (p.reminder) chips.push(`<span class="pill">⏰ ${p.time}</span>`);
    if (p.recurrence) chips.push(`<span class="pill">↻ ${esc(describeRepeat(p.recurrence))}</span>`);
    if (p.deadline) chips.push(`<span class="pill">⚑ deadline ${dateLabel(p.deadline)[0]}</span>`);
    if (p.assigned === 'someone') chips.push('<span class="pill">delegated</span>');
    for (const l of p.labels) chips.push(`<span class="pill">@${esc(l)}</span>`);
    $('#qa-chips').innerHTML = chips.join('');
    const isAgent = p.assigned === 'agent';
    notes.placeholder = isAgent ? 'Brief for the agent — outcome, constraints, where to put results, what needs your approval' : picked.checklist ? 'Items — one per line, or paste a list' : 'Description';
    $('#qa-runwrap').hidden = !isAgent;
    // #project autocomplete at the caret
    const m = input.value.slice(0, input.selectionStart).match(/(?:^|\s)#([\w.-]*)$/);
    sugg = m ? S.data.projects.filter((x) => x.status === 'active' && (x.slug.includes(m[1].toLowerCase()) || x.title.toLowerCase().includes(m[1].toLowerCase()))).slice(0, 6) : [];
    suggI = Math.min(suggI, Math.max(0, sugg.length - 1));
    const box = $('#qa-sugg');
    box.hidden = !sugg.length;
    box.innerHTML = sugg.map((x, i) => `<div class="${i === suggI ? 'on' : ''}" data-slug="${x.slug}"><span class="dot cat-${x.category || 'none'}"></span> ${esc(x.title)}</div>`).join('');
  };
  const pick = (slug) => {
    const pos = input.selectionStart;
    const before = input.value.slice(0, pos).replace(/#([\w.-]*)$/, `#${slug} `);
    input.value = before + input.value.slice(pos).replace(/^\S*\s?/, '');
    input.setSelectionRange(before.length, before.length);
    update();
  };
  $('#qa-sugg').onmousedown = (e) => { const d = e.target.closest('[data-slug]'); if (d) { e.preventDefault(); pick(d.dataset.slug); } };
  input.oninput = update;
  notes.oninput = () => autosize(notes);
  input.onkeydown = (e) => {
    if (sugg.length && ['ArrowDown', 'ArrowUp', 'Tab', 'Enter'].includes(e.key)) {
      e.preventDefault();
      if (e.key === 'ArrowDown') suggI = (suggI + 1) % sugg.length;
      else if (e.key === 'ArrowUp') suggI = (suggI - 1 + sugg.length) % sugg.length;
      else return pick(sugg[suggI].slug);
      return update();
    }
    if (e.key === 'Enter') { e.preventDefault(); save(); }
  };
  notes.onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); };
  const voice = voiceCapture({ ctx, input, notes, onReset: update });
  const save = async () => {
    if (voice.drafts()) return voice.saveDrafts(prefill);
    const p = parsed();
    if (!p.title) return;
    const t = await api('POST', '/api/tasks', { title: p.title, notes: notes.value, due: p.due, deadline: p.deadline, reminder: p.reminder || null, priority: p.priority || 'planned', recurrence: p.recurrence,
      assigned: p.assigned || 'me', agent: p.assigned === 'agent' ? p.agent : null, project: p.project, labels: p.labels, source: prefill.source || 'manual',
      ...(picked.checklist ? { checklist: true, template: picked.template || undefined } : {}) });
    if (prefill.itemId) await api('POST', `/api/items/${encodeURIComponent(prefill.itemId)}/process`, { outcome: 'task', taskId: t.id });
    const run = $('#qa-run')?.checked;
    closeModal();
    replaceTask(t);
    toast(`Added “${t.title.slice(0, 40)}”`, 'Open', () => { S.openId = t.id; render(); });
    prefill.onSaved?.(t);
    if (run) await startRun(t.id);
    await load();
  };
  S.qaSave = save;
  S.qaNote = async () => {
    const text = voice.transcript() || [input.value, notes.value].map((x) => x.trim()).filter(Boolean).join('\n\n');
    if (!text) return input.focus();
    closeModal();
    await captureNote(text);
  };
  S.qaMic = () => { micGesture(); voice.toggle(); };
  S.qaCleanup = voice.cleanup;
  update();
  S.qaVoice = voice;
  if (opts.voice) voice.start({ free: opts.hold ? false : true }); else input.focus();
}
function closeModal() {
  S.qaCleanup?.();
  $('#modal').innerHTML = '';
  S.qaSave = S.qaMic = S.qaCleanup = S.qaVoice = S.qaNote = null;
  resetMicButton(); // however the dialog closed (Cancel, Esc, tap outside, error), the mic must stop glowing
}
function resetMicButton() {
  $('#mic')?.classList.remove('recording', 'holding');
  document.body.classList.remove('mic-holding');
}

// ---------- voice capture ----------
// AICODE-NOTE: voice on the phone without the Mac (iOS offline mode, state.voice === 'device'): the shell recognizes
// speech on the iPhone (gubernos-ios Gubernos/Speech.swift) and streams the text to window.gubernosSpeech. No Whisper and no model:
// a known short command runs as usual; anything else goes into quick add's title, whose parser reads dates, #project, p1.
function deviceVoiceCapture({ input, onReset }) {
  const box = $('#qa-voice');
  const call = (m) => window.webkit.messageHandlers.gubernos.postMessage(m);
  let on = false, free = true, started = 0, tick = 0, cancelled = false;
  const show = (html) => { box.hidden = !html; box.innerHTML = html; $('.qa')?.classList.toggle('voice-mode', !!html); $('#mic')?.classList.toggle('recording', on); };
  const hint = () => (free ? 'Listening on the iPhone — pause or tap Done' : 'Release to finish');
  async function start({ free: f = true } = {}) {
    free = f; cancelled = false;
    window.gubernosSpeech = heard;
    try { await call({ op: 'listen', free }); } catch (e) { window.gubernosSpeech = null; closeModal(); return toast(String(e?.message || e), null, null, 8000); }
    if (cancelled) return call({ op: 'listenCancel' }).catch(() => {});
    on = true; started = Date.now();
    show(`<div class="rec"><span class="rec-dot"></span><span class="rec-t" id="rec-t">0:00</span><span class="meter"><i id="rec-lvl"></i></span>
      <span class="sp" id="rec-hint">${hint()}</span><button class="btn" data-act="qa-mic">■ Done</button></div><div class="transcript" id="rec-text"></div>`);
    tick = setInterval(() => { const s = Math.floor((Date.now() - started) / 1000), el = $('#rec-t'); if (el) el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 250);
  }
  function heard(m) {
    if (cancelled) return;
    if (!m.final) {
      const t = $('#rec-text'); if (t) t.textContent = m.text ? `“${m.text}”` : '';
      const l = $('#rec-lvl'); if (l) l.style.width = `${Math.min(100, (m.level || 0) * 400)}%`;
      return;
    }
    on = false; clearInterval(tick); window.gubernosSpeech = null; resetMicButton();
    const said = (m.text || '').trim();
    if (!said) { show(''); closeModal(); return toast(m.error ? `Voice: ${m.error}` : "Didn't catch that — try again"); }
    const target = S.voiceTarget; S.voiceTarget = null;
    if (target?.startsWith('field:')) { // a text field (Daily reflection): append what was said
      closeModal();
      const el = document.getElementById(target.slice(6));
      if (el) { el.value = `${el.value.trim() ? `${el.value.trim()} ` : ''}${said}`; el.dispatchEvent(new Event('input', { bubbles: true })); el.focus(); }
      return;
    }
    const fast = fastCommand(said);
    if (fast) { closeModal(); return runCommand(fast, said); }
    show(''); input.value = said; onReset(); input.focus(); // check it, then Add task
  }
  // finger lifted: a real hold ends it; a short tap means hands-free
  function release(heldMs) {
    if (!on) return;
    if (heldMs >= 350 && Date.now() - started >= 300) return stop();
    free = true; call({ op: 'listenMode', free: true }).catch(() => {});
    const h = $('#rec-hint'); if (h) h.textContent = hint();
  }
  function stop() { if (on) call({ op: 'listenStop' }).catch(() => {}); }
  return {
    toggle: () => (on ? stop() : start({ free: true })), start, release, stop,
    recording: () => on, drafts: () => false, transcript: () => '',
    cleanup: () => { cancelled = true; clearInterval(tick); if (on) call({ op: 'listenCancel' }).catch(() => {}); on = false; window.gubernosSpeech = null; },
    saveDrafts() {},
  };
}

// Record → /api/voice (local Whisper) → show transcript → /api/voice/parse (Claude) → editable drafts → create.
const MIC_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4"/></svg>';

function voiceCapture({ ctx, input, notes, onReset }) {
  if (S.data.voice === 'device') return deviceVoiceCapture({ input, onReset });
  const box = $('#qa-voice');
  let rec = null, stream = null, audio = null, src = null, raf = 0, tick = 0, started = 0, drafts = null, transcript = '', cancelled = false;
  const stopMedia = () => {
    cancelAnimationFrame(raf); clearInterval(tick);
    try { src?.disconnect(); } catch { /* already gone */ }
    if (stream) micRelease(); // keep the shared stream warm for the next press
    stream = audio = src = null;
  };
  const show = (html) => {
    box.hidden = !html; box.innerHTML = html;
    $('.qa .mic')?.classList.toggle('on', !!rec);
    $('#mic')?.classList.toggle('recording', !!rec && rec.state === 'recording');
    $('.qa')?.classList.toggle('voice-mode', !!html); // hide the typing UI while dictating/reviewing
    box.querySelectorAll('.draft-title').forEach(autosize);
  };
  const status = (msg) => `${transcript ? `<div class="transcript">“${esc(transcript)}”</div>` : ''}<div class="vstatus"><span class="spin"></span>${esc(msg)}</div>`;

  // Two ways to talk: hold the mic (push-to-talk, release = send) or tap it (hands-free, stops on a pause).
  let handsFree = true, pendingStop = false, t0 = 0;
  const hint = () => (handsFree
    ? (S.focus ? 'Say a command — pause or tap the mic to finish' : 'Listening — pause or tap the mic to finish')
    : 'Release to send');
  async function start({ free = true } = {}) {
    handsFree = free; pendingStop = false; t0 = Date.now();
    fetch('/api/voice/warm', { method: 'POST' }).catch(() => {}); // load models while the user talks
    if (!navigator.mediaDevices?.getUserMedia) { closeModal(); return toast('Microphone needs HTTPS — open the app via its Tailscale https:// address'); }
    micGesture();
    try { stream = await micStream(); }
    catch (err) { clog(`getUserMedia failed: ${err.name} ${err.message}`); closeModal(); return toast(`No microphone access (${err.name}) — allow it for this site in Safari settings`, null, null, 8000); }
    if (cancelled) return stopMedia();
    const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((t) => window.MediaRecorder?.isTypeSupported(t)) || '';
    rec = new MediaRecorder(stream, type ? { mimeType: type } : {});
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onerror = (e) => { clog(`recorder error: ${e.error?.name || e.type}`); micReset('recorder error'); };
    rec.onstop = () => { const blob = new Blob(chunks, { type: rec.mimeType || type }); rec = null; stopMedia(); resetMicButton(); if (!cancelled) upload(blob); };
    rec.start(250);
    started = Date.now(); drafts = null; transcript = '';
    clog(`rec start ${handsFree ? 'tap' : 'hold'} ${rec.mimeType}`);
    // starts grey ("Mic is starting…") until sound really comes: virtual mics (Krisp) send ~2 s of pure zeros first
    show(`<div class="rec"><span class="rec-dot wait"></span><span class="rec-t" id="rec-t">0:00</span><span class="meter"><i id="rec-lvl"></i></span>
      <span class="sp" id="rec-hint">Mic is starting…</span><button class="btn" data-act="qa-mic">■ Done</button></div>`);
    tick = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      const el = $('#rec-t'); if (el) el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      if (s >= 180) stop();
    }, 250);
    try {
      audio = micContext();
      const an = audio.createAnalyser(); an.fftSize = 512;
      src = audio.createMediaStreamSource(stream); src.connect(an);
      let flat = 0; // frames with exactly zero signal → analyser is dead (e.g. suspended context)
      const data = new Uint8Array(an.fftSize);
      // AICODE-NOTE: voice-activity detection. Noise floor = the QUIETEST frame of the first 400 ms (people often
      // start talking immediately, so an average would include speech). Speech = 2.5× floor, clamped to a sane band.
      // Hands-free stops after a pause: short in command modes, longer while dictating (people pause to think).
      // live = when the first real sound arrived; the noise floor and pauses count from then, not from the tap.
      let floor = 1, heard = false, lastVoice = 0, speechStart = 0, live = 0;
      const ready = (text) => { $('#rec-hint') && ($('#rec-hint').textContent = text); $('.rec-dot')?.classList.remove('wait'); };
      const loop = () => {
        an.getByteTimeDomainData(data);
        let sum = 0; for (const v of data) sum += ((v - 128) / 128) ** 2;
        const rms = Math.sqrt(sum / data.length);
        const now = Date.now();
        // no signal for 3 s: the analyser itself may be dead (iOS, suspended context) while the recorder works — stop by hand
        if (rms === 0 && ++flat === 180) { ready(handsFree ? 'Tap Done when finished' : hint()); clog('analyser silent — manual stop'); }
        if (rms > 0 && !live) {
          live = now; ready(hint());
          if (now - started > 300) clog(`mic live after ${now - started}ms (${stream.getAudioTracks()[0]?.label || '?'})`);
        }
        if (rms > 0) flat = -1e9;
        const lvl = $('#rec-lvl'); if (lvl) lvl.style.width = `${Math.min(100, rms * 400)}%`;
        if (live && now - live < 400) floor = Math.min(floor, rms);
        const thr = Math.min(0.06, Math.max(0.015, floor * 2.5));
        if (live && rms > thr) { if (!heard) speechStart = now; heard = true; lastVoice = now; }
        if (handsFree && rec?.state === 'recording' && live && now - live > 400) {
          // AICODE-NOTE: 2 s cut people off mid-thought while dictating a report or a note; 3 s once they've talked for a while
          const pause = S.focus ? 900 : now - speechStart > 5000 ? 3000 : 1500;
          if (heard && now - lastVoice > pause) { clog(`auto-stop after ${now - started}ms`); return stop(); }
        }
        if (handsFree && rec?.state === 'recording' && !live && flat >= 0 && now - started > 8000) return stop(); // dead analyser: let Whisper decide
        raf = requestAnimationFrame(loop);
      };
      loop();
    } catch { $('.rec-dot')?.classList.remove('wait'); const h = $('#rec-hint'); if (h) h.textContent = hint(); } // no analyser → hands-free falls back to the Done button
  }
  // Finger lifted: a long hold was push-to-talk → send now; a short tap switches to hands-free.
  // Hold time counts from when recording really started: if the finger lifted while Safari was still asking for the
  // mic (or starting it), that was not push-to-talk — keep listening hands-free instead of sending an empty clip.
  function release(heldMs, how) {
    const recording = rec?.state === 'recording';
    const recHeld = recording ? Date.now() - started : 0;
    clog(`release after ${heldMs}ms (${how}), recording ${recHeld}ms`);
    if (recording && heldMs >= 350 && recHeld >= 300) { handsFree = false; stop(); }
    else { handsFree = true; const h = $('#rec-hint'); if (h && !$('.rec-dot.wait')) h.textContent = hint(); }
  }
  function stop() { if (rec?.state === 'recording') rec.stop(); $('#mic')?.classList.remove('recording'); }

  async function upload(blob) {
    if (blob.size < 2000) {
      clog(`tiny blob ${blob.size} after ${Date.now() - started}ms`);
      show(''); closeModal();
      micReset('empty recording'); // whatever caused it (dead track, suspended audio), start clean next time
      return toast(Date.now() - started > 800 ? 'Microphone glitch — reset it, please try again' : "Didn't catch that — hold the mic while talking, or tap and speak");
    }
    show(status('Transcribing…'));
    const recMs = Date.now() - started;
    try {
      const target = S.voiceTarget || (S.chat?.open ? 'chat' : null);
      if (target) { // dictating into a chat (Ask sheet or the task card): accurate transcript, no command parsing
        S.voiceTarget = null;
        const r = await fetch('/api/voice', { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob });
        const j = await r.json();
        closeModal();
        if (!j.text || isHallucination(j.text)) return toast('Could not hear any speech');
        if (target.startsWith('field:')) { // a text field (Daily reflection): append what was said
          const el = document.getElementById(target.slice(6));
          if (el) { el.value = `${el.value.trim() ? `${el.value.trim()} ` : ''}${j.text.trim()}`; el.dispatchEvent(new Event('input', { bubbles: true })); el.focus(); }
          return;
        }
        if (target === 'tchat') { const box = $('#tc-in'); if (box) { box.value = j.text; return taskChatSend(); } }
        return chatSend(j.text);
      }
      const stt = async (quick) => {
        const r = await fetch(`/api/voice${quick ? '?quick=1' : ''}`, { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        return j.text;
      };
      // Short utterance → probably a command: try the small model first; fall back to the big one for dictation.
      if (recMs < 3500) {
        const quickText = await stt(true);
        let fast = quickText && !isHallucination(quickText) && fastCommand(quickText);
        // The small model hears command words well but mangles names ("Douglas" → "doos"); a search query needs the big one.
        if (fast?.name === 'search' || fast?.name === 'ask') fast = null; // these carry free text → use the big model
        clog(`quick "${quickText}" → ${fast ? fast.name : 'no command'} (rec ${recMs}ms)`);
        if (fast) { transcript = quickText; closeModal(); return runCommand(fast, quickText); }
      }
      transcript = await stt(false);
      if (!transcript || isHallucination(transcript)) { show(''); closeModal(); return toast('Could not hear any speech'); }
      const fb = transcript.match(FEEDBACK_RE); // "баг: …" / "идея для приложения: …" → a report about the app, no model call
      if (fb) { closeModal(); return reportByVoice(/иде|idea/i.test(fb[1]) ? 'idea' : 'bug', transcript.slice(fb[0].length)); }
      const fast = fastCommand(transcript);
      if (fast) { closeModal(); return runCommand(fast, transcript); } // known short command: skip the model round-trip
      show(status('Understanding…'));
      const p = await api('POST', '/api/voice/parse', { text: transcript, context: { mode: S.focus?.mode || null, focusTaskId: S.focus && !currentItem() ? S.focus.id : null, itemTitle: currentItem()?.title || null, openTaskId: S.openId, view: S.view } });
      if (p.kind === 'command') { closeModal(); return runCommand(p, transcript); }
      drafts = p.tasks.map((t) => ({ ...t, on: true, project: t.project || ctx.project || null, assigned: t.assigned !== 'me' ? t.assigned : ctx.assigned || 'me' }));
      if (!drafts.length) drafts = null;
      renderDrafts();
    } catch (e) {
      clog(`voice error: ${e.message}`);
      // Fall back to plain quick add with the transcript, so nothing said is lost.
      show(transcript ? `<div class="transcript">“${esc(transcript)}”</div>` : '');
      if (transcript) { input.value = transcript; onReset(); }
      toast(e.message || 'Voice failed');
    }
  }

  function renderDrafts() {
    const btn = $('#qa-savebtn');
    if (!drafts) { show(''); if (btn) btn.textContent = 'Add task'; return; }
    const n = drafts.filter((d) => d.on).length;
    if (btn) btn.textContent = n === 1 ? 'Add task' : `Add ${n} tasks`;
    $('#qa-runwrap').hidden = !drafts.some((d) => d.on && d.assigned === 'agent');
    show(`<div class="transcript">“${esc(transcript)}” <button class="linkbtn" data-vact="astext">edit as text</button></div>
      ${drafts.map((d, i) => `<div class="draft ${d.on ? '' : 'off'}" data-i="${i}">
        <input type="checkbox" data-vact="toggle" ${d.on ? 'checked' : ''}>
        <div class="draft-main"><textarea class="draft-title" data-vact="title" rows="1">${esc(d.title)}</textarea>
          <div class="meta">${d.due ? `<span class="${dateLabel(d.due)[1]}">◷ ${dateLabel(d.due)[0]}</span>` : ''}${d.reminder ? `<span>⏰ ${d.reminder.slice(11, 16)}</span>` : ''}${d.recurrence ? `<span>↻ ${esc(describeRepeat(d.recurrence))}</span>` : ''}${d.deadline ? `<span>⚑ ${dateLabel(d.deadline)[0]}</span>` : ''}
          ${d.priority !== 'planned' ? `<span class="pill">${d.priority}</span>` : ''}
          <button class="pill ${d.assigned === 'agent' ? 'agent' : ''}" data-vact="owner" title="tap to change owner">${d.assigned === 'agent' ? '✦ agent' : d.assigned === 'someone' ? 'delegated' : 'me'}</button>
          ${d.project ? `<span># ${esc(proj(d.project)?.title || d.project)}</span>` : ''}${d.labels.map((l) => `<span>@${esc(l)}</span>`).join('')}</div>
          ${d.notes ? `<div class="row-desc">${esc(d.notes)}</div>` : ''}</div>
      </div>`).join('')}`);
  }

  box.addEventListener('click', (e) => {
    const el = e.target.closest('[data-vact]');
    if (!el || !drafts) return;
    const i = +el.closest('.draft')?.dataset.i;
    if (el.dataset.vact === 'toggle') drafts[i].on = el.checked;
    if (el.dataset.vact === 'owner') drafts[i].assigned = { me: 'agent', agent: 'someone', someone: 'me' }[drafts[i].assigned];
    if (el.dataset.vact === 'astext') { input.value = transcript; drafts = null; transcript = ''; renderDrafts(); onReset(); input.focus(); return; }
    if (el.dataset.vact !== 'title') renderDrafts();
  });
  box.addEventListener('input', (e) => { if (e.target.dataset.vact === 'title') { autosize(e.target); drafts[+e.target.closest('.draft').dataset.i].title = e.target.value; } });
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset.vact === 'title') { e.preventDefault(); S.qaSave?.(); } });

  return {
    toggle: () => (rec ? stop() : start({ free: true })),
    start, release, stop,
    recording: () => rec?.state === 'recording',
    drafts: () => !!drafts?.some((d) => d.on && d.title.trim()),
    transcript: () => (drafts ? transcript : ''),
    cleanup: () => { cancelled = true; if (rec?.state === 'recording') rec.stop(); stopMedia(); },
    async saveDrafts(prefill) {
      const run = $('#qa-run')?.checked;
      const made = [];
      for (const d of drafts.filter((x) => x.on && x.title.trim())) {
        made.push(await api('POST', '/api/tasks', { title: d.title.trim(), notes: d.notes, due: d.due, deadline: d.deadline, priority: d.priority, recurrence: d.recurrence || null,
          reminder: d.reminder && d.due ? `${d.due}T${d.reminder.slice(11, 16)}` : null, // the time follows a date changed in the draft
          assigned: d.assigned, project: d.project, labels: d.labels, source: prefill.source || 'manual' }));
      }
      closeModal();
      made.forEach(replaceTask);
      toast(made.length === 1 ? `Added “${made[0].title.slice(0, 40)}”` : `Added ${made.length} tasks`);
      if (run) for (const t of made) if (t.assigned === 'agent') await startRun(t.id);
      await load();
    },
  };
}

// ---------- events ----------
document.addEventListener('click', async (e) => {
  const a = e.target.closest('[data-act], [data-set], [data-ck], .row, .subrow');
  if (!a) return;
  const row = e.target.closest('.row');
  const id = row?.dataset.id || S.openId;
  const act = a.dataset.act;
  if (a.classList.contains('subrow') && !e.target.closest('a')) { S.editingBody = false; S.openId = a.dataset.id; return render(); }
  if (act === 'sub-expand') { e.stopPropagation(); return toggleExpanded(a.dataset.id); }
  if (act === 'sub-toggle') {
    e.stopPropagation();
    a.classList.toggle('done'); a.closest('.subrow')?.classList.toggle('done'); // instant feedback
    await patch(a.dataset.id, { toggleCheck: +a.dataset.ck });
    renderMain(); renderFocus(); if (S.openId === a.dataset.id) renderDrawer(true);
    return;
  }
  if (a.dataset.ck !== undefined) { e.preventDefault(); a.classList.toggle('done'); const t = await patch(S.openId, { toggleCheck: +a.dataset.ck }); renderDrawer(true); renderMain(); return t; }
  if (a.dataset.set) {
    const t = await patch(S.openId, { [a.dataset.set]: a.dataset.val });
    renderDrawer(true); renderMain(); renderSide();
    return t;
  }
  switch (act) {
    case 'theme': return cycleTheme();
    case 'focus-start': return startFocus(a.dataset.id || null);
    case 'drop': e.stopPropagation(); return dropCurrent(a.dataset.id || null);
    case 'tb-open': return timeblockModal(taskById(a.dataset.id || (S.focus && !currentItem() ? S.focus.id : S.openId)));
    case 'tb-remove': {
      if (a.dataset.sure !== '1') { a.dataset.sure = '1'; a.textContent = 'remove?'; a.classList.add('sure'); return; } // confirm in place
      const t = taskById(S.openId);
      await api('DELETE', `/api/tasks/${t.id}/timeblock/${encodeURIComponent(a.dataset.ev)}`);
      toast('Removed from your calendar');
      S.planInfoAt = 0; // Today's calendar reads it again
      await load(); return renderDrawer(true);
    }
    case 'focus-switch': return startFocus(a.dataset.id);
    case 'why': return askWhy();
    case 'why-close': S.why = null; return renderFocus();
    case 'breakdown': return breakDown(a.dataset.id || null);
    case 'mode-inbox': return startMode('inbox');
    case 'mode-review': return startMode('review');
    case 'tri-project': return triage({ project: a.dataset.slug }, `# ${proj(a.dataset.slug)?.title || a.dataset.slug}`);
    case 'tri-newproject': return projectModal(null, { onCreated: (np) => triage({ project: np.slug }, `# ${np.title}`) });
    case 'tri-due': return triage({ due: a.dataset.due || null }, a.dataset.due ? dateLabel(a.dataset.due)[0] : 'no date');
    case 'tri-someday': return triage({ priority: 'someday' }, 'someday');
    case 'tri-agent': return triage({ assigned: 'agent' }, 'agent queue');
    case 'tri-done': return triageDone();
    case 'item-task': return itemToTask(false);
    case 'item-agent': return itemToTask(true);
    case 'item-project': return currentItem() && itemToProject(currentItem());
    case 'item-goal': return currentItem() && itemToGoal(currentItem());
    case 'item-ask': return currentItem() && askAboutItem(currentItem());
    case 'item-archive': return itemDispose('processed');
    case 'item-trash': return itemDispose('trash');
    case 'review-accept': return reviewAccept(false);
    case 'review-accept-close': return reviewAccept(true);
    case 'review-back': return reviewSendBack(null, false);
    case 'review-back-run': return reviewSendBack(null, true);
    case 'focus-done': return focusDone();
    case 'focus-skip': return focusSkip();
    case 'focus-exit': return exitFocus();
    case 'pomo-toggle': return pomo.running ? pomoPause() : pomoStart();
    case 'pomo-reset': return pomoReset();
    case 'lunch-edit': S.plan.lunchEdit = !S.plan.lunchEdit; renderMain(); if (S.plan.lunchEdit) $('.pt-lunch-at')?.focus(); return;
    case 'lunch-skip': return setLunchToday('');
    case 'lunch-reset': return setLunchToday(null);
    case 'pomo-open': return pomoOpen();
    case 'reschedule': closeModal(); return rescheduleOverdue();
    case 'palette': return openPalette();
    case 'chat-open': return S.chat?.open ? closeChat() : askHere();
    case 'project-new': return projectModal();
    case 'project-edit': return projectModal(proj(a.dataset.slug));
    case 'project-done': return completeProject(a.dataset.slug);
    case 'side-open': e.preventDefault(); return document.body.classList.add('side-open');
    case 'notif': return toggleNotifications();
    case 'notif-test': return api('POST', '/api/push/test').then((r) => toast(r.sent ? 'Test sent — check your notifications' : 'No device received it'));
    case 'side-close': return document.body.classList.remove('side-open');
    case 'side-rail': return toggleRail();
    case 'back': return history.length > 1 ? history.back() : (location.hash = '#/more');
    case 'top-menu': S.topMenu = S.topMenu === a.dataset.m ? null : a.dataset.m; return renderTop();
    case 'pin': e.preventDefault(); return togglePin(a.dataset.key);
    case 'quick': return quickAdd(a.dataset.defaults ? JSON.parse(a.dataset.defaults) : {});
    case 'qa-close': if (e.target === a) closeModal(); return;
    case 'qa-save': return S.qaSave?.();
    case 'qa-note': return S.qaNote?.();
    case 'qa-mic': return S.qaMic?.();
    case 'voice': micGesture(); return quickAdd({}, {}, { voice: true });
    case 'complete': e.stopPropagation(); return complete(id);
    case 'undo': e.stopPropagation(); return undoComplete(a.dataset.id);
    case 'reopen': {
      e.stopPropagation();
      const t = taskById(id);
      await api('POST', `/api/tasks/${id}/reopen`);
      if (S.view === 'logbook' || S.showDone) S.logbook = await api('GET', '/api/logbook');
      toast(`Reopened “${(t?.title || '').slice(0, 40)}”`, 'Undo', async () => { await api('POST', `/api/tasks/${id}/complete`); S.logbook = await api('GET', '/api/logbook'); load(); }, GRACE_MS);
      return load();
    }
    case 'toggle-done': S.showDone = !S.showDone; if (S.showDone) S.logbook = await api('GET', '/api/logbook'); return renderMain();
    case 'close': S.openId = null; S.editingBody = false; return render();
    case 'run': return startRun(S.openId, '', a.dataset.agent || null, !!a.dataset.now);
    case 'stop': { const r = runFor(S.openId); if (r) await api('POST', `/api/runs/${r.id}/stop`); return load(); }
    case 'accept': case 'accept-close': {
      if (a.disabled) return;
      const close = act === 'accept-close';
      const id = S.openId;
      const fb = ($('#tc-in')?.value || '').trim(); // optional comment from the chat box
      $$('.agent-strip button').forEach((x) => (x.disabled = true)); // no double submits while the request runs
      document.activeElement?.blur();
      await api('POST', `/api/tasks/${id}/accept`, { text: fb, close });
      if ($('#tc-in')) $('#tc-in').value = '';
      if (close) { S.openId = null; toast('Accepted & closed', 'Undo', async () => { await api('POST', `/api/tasks/${id}/reopen`); load(); }, GRACE_MS); }
      else toast('Accepted — the task is yours now');
      await load();
      return renderDrawer(true);
    }
    case 'sendback': case 'sendback-run': {
      const fb = ($('#tc-in')?.value || '').trim();
      if (!fb) { const box = $('#tc-in'); if (box) { box.placeholder = 'What should the agent change?'; box.focus(); } return toast('Write what to change in the chat box, then tap again'); }
      const tid = S.openId;
      if ($('#tc-in')) $('#tc-in').value = '';
      $$('.agent-strip button').forEach((x) => (x.disabled = true));
      document.activeElement?.blur();
      await api('POST', `/api/tasks/${tid}/sendback`, { text: fb });
      toast('Sent back to the agent');
      if (act === 'sendback-run') await startRun(tid);
      await load();
      return renderDrawer(true);
    }
    case 'edit-body': case 'edit-body-click':
      if (act === 'edit-body-click' && (e.target.closest('a, input') || getSelection().toString())) return;
      if (S.editingBody) await saveBody();
      S.editingBody = !S.editingBody;
      renderDrawer(true);
      if (S.editingBody) $('#f-body')?.focus();
      return;
    case 'one-focus': {
      const one = S.data.day?.one;
      if (!one?.text) return;
      try { const p = await api('PUT', '/api/day/one', { date: S.data.today, text: one.text, link: one.link || null }); await load(); return startFocus(p.one?.link || null); } catch (err) { return toast(err.message); }
    }
    case 'simple-toggle': return saveSetting({ simple: !S.settings?.simple }).then(() => renderMain());
    case 'today-mode': S.todayMode = a.dataset.val; try { localStorage.setItem('todayMode', S.todayMode); } catch { /* private mode */ } return renderMain();
    case 'pt-fill': { const n = +a.dataset.a; S.plan.fillAt = S.plan.fillAt === n ? null : n; return renderMain(); }
    case 'pt-put': { const id = a.dataset.id; (S.plan.at ||= {})[id] = +a.dataset.a; S.plan.pick[id] = 'do'; S.plan.fillAt = null; S.plan.loose?.delete(id); return renderMain(); }
    case 'plan-toggle': { const id = a.dataset.id; S.plan.pick[id] = S.plan.pick[id] === 'do' ? 'move' : 'do'; return renderMain(); }
    case 'plan-move': { S.plan.moveTo = S.plan.moveTo || {}; S.plan.moveTo[a.dataset.id] = a.dataset.to; return renderMain(); }
    case 'plan-refresh': return loadPlan(true);
    case 'plan-replan': S.plan = { replan: true }; return loadPlan();
    case 'est-open': if (S.plan) { S.plan.estOpen = S.plan.estOpen === a.dataset.id ? null : a.dataset.id; renderMain(); } return;
    case 'est-set': return setEstimate(a.dataset.id, a.dataset.min);
    case 'plan-apply': return applyPlan();
    case 'plan-one-pick': {
      const c = S.oneChoices?.[+a.dataset.i], P = S.plan;
      if (!c) return;
      P.one = { text: c.text, link: c.link }; P.onePicked = c.text; P.oneLink = c.link; P.oneFrom = c.kind === 'win' ? 'win' : 'pick';
      if (c.kind === 'task' && P.pick[c.link]) P.pick[c.link] = 'do'; // #1 is done today
      if (P.blk && !P.blk.work?.exists && !P.blk.work?.hand) { const n = proposeWork(P.draft, P.one); if (n) P.blk.work = n; } // sized to the new #1
      if (P.blk?.work && !P.blk.work.exists) P.blk.work.on = true;
      return renderMain();
    }
    case 'plan-blk': { const b = S.plan.blk?.[a.dataset.kind]; if (b) b.on = !b.on; return renderMain(); }
    case 'carry-do': S.plan.pick[a.dataset.id] = 'do'; return renderMain();
    case 'carry-move': S.plan.pick[a.dataset.id] = 'move'; S.plan.moveTo[a.dataset.id] = a.dataset.to; return renderMain();
    case 'carry-drop': {
      const id = a.dataset.id;
      try { await api('POST', `/api/tasks/${id}/drop`); } catch (err) { return toast(err.message); }
      S.plan.order = S.plan.order.filter((x) => x !== id); await load();
      return toast('Dropped', 'Undo', async () => { await api('POST', `/api/tasks/${id}/reopen`).catch(() => {}); S.plan = null; load(); });
    }
    case 'plan-evening-apply': return applyEvening();
    case 'cu-task': {
      const x = (S.data.attention || []).find((y) => y.slug === a.dataset.slug);
      return x && quickAdd({ project: x.slug }, { title: x.title, notes: `For [[${x.slug}]]${x.deadline ? ` (due ${x.deadline})` : ''}.` });
    }
    case 'cu-snooze': {
      const r = await api('POST', `/api/model/${encodeURIComponent(a.dataset.slug)}/snooze`, { days: 7 });
      await load(); return toast(`Not yet — back ${fromIso(r.next).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`);
    }
    case 'cu-cycle': {
      const r = await api('POST', `/api/model/${encodeURIComponent(a.dataset.slug)}/cycle`);
      await load(); return toast(r.status === 'done' ? 'Done — archived' : `Done — next ${fromIso(r.deadline || r.attention_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`);
    }
    case 'goal-new': return goalModal();
    case 'goal-edit': return goalModal((S.data.goalDetails || []).find((g) => g.slug === a.dataset.slug));
    case 'win-check': {
      const last = S.winTab === 'last' ? lastWeek() : null;
      const items = (last ? last.items : thisWeek()).map((x) => ({ text: x.text, done: x.manual ?? x.done }));
      items[+a.dataset.i].done = !items[+a.dataset.i].done;
      return saveWins(items, false, false, last?.iso);
    }
    case 'win-sugg': {
      syncWinEdit();
      const i = S.winEdit.findIndex((x) => !x.text.trim());
      if (i < 0) return toast('Three wins already — clear one first');
      S.winEdit[i] = { ...suggSplit(a.dataset.text), done: false }; // "… [[slug]]" → text + link
      return renderMain();
    }
    case 'win-tab': S.winTab = ['next', 'last'].includes(a.dataset.tab) ? a.dataset.tab : 'this'; S.winEdit = null; return renderMain();
    case 'win-edit': if (!S.logbook) api('GET', '/api/logbook').then((l) => { S.logbook = l; if (S.view === 'week') renderMain(); }).catch(() => {}); // done tasks to link
      S.winEdit = (S.winTab === 'next' ? nextWeek() : S.winTab === 'last' ? lastWeek().items : thisWeek()).map((x) => ({ ...splitLink(x.text), done: x.manual ?? x.done })); while (S.winEdit.length < 3) S.winEdit.push({ text: '', link: '', done: false }); return renderMain();
    case 'win-cancel': S.winEdit = null; return renderMain();
    case 'wr-save': return saveWeeklyNotes();
    case 'rf-save': return saveReflection();
    case 'rf-format': if (S.reflect) { S.reflect.draft = Object.fromEntries($$('[data-rf]').map((x) => [x.dataset.rf, x.value])); S.reflect.format = a.dataset.val; S.reflect.draft = {}; } return renderMain();
    case 'wr-open': e.preventDefault(); S.openId = a.dataset.id; return render();
    case 'open-id': S.openId = a.dataset.id; return render();
    case 'report': e.preventDefault(); return reportModal();
    case 'licenses': return licensesModal();
    case 'tour': return tourOpen(0);
    case 'native-settings': return window.webkit?.messageHandlers?.gubernos?.postMessage({ op: 'settings' });
    case 'plan-run': if (S.plan) { S.plan.run[a.dataset.id] = !S.plan.run[a.dataset.id]; renderMain(); } return;
    case 'win-up': case 'win-down': {
      syncWinEdit();
      const i = +a.dataset.i, j = act === 'win-up' ? i - 1 : i + 1;
      [S.winEdit[i], S.winEdit[j]] = [S.winEdit[j], S.winEdit[i]];
      return renderMain();
    }
    case 'win-save': {
      syncWinEdit();
      const rows = S.winEdit.map((r) => ({ ...r, text: r.text.trim() }));
      const items = rows.filter((r) => r.text).map((r) => ({ text: r.link ? `${r.text} · [[${r.link}]]` : r.text, done: r.done }));
      if (!items.length) return toast('Write at least one win');
      if (S.winTab === 'last') return saveWins(items, false, false, lastWeek().iso); // a week that is over: no ritual
      return commitScreen(items, S.winTab === 'next'); // the ritual saves them (hold to commit)
    }
    case 'dec-toggle': { const k = a.dataset.slug; S.decOpen.has(k) ? S.decOpen.delete(k) : S.decOpen.add(k); return renderMain(); }
    case 'dec-other': S.decPick[a.dataset.slug] = 'choose'; S.decOpen.add(a.dataset.slug); return renderMain();
    case 'dec-notnow': S.decPick[a.dataset.slug] = 'park'; return renderMain();
    case 'dec-notone': S.decPick[a.dataset.slug] = 'drop'; return renderMain();
    case 'dec-drop': { const d = S.data.decisions.find((x) => x.slug === a.dataset.slug); return d && dropDecision(d, $(`#dec-drop-${d.slug}`)?.value || ''); }
    case 'dec-to': { const d = S.data.decisions.find((x) => x.slug === a.dataset.slug); return d && decisionTo(d, a.dataset.kind); }
    case 'dec-back': delete S.decPick[a.dataset.slug]; return renderMain();
    case 'dec-accept': case 'dec-choose': {
      const d = S.data.decisions.find((x) => x.slug === a.dataset.slug);
      if (!d) return;
      return recordDecision(d, act === 'dec-accept' ? d.rec : a.dataset.letter, act === 'dec-choose' ? $(`#dec-why-${d.slug}`)?.value || '' : '');
    }
    case 'dec-park': {
      const slug = a.dataset.slug; delete S.decPick[slug];
      await api('POST', `/api/decisions/${encodeURIComponent(slug)}/park`, { review_at: a.dataset.date });
      await load(); return toast(`Not now — back ${fromIso(a.dataset.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`);
    }
    case 'dec-discuss': { const d = S.data.decisions.find((x) => x.slug === a.dataset.slug); return d && askAboutDecision(d); }
    case 'dec-next': {
      const x = S.decided.find((y) => y.slug === a.dataset.slug);
      if (!x) return;
      return quickAdd(x.project ? { project: x.project } : {}, { notes: `Next action for the decision [[${x.slug}]]: ${x.choice}.`, source: 'decision', onSaved: () => { x.task = true; renderMain(); } });
    }
    case 'goal-unlink': {
      const slug = a.dataset.slug, before = proj(slug)?.goal;
      await api('PATCH', `/api/projects/${encodeURIComponent(slug)}`, { goal: null });
      await load();
      return toast(`Unlinked “${proj(slug)?.title || slug}”`, 'Undo', async () => { await api('PATCH', `/api/projects/${encodeURIComponent(slug)}`, { goal: before }); load(); }, GRACE_MS);
    }
    case 'group-toggle': S.groupOpen = !S.groupOpen; return renderMain();
    case 'group-set': { try { localStorage.setItem(`group:${S.view}`, a.dataset.g); } catch { /* private mode */ } S.groupOpen = false; return renderMain(); }
    case 'prop-clear': { await patch(S.openId, { [a.dataset.k]: null }); renderDrawer(true); renderMain(); return renderSide(); }
    case 'cl-on': { await patch(S.openId, { checklist: true }); renderDrawer(true); return renderMain(); }
    case 'cl-off': { await patch(S.openId, { checklist: false }); renderDrawer(true); return renderMain(); }
    case 'cl-reset': { await patch(S.openId, { uncheckAll: true }); renderDrawer(true); return renderMain(); }
    case 'cl-remove': {
      const tid = S.openId, x = taskById(tid)?.subtasks.find((c) => c.i === +a.dataset.rm);
      await patch(tid, { removeCheck: +a.dataset.rm }); renderDrawer(true); renderMain();
      return x && toast(`Removed “${x.text.slice(0, 40)}”`, 'Undo', async () => { await patch(tid, { addSubtask: x.text }); renderDrawer(true); renderMain(); });
    }
    case 'cl-template': {
      const tpl = await api('POST', '/api/checklists', { taskId: S.openId });
      await load();
      return toast(`Template “${tpl.title.slice(0, 40)}” saved · ${tpl.items.length} items`);
    }
    case 'woop-open': {
      S.openId = a.dataset.id; render(); S.drShow.add('woop'); renderDrawer(true);
      return $('#drawer [data-woop="obstacle"]')?.scrollIntoView({ block: 'center' });
    }
    case 'woop-chat': {
      const t = taskById(S.openId);
      if (!t) return;
      // the agent coaches it line by line, its options come back as buttons (lib/chat.js woopCoach)
      return taskChatSend({ message: S.chatLang === 'ru' ? 'Давай разберём эту задачу по WOOP' : 'Let’s WOOP this task', woop: true });
    }
    case 'prop-show': {
      S.drShow.add(a.dataset.k); renderDrawer(true);
      const el = $(`#f-${a.dataset.k}`) || (a.dataset.k === 'woop' && $('#drawer [data-woop]')) || $('#drawer [data-set="status"][data-val="wait"]');
      if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA') { el.focus(); try { if (el.type.startsWith('date')) el.showPicker(); } catch { /* not supported */ } }
      return;
    }
    case 'cap-toggle': { const c = a.closest('.cap'); const b = $('.cap-b', c); b.hidden = !b.hidden; const pv = $('.cap-prev', c); if (pv) pv.hidden = !b.hidden; return; }
    case 'cap-apply': {
      const it = S.data.inbox.find((x) => x.id === a.closest('[data-item]').dataset.item), t = it?.triage;
      if (!t) return;
      a.disabled = true;
      try {
        const nt = await api('POST', '/api/tasks', { title: t.title || it.title, notes: `From inbox capture [[${it.id}]]${it.sender ? ` (${it.sender})` : ''}:\n\n${it.body}`, due: t.due || null, reminder: t.reminder || null,
          priority: t.priority || 'planned', assigned: t.assigned || 'me', agent: t.assigned === 'agent' ? t.agent || null : null, project: t.project || null, source: it.source === 'mail' ? 'email' : 'agent' });
        await api('POST', `/api/items/${encodeURIComponent(it.id)}/process`, { outcome: 'task', taskId: nt.id });
        replaceTask(nt); toast(`Added “${nt.title.slice(0, 40)}”`, 'Open', () => { S.openId = nt.id; render(); });
      } catch (err) { a.disabled = false; return toast(err.message); }
      return load();
    }
    case 'cap-task': case 'cap-agent': {
      const it = S.data.inbox.find((x) => x.id === a.closest('[data-item]').dataset.item), t = it.triage?.kind === 'task' ? it.triage : null;
      if (t && act === 'cap-task') return quickAdd({ due: t.due || undefined, priority: t.priority || undefined, assigned: t.assigned || undefined, project: t.project || undefined }, { title: t.title || it.title,
        notes: `From inbox capture [[${it.id}]]${it.sender ? ` (${it.sender})` : ''}:\n\n${it.body}`, itemId: it.id, source: it.source === 'mail' ? 'email' : 'agent' });
      return quickAdd(act === 'cap-agent' ? { assigned: 'agent' } : {}, { title: it.title, notes: `From inbox capture [[${it.id}]]${it.sender ? ` (${it.sender})` : ''}:\n\n${it.body}`, itemId: it.id, source: it.source === 'mail' ? 'email' : 'agent' });
    }
    case 'cap-project': case 'cap-ask': case 'cap-goal': {
      const it = S.data.inbox.find((x) => x.id === a.closest('[data-item]').dataset.item);
      return act === 'cap-project' ? itemToProject(it) : act === 'cap-goal' ? itemToGoal(it) : askAboutItem(it);
    }
    case 'cap-done': case 'cap-trash':
      await api('POST', `/api/items/${encodeURIComponent(a.closest('[data-item]').dataset.item)}/process`, { outcome: act === 'cap-trash' ? 'trash' : 'processed' });
      return load();
  }
  if (row && !e.target.closest('a')) {
    S.sel = +row.dataset.i;
    S.editingBody = false;
    S.openId = S.openId === row.dataset.id ? null : row.dataset.id;
    render();
  }
});

async function saveBody() {
  const b = $('#f-body');
  const t = taskById(S.openId);
  if (b && t && b.value !== t.body) await patch(S.openId, { body: b.value });
}

// Field edits in the drawer: debounce text, commit selects/dates immediately.
let fieldTimer;
document.addEventListener('input', (e) => {
  if (e.target.id === 'search') { S.q = e.target.value; S.searchSel = 0; return renderSearch(); }
  if (e.target.id === 'f-title') { autosize(e.target); clearTimeout(fieldTimer); fieldTimer = setTimeout(() => patch(S.openId, { title: e.target.value }).then(renderMain), 600); }
  if (e.target.id === 'f-body') { clearTimeout(fieldTimer); fieldTimer = setTimeout(saveBody, 1200); }
});
document.addEventListener('change', (e) => { if (e.target.id === 'done-proj') { S.doneProject = e.target.value; renderMain(); } });
document.addEventListener('change', (e) => { const id = e.target.dataset?.est; if (id && e.target.value) setEstimate(id, e.target.value); });
document.addEventListener('change', async (e) => {
  const f = { 'f-project': 'project', 'f-due': 'due', 'f-deadline': 'deadline', 'f-reminder': 'reminder', 'f-labels': 'labels', 'f-recurrence': 'recurrence' }[e.target.id];
  if (!f || !S.openId) return;
  if (f === 'recurrence') { // words → canon (cron or "every 2 weeks"); a repeat without a date starts at its first occurrence
    const rec = toRecurrence(e.target.value, S.data.today);
    if (rec === null) return toast('Didn’t get that — try “every monday”, “every 2 weeks”, “каждый месяц 1-го”');
    const t = taskById(S.openId);
    const first = rec && !t.due ? parseQuick(e.target.value, { projects: [], today: S.data.today }).due : null;
    await patch(S.openId, { recurrence: rec || null, ...(first ? { due: first } : {}) });
    if (rec) toast(`↻ ${describeRepeat(rec)}`);
    renderDrawer(true); renderMain(); return;
  }
  if (f === 'project' && e.target.value === '__new__') { // create a project right from the task, then put the task in it
    e.target.value = taskById(S.openId)?.project || '';
    return projectModal(null, { taskId: S.openId, category: proj(taskById(S.openId)?.project)?.category });
  }
  await patch(S.openId, { [f]: e.target.value || null });
  renderMain(); renderSide();
});
// A pasted list (several lines) into the item / subtask box → one item per line at once.
document.addEventListener('paste', async (e) => {
  if (!['f-items', 'f-sub'].includes(e.target.id)) return;
  const text = e.clipboardData?.getData('text/plain') || '';
  if (!text.trim().includes('\n')) return;
  e.preventDefault();
  await patch(S.openId, { addLines: text });
  renderDrawer(true); renderMain();
});
document.addEventListener('input', (e) => { if (e.target.id === 'f-items') autosize(e.target); });
document.addEventListener('keydown', async (e) => {
  if (e.target.id === 'f-items' && e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (e.target.value.trim()) { await patch(S.openId, { addLines: e.target.value }); renderDrawer(true); $('#f-items')?.focus(); renderMain(); }
    return;
  }
  if (e.target.id === 'f-sub' && e.key === 'Enter' && e.target.value.trim()) {
    await patch(S.openId, { addSubtask: e.target.value.trim() });
    renderDrawer(true); $('#f-sub').focus(); renderMain();
    return;
  }
  if (e.target.id === 'f-title' && e.key === 'Enter') { e.preventDefault(); e.target.blur(); return; }
  if (e.key === 'Escape') {
    if ($('#modal').innerHTML) return closeModal();
    if (S.chat?.open && !e.target.closest?.('#search')) return closeChat();
    if (S.focus) return exitFocus();
    if (document.activeElement?.matches('input, textarea')) { if (S.editingBody) { await saveBody(); S.editingBody = false; renderDrawer(true); } document.activeElement.blur(); return; }
    if (S.openId) { S.openId = null; return render(); }
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); return $('#modal').innerHTML ? closeModal() : openPalette(); }
  if (e.target.matches('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (S.focus && !$('#modal').innerHTML) {
    const voice = () => { micGesture(); quickAdd({}, {}, { voice: true }); };
    const fk = ({
      focus: { x: focusDone, Enter: focusDone, s: focusSkip, b: () => breakDown(), w: askWhy, p: () => (pomo.running ? pomoPause() : pomoStart()), v: voice },
      inbox: currentItem()
        ? { t: () => itemToTask(false), a: () => itemToTask(true), e: () => itemDispose('processed'), '#': () => itemDispose('trash'), s: focusSkip, v: voice }
        : { x: triageDone, a: () => triage({ assigned: 'agent' }, 'agent queue'), s: focusSkip, v: voice },
      review: { Enter: () => reviewAccept(false), c: () => reviewAccept(true), s: focusSkip, v: voice },
    }[S.focus.mode] || {})[e.key];
    if (fk) { e.preventDefault(); return fk(); }
    return;
  }
  // Todoist-style "go to": g, then a letter within 1.5 s (g t → Today); ? shows every shortcut
  if (S.gAt && Date.now() - S.gAt < 1500) {
    S.gAt = 0;
    const to = GO_KEYS[e.key.toLowerCase()];
    if (to) { e.preventDefault(); if (to[1]) S.dayTab = to[1]; location.hash = `#/${to[0]}`; if (S.view === to[0]) renderMain(); return; }
  }
  if (e.key === 'g') { S.gAt = Date.now(); return; }
  if (e.key === '?') { e.preventDefault(); return shortcutsHelp(); }
  if (e.key === 'z' && S.lastUndo && Date.now() < S.lastUndo.until) { e.preventDefault(); const u = S.lastUndo; S.lastUndo = null; $('#toast').innerHTML = ''; return u.fn(); }
  const t = flat[S.sel];
  const nav = Object.entries(VIEWS).find(([, v]) => v.key === e.key);
  if (nav) { location.hash = `#/${nav[0]}`; return; }
  switch (e.key) {
    case 'q': case 'n': e.preventDefault(); return quickAdd();
    case 'v': e.preventDefault(); micGesture(); return quickAdd({}, {}, { voice: true });
    case 'f': e.preventDefault(); return startFocus(S.openId || null);
    case 'c': e.preventDefault(); return askHere();
    case '/': e.preventDefault(); return $('#search')?.focus();
    case 'd': return cycleTheme();
    case 'j': case 'ArrowDown': e.preventDefault(); S.sel = Math.min(flat.length - 1, S.sel + 1); if (S.openId) S.openId = flat[S.sel]?.id; return render();
    case 'k': case 'ArrowUp': e.preventDefault(); S.sel = Math.max(0, S.sel - 1); if (S.openId) S.openId = flat[S.sel]?.id; return render();
    case 'Enter': case 'o': if (t) { S.openId = t.id; render(); } return;
    case 'x': case ' ': e.preventDefault(); if (t) return complete(t.id); return;
    case 'Backspace': case 'Delete': e.preventDefault(); if (t && open(t)) return dropTask(t.id); return;
    case 'a': if (t) { await patch(t.id, { assigned: t.assigned === 'agent' ? 'me' : 'agent' }); render(); } return;
    case 'r': { const x = t || taskById(S.openId); if (x?.assigned === 'agent' && !runFor(x.id)) return startRun(x.id); return; }
    case 'e': e.preventDefault(); if (t) return complete(t.id); return; // Todoist: E completes
    case 't': { const x = t || taskById(S.openId); if (x) { e.preventDefault(); moveSheet(x.id); } return; } // Todoist: T schedules
    case 'y': { // Todoist: Y sets the priority — here it steps urgent → planned → someday
      const x = t || taskById(S.openId);
      if (!x) return;
      const next = { urgent: 'planned', planned: 'someday', someday: 'urgent' }[x.priority] || 'urgent';
      await patch(x.id, { priority: next }); render(); return toast(`Priority: ${next}`);
    }
    case 'ArrowRight': case 'l': if (t?.subtasks.length) toggleExpanded(t.id, true); return;
    case 'ArrowLeft': case 'h': if (t) toggleExpanded(t.id, false); return;
  }
});

// Keyboard shortcuts (like Todoist): "g" then a letter goes to a screen; [view, Protocol tab]
const GO_KEYS = { t: ['today'], i: ['inbox'], u: ['upcoming'], a: ['agent'], l: ['waiting'], m: ['someday'], c: ['logbook'], d: ['day', 'today'], h: ['day', 'week'],
  p: ['plan'], w: ['week'], n: ['decisions'], o: ['goals'], r: ['reflect'], v: ['weekly'], s: ['settings'] };
function shortcutsHelp() {
  const go = [['t', 'Today'], ['i', 'Inbox'], ['u', 'Upcoming'], ['d', 'Protocol'], ['h', 'Habits this week'], ['p', 'Plan the day'], ['w', 'Wins'], ['n', 'Decisions'],
    ['o', 'Goals'], ['r', 'Daily reflection'], ['v', 'Weekly review'], ['a', 'Agents'], ['l', 'Waiting'], ['m', 'Someday'], ['c', 'Completed'], ['s', 'Settings']];
  const k = (x) => x.split(' ').map((y) => `<kbd>${esc(y)}</kbd>`).join(' ');
  const rows = (list) => list.map(([a, b]) => `<div class="kb-r"><span>${b}</span><span>${k(a)}</span></div>`).join('');
  $('#modal').innerHTML = `<div class="overlay" data-act="qa-close"><div class="qa pm kb">
    <div class="bd-h">Keyboard shortcuts</div>
    <div class="kb-cols"><div><h5>Go to</h5>${rows(go.map(([x, l]) => [`g ${x}`, l]))}<div class="kb-r"><span>A screen by number</span><span>${k('1')} … ${k('9')}</span></div></div>
    <div><h5>Anywhere</h5>${rows([['q', 'Add task'], ['v', 'Add by voice'], ['/', 'Search'], ['⌘ K', 'Commands'], ['c', 'Ask the agent'], ['f', 'Focus on one task'], ['z', 'Undo'], ['d', 'Theme'], ['?', 'This list']])}
    <h5>The selected task</h5>${rows([['j k', 'Down / up'], ['Enter', 'Open'], ['e', 'Complete (also x, space)'], ['t', 'Schedule'], ['y', 'Priority'], ['Delete', 'Drop'], ['a', 'To an agent / back'], ['r', 'Run the agent'], ['→ ←', 'Subtasks'], ['Esc', 'Close']])}</div></div>
    <div class="foot"><span class="sp"></span><button class="btn" data-act="qa-close">Close</button></div></div></div>`;
}
function route() {
  let [, view = 'today', arg = null] = location.hash.split('/');
  if (view === 'protocol') view = 'day'; // #/protocol = the Protocol screen (its view key is still 'day')
  if (view === 'add') { // #/add (the iPhone app's widget / gubernos://add): quick add on Today
    history.replaceState(null, '', '#/today');
    S.view = 'today'; S.arg = null; S.openId = null;
    render();
    return setTimeout(() => quickAdd(), 60);
  }
  if (view === 'task' && arg) { // link from a calendar event → open the task on Today
    history.replaceState(null, '', '#/today');
    S.view = 'today'; S.arg = null; S.sel = -1; S.openId = decodeURIComponent(arg);
    return render();
  }
  S.view = VIEWS[view] || view === 'project' ? view : 'today';
  S.arg = arg && decodeURIComponent(arg);
  if (S.view === 'plan') S.plan = S.arg === 'evening' ? { evening: true } : null; // fresh draft each visit (the server caches estimates)
  S.sel = -1;
  S.openId = null;
  if (S.view === 'logbook') api('GET', '/api/logbook').then((l) => { S.logbook = l; render(); });
  if (S.view === 'weekly') loadWeekly();
  if (S.view === 'reflect') { loadReflection(S.arg || S.data.today); loadDay(S.arg || S.data.today); }
  if (S.view === 'day') { S.oneEdit = false; loadDay(S.arg || S.data.today); }
  if (S.view === 'week') { S.winTab = ['next', 'last'].includes(S.arg) ? S.arg : 'this'; S.winEdit = null; }
  render();
}
window.addEventListener('hashchange', () => { document.body.classList.remove('side-open', 'tabs-dim'); lastMainY = 0; S.winEdit = null; S.goalScrolled = null; S.topMenu = null; route(); });

// A change made elsewhere (the vault, another device) while a field is being typed into waits until it's left: the
// re-render took the field away, and the next keys ran as shortcuts (digits switch screens).
const typing = () => { const a = document.activeElement; return !!a && a.id !== 'search' && a.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=file]), textarea, select, [contenteditable]'); };
function bgLoad() { if (typing()) S.loadLater = true; else load(); }
document.addEventListener('focusout', () => setTimeout(() => { if (S.loadLater && !typing()) { S.loadLater = false; load(); } }, 50));

// Live updates. AICODE-NOTE (iOS): a backgrounded home-screen app loses this connection and never gets it back by itself,
// so coming back to the app reloads the data and reopens the stream.
let events = null;
function listen() {
  if (events && events.readyState !== EventSource.CLOSED) return;
  events = new EventSource('/api/events');
  events.addEventListener('changed', () => bgLoad());
  events.onerror = () => { if (events.readyState === EventSource.CLOSED) setTimeout(listen, 5000); };
}
listen();
window.gubernosStream = () => events; // diagnostics (tests, console)
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (events) { try { events.close(); } catch { /* already closed */ } events = null; }
  listen();
  load().then(() => { if (S.openId) renderDrawer(true); });
  if (Date.now() - hiddenAt > 60e3) S.planInfoAt = 0; // free time has moved on too
});
window.addEventListener('pageshow', (e) => { if (e.persisted) load(); }); // back-forward cache (Safari)

// ---------- notifications (Web Push; on iPhone only from the home-screen app) ----------
S.push = { supported: 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window, on: false };
const swReady = S.push.supported ? navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready) : null;
swReady?.then(async (reg) => { S.push.on = !!(await reg.pushManager.getSubscription()) && Notification.permission === 'granted'; if (S.view === 'settings') renderMain(); }).catch(() => {});
navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data?.type === 'open') location.href = e.data.url; });
// ---------- settings (theme is per device; the rest is shared, data/settings.json on the Mac) ----------
S.settings = { undoSeconds: 5, digestAt: '08:30' };
fetch('/api/settings').then((r) => r.json()).then((s) => { S.settings = s; GRACE_MS = s.undoSeconds * 1000; applyPalette(s.palette); if (S.data) renderTop(); mirrorSettings(s); clockTimes(document.body); if (S.view === 'settings') renderMain(); S.remindersSent = null; syncNativeReminders(); }).catch(() => {});
// iPhone app online: keep the phone's own copy of the settings (gubernos-data/settings.json) the same as the Mac's, so offline
// it uses the same week start, habits switch, times… (2026-10-12: offline it fell back to a Monday week)
function mirrorSettings(s) {
  const h = window.webkit?.messageHandlers?.gubernos;
  if (!h || document.documentElement.classList.contains('local-mode') || !s) return;
  h.postMessage({ op: 'write', path: '/data/settings.json', text: JSON.stringify(s, null, 1) }).catch(() => {});
}
function refreshCalStatus() { S.gcals = null; S.planInfoAt = 0; S.planFree = null; return fetch('/api/gcal/status').then((r) => r.json()).then((g) => { S.gstatus = g; if (S.view === 'settings') renderMain(); }).catch(() => {}); }
refreshCalStatus();
async function saveSetting(patch) {
  S.settings = await api('PATCH', '/api/settings', patch);
  mirrorSettings(S.settings);
  GRACE_MS = S.settings.undoSeconds * 1000;
  renderMain(); toast('Saved');
}
// Settings → About → Licenses: the app's own licenses and the third-party notices (public/licenses.txt, also in the iPhone app)
async function licensesModal() {
  let text = '';
  try { const r = await fetch('/licenses.txt'); text = r.ok ? await r.text() : ''; } catch { /* offline */ }
  // the file is wrapped at ~118 columns: rejoin each paragraph so it flows on a phone (headings keep their underline)
  text = text.split(/\n{2,}/).map((para) => (/\n[=-]{3,}/.test(para) ? para : para.replace(/\n/g, ' '))).join('\n\n');
  $('#modal').innerHTML = `<div class="overlay" data-act="qa-close"><div class="qa pm licenses">
    <div class="bd-h">Licenses</div><pre class="lic">${esc(text || 'Could not load the licenses. They are in licenses.txt in the app.')}</pre>
    <div class="foot"><span class="sp"></span><button class="btn" data-act="qa-close">Close</button></div></div></div>`;
}
function settingsHtml() {
  const seg = (act, cur, opts) => `<span class="seg">${opts.map(([v, l]) => `<button data-act="${act}" data-val="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</span>`;
  const st = S.settings, p = S.push || {};
  const notif = !p.supported ? '<span class="set-note">Not available here — on iPhone, open the app from the Home Screen.</span>'
    : `${seg('set-notif', p.on ? 'on' : 'off', [['off', 'Off'], ['on', 'On']])}${p.on ? ' <button class="linkbtn" data-act="notif-test">Send a test</button>' : ''}`;
  const local = !!S.data?.local, g = (t) => `<h2 class="set-g">${t}</h2>`;
  return `<div class="page settings"><div class="page-h"><h1>Settings</h1>${pomoLiveHtml() ? `<div class="tools">${pomoLiveHtml()}</div>` : ''}${MENU_BTN}</div>
    ${g('General')}
    <div class="set-row"><div class="set-l">Theme<small>this device</small></div>${seg('set-theme', currentTheme(), [['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']])}</div>
    <div class="set-row"><div class="set-l">Colours<small>all your devices</small></div><span class="pal-pick">${PALETTES.map(([name, bg, hub], i) => `<button data-act="set-palette" data-val="${i}" class="pal-sw ${(st.palette || 0) === i ? 'on' : ''}" style="--tile-bg:${bg};--tile-fg:#fff;--tile-hub:${hub}" title="${name}" aria-label="Colours: ${name}">${LOGO}<span>${name}</span></button>`).join('')}</span></div>
    <div class="set-row"><div class="set-l">Time format<small>how times show everywhere in the app</small></div><span data-noclock>${seg('set-clock', st.clock === '12h' ? '12h' : '24h', [['24h', '24h · 16:30'], ['12h', 'am / pm · 4:30pm']])}</span></div>
    <div class="set-row"><div class="set-l">Week starts on<small>this week’s wins, the weekly review, habits this week, sprints this week</small></div>${seg('set-week-start', st.weekStart === 'sunday' ? 'sunday' : 'monday', [['sunday', 'Sunday'], ['monday', 'Monday']])}</div>
    <div class="set-row"><div class="set-l">Undo window<small>complete, drop, reschedule</small></div>${seg('set-undo', st.undoSeconds, [[3, '3 s'], [5, '5 s'], [10, '10 s']])}</div>
    ${g('Today')}
    <div class="set-row"><div class="set-l">Focus view<small>Today shows only the #1 and your tasks for today, each a tap from Focus · also the toggle at the top of Today</small></div>${seg('set-simple', st.simple ? 'on' : 'off', [['off', 'Off'], ['on', 'On']])}</div>
    ${local ? '' : macFocusHtml()}
    ${timeRow('Lunch', 'Plan the day keeps it free — at this time, or the nearest free slot within an hour of it. A “Lunch” event in your calendar counts instead. For one day: Move or Skip today on its row in Plan the day', 'lunchAt', '12:00', () => seg('set-lunch-min', st.lunchMinutes || 60, [[30, '30m'], [45, '45m'], [60, '1h'], [90, '1.5h']]))}
    ${local ? '' : calendarSourceHtml()}
    ${calendarsHtml()}
    ${g('Daily rhythm')}
    <div class="set-row"><div class="set-l">Morning digest<small>due today, overdue, to review</small></div>
      <div class="set-digest">${seg('set-digest-off', st.digestAt ? 'on' : 'off', [['off', 'Off'], ['on', 'On']])}${st.digestAt ? `<input type="time" id="set-digest" value="${esc(st.digestAt)}" step="300">` : ''}</div></div>
    ${timeRow('Evening check-in', 'what’s left today → move it', 'eveningAt', '19:00')}
    ${timeRow('Daily reflection', 'three short answers about the day', 'reflectionAt', '22:00')}
    <div class="set-row"><div class="set-l">Reflection format<small>E-S-P: effort, success, progress · Journal: went well, needs work, tomorrow</small></div>${seg('set-reflect-format', st.reflectionFormat || 'esp', [['esp', 'E-S-P'], ['journal', 'Journal']])}</div>
    ${g('Habits')}
    <div class="set-row"><div class="set-l">Habits<small>daily check-ins and the AM / PM protocols on the Day screen, their reminders; off = Plan the day uses profile.md’s workday</small></div>${seg('set-habits', st.habits === false ? 'off' : 'on', [['off', 'Off'], ['on', 'On']])}</div>
    ${st.habits === false ? '' : offWorkHtml()}
    ${g('Notifications')}
    <div class="set-row"><div class="set-l">On this device<small>reminders, morning digest, agents</small></div><div>${notif}</div></div>
    <div class="set-row"><div class="set-l">Reminder pushes from the Mac<small>off if the iPhone app reminds you (no doubles)</small></div>${seg('set-reminder-push', st.reminderPush === false ? 'off' : 'on', [['off', 'Off'], ['on', 'On']])}</div>
    <div class="set-row"><div class="set-l">Morning &amp; evening pushes from the Mac<small>off if the iPhone app sends them (no doubles)</small></div>${seg('set-checkin-push', st.checkinPush === false ? 'off' : 'on', [['off', 'Off'], ['on', 'On']])}</div>
    ${g('Agents')}
    ${local ? '' : modelSettingsHtml()}
    ${agentsSettingsHtml()}
    ${g('Connections')}
    <div class="set-row"><div class="set-l">Google<small>calendar for Plan the day; mail, contacts, docs for agents</small></div><div class="set-note">${googleNote()}</div></div>
    ${local ? '' : pairHtml()}
    ${window.gubernosNative ? '<div class="set-row"><div class="set-l">iPhone app<small>Mac address, system folder in iCloud</small></div><button class="btn" data-act="native-settings">Open</button></div>' : ''}
    <div class="set-row"><div class="set-l">Profile<small>profile.md in the vault</small></div><div class="set-note">${esc(ME().name)} · ${esc(ME().categories.join(', '))}${ME().assistant ? ` · assistant ${esc(ME().assistant.name)}` : ''}</div></div>
    ${g('About')}
    <div class="set-row"><div class="set-l">How it works<small>the personal OS, its loops and where your data lives</small></div><span class="set-btns"><button class="btn" data-act="tour">Tour</button><a class="btn" href="#/how">Open</a></span></div>
    <div class="set-row"><div class="set-l">${esc(APP_NAME)}<small>open source: the app under MIT, the method under CC BY 4.0</small></div><button class="btn" data-act="licenses">Licenses</button></div>
  </div>`;
}
// Settings → Connections → Pair a device (lib/pair.js): a QR code the iPhone's camera opens in the app
// (gubernos://pair?url=…&token=…), a link for another browser, and — on the Mac only — whether pairing is required and a
// new code that unpairs every device.
S.pair = null; S.pairShow = false;
function pairHtml() {
  const p = S.pair;
  if (!p) { if (p !== false) { S.pair = false; api('GET', '/api/pair').then((x) => { S.pair = x; if (S.view === 'settings') renderMain(); }).catch(() => {}); } return ''; }
  const seg = (act, cur, opts, dis) => `<span class="seg">${opts.map(([v, l]) => `<button data-act="${act}" data-val="${v}" class="${String(cur) === String(v) ? 'on' : ''}"${dis ? ' disabled' : ''}>${l}</button>`).join('')}</span>`;
  if (!p.publicUrl) return `<div class="set-row"><div class="set-l">Pair a device<small>phone access isn’t set up on this Mac yet: in the app’s folder run <code>scripts/setup.sh phone</code> (Tailscale)</small></div></div>`;
  const code = S.pairShow ? `<div class="pair-box"><div class="pair-qr">${pairQr()}</div>
      <div class="set-note"><b>iPhone:</b> point the Camera at the code → Open in ${esc(APP_NAME)}.<br><b>Another browser</b> (an iPad, a second Mac): open this link there once —
      <button class="linkbtn" data-act="set-pair-copy">Copy link</button></div></div>` : '';
  return `<div class="set-row"><div class="set-l">Pair a device<small>a phone or another computer reaches this Mac through ${esc(p.publicUrl.replace(/^https?:\/\//, ''))} once it has the code</small>${code}</div>
      <button class="btn" data-act="set-pair-show">${S.pairShow ? 'Hide' : 'Show code'}</button></div>
    <div class="set-row"><div class="set-l">Require pairing<small>${p.local ? 'on: only paired devices get in (the Mac itself always does) · off: anyone on your Tailscale network' : 'changed on the Mac itself'}</small>
      ${p.local ? '<div class="set-mf"><button class="linkbtn" data-act="set-pair-rotate">New code — unpairs every device</button></div>' : ''}</div>
      ${seg('set-pair-required', p.required ? 'on' : 'off', [['off', 'Off'], ['on', 'On']], !p.local)}</div>`;
}
// the QR code itself as SVG (public/vendor/qrcode.js, loaded the first time it is shown, then the page is drawn again)
function pairQr() {
  if (!S.pair?.appLink) return '';
  if (!window.qrcode) {
    if (!pairQr.loading) { pairQr.loading = true; const sc = document.createElement('script'); sc.src = '/vendor/qrcode.js'; sc.onload = () => { if (S.view === 'settings') renderMain(); }; document.head.append(sc); }
    return '';
  }
  const q = window.qrcode(0, 'M'); q.addData(S.pair.appLink); q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}
// Settings → Today → Mac Focus: the Mac's Focus follows the Focus view, through two Shortcuts made once (lib/macfocus.js)
S.macFocus = null;
function macFocusHtml() {
  const m = S.macFocus, st = S.settings;
  const seg = (act, cur, opts) => `<span class="seg">${opts.map(([v, l]) => `<button data-act="${act}" data-val="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</span>`;
  if (!m) { if (m !== false) { S.macFocus = false; api('GET', '/api/mac-focus').then((x) => { S.macFocus = x; if (S.view === 'settings') renderMain(); }).catch(() => {}); } return ''; }
  if (!m.available) return '';
  const howto = m.missing.length ? `<div class="set-mf">Make ${m.missing.map((n) => `<b>${esc(n)}</b>`).join(' and ')} once in the Shortcuts app on the Mac: a new shortcut → action <i>Set Focus</i> → your Focus (Work, Do Not Disturb…) → <i>${m.missing.length === 2 ? 'On / Off' : m.missing[0] === m.on ? 'On' : 'Off'}</i>. <button class="linkbtn" data-act="set-mf-check">Check again</button></div>` : '';
  return `<div class="set-row"><div class="set-l">Mac Focus with it<small>turning the Focus view on or off (here or on the iPhone) turns the Mac’s Focus on or off — through the Shortcuts “${esc(m.on)}” and “${esc(m.off)}”</small>${howto}</div>
    ${seg('set-mac-focus', st.macFocus ? 'on' : 'off', [['off', 'Off'], ['on', 'On']])}</div>`;
}
// Settings → Off work: days off work (a vacation) in profile.md; work habits (Edit → Days off work: Pause) are off then —
// not due, neither done nor missed (lib/habits.js setOffWork)
S.offWork = null;
const owDay = (d) => fromIso(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const owUntil = (x) => (x.to === '9999-12-31' ? 'until further notice' : `through ${owDay(x.to)}`);
function loadOffWork() { return api('GET', '/api/off-work').then((o) => { S.offWork = o; if (S.view === 'settings') renderMain(); }).catch(() => {}); }
function offWorkHtml() {
  const o = S.offWork;
  if (!o) { loadOffWork(); return ''; }
  const n = o.habits.length;
  const hint = `a vacation: ${n ? `${n} work habit${n === 1 ? '' : 's'} (${o.habits.map((h) => esc(h.title)).join(', ')})` : 'work habits'} pause — neither done nor missed. Which ones: a habit → Edit → Days off work`;
  const why = (x) => (x.why ? ` · ${esc(x.why)}` : '');
  const now = o.now ? `<div>Off work since ${owDay(o.now.from)}, ${owUntil(o.now)}${why(o.now)} <button class="btn" data-act="set-ow-end" data-val="${o.now.from}">Back to work</button></div>` : '';
  const ahead = o.upcoming.map((x) => `<div class="muted">${owDay(x.from)} – ${x.to === '9999-12-31' ? '…' : owDay(x.to)}${why(x)} <button class="linkbtn" data-act="set-ow-del" data-val="${x.from}">Remove</button></div>`).join('');
  const form = `<div class="set-ow"><label>From <input type="date" id="ow-from" value="${o.now ? '' : iso(new Date())}"></label> <label>Last day off <input type="date" id="ow-to"></label>
    <input id="ow-why" placeholder="why (optional)" maxlength="80"> <button class="btn" data-act="set-ow-add">${o.now ? 'Plan another' : 'Set'}</button></div>`;
  return `<div class="set-row"><div class="set-l">Off work<small>${hint}</small></div><div class="set-owp">${now}${ahead}${form}</div></div>`;
}

// Settings → Agents: who a task can go to — the name, how it starts, shown in the task's picker or not. Built-ins can be
// renamed or hidden; your own ones added and removed (lib/settings.js agentList).
function agentsSettingsHtml() {
  const runs = [['claude', 'Claude Code, run here'], ['codex', 'Codex, run here'], ['gemini', 'Gemini CLI, run here'], ['queue', 'Takes its own queue']];
  const rows = agentList().map((a) => `<div class="ag-row">
    <input class="ag-name" data-ag="${esc(a.id)}" value="${esc(a.name)}" aria-label="Name">
    ${a.run === 'dev' ? '<span class="set-note">Dev session · the app’s code</span>' : `<select class="ag-run" data-ag="${esc(a.id)}" aria-label="How it starts">${runs.map(([v, l]) => `<option value="${v}" ${a.run === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`}
    <span class="seg">${[['off', 'Hidden'], ['on', 'Shown']].map(([v, l]) => `<button data-act="set-ag-on" data-ag="${esc(a.id)}" data-val="${v}" class="${(a.on ? 'on' : 'off') === v ? 'on' : ''}">${l}</button>`).join('')}</span>
    ${agentReady(a) ? '' : `<span class="set-note">${esc(MODEL_CLI[a.run])} not set up on this Mac — not in the picker</span>`}
    ${a.builtin ? '' : `<button class="linkbtn" data-act="set-ag-del" data-ag="${esc(a.id)}">Remove</button>`}</div>`).join('');
  return `<div class="set-row set-agents"><div class="set-l">Agents<small>who a task can go to: the name, how it starts (▶ Run), shown in the task’s picker. Run here = Claude Code / Codex / Gemini CLI on this Mac; own queue = an assistant or a session takes it</small></div>
    <div class="ag-list">${rows}<div class="ag-row"><input id="ag-new" placeholder="New agent’s name"><button class="btn" data-act="set-ag-add">+ Add</button></div></div></div>`;
}
// Settings → Agents → Model: the model behind triage, voice, chat and ▶ Run — one of the CLIs on this Mac (lib/llm.js)
S.ai = null;
function modelSettingsHtml() {
  if (!S.ai) { if (S.ai !== false) { S.ai = false; api('GET', '/api/ai').then((a) => { S.ai = a; if (S.view === 'settings') renderMain(); }).catch(() => {}); } return ''; }
  const cur = S.ai.list.find((p) => p.id === S.ai.current);
  const missing = S.ai.list.filter((p) => !p.installed), unsigned = S.ai.list.filter((p) => p.installed && p.ready === false);
  const btns = S.ai.list.map((p) => `<button data-act="set-provider" data-val="${p.id}" class="${p.id === S.ai.current ? 'on' : ''}" ${p.ready !== false && p.installed ? '' : 'disabled'} title="${esc(!p.installed ? `${p.cli} is not installed: ${p.install}` : p.ready === false ? `${p.cli} is not signed in: ${p.login}` : `${p.cli} · ${p.plan}`)}">${esc(p.name)}</button>`).join('');
  const help = missing.length ? `<br>Not on this Mac: ${missing.map((p) => `${esc(p.name)} — <code>${esc(p.install)}</code>, then <code>${esc(p.login)}</code> once to sign in`).join('; ')}` : '';
  const help2 = unsigned.length ? `<br>Not signed in: ${unsigned.map((p) => `${esc(p.name)} — ${esc(p.login)}`).join('; ')}` : '';
  return `<div class="set-row"><div class="set-l">Model<small>what reads your inbox and voice, answers in the chat and runs agents: ${esc(cur?.cli || '')} on your ${esc(cur?.plan || '')}${help}${help2}</small></div><span class="seg">${btns}</span></div>`;
}
function saveAgents(change) {
  const list = agentList().map((a) => ({ id: a.id, name: a.name, run: a.run, on: a.on }));
  return saveSetting({ agents: change(list) });
}
document.addEventListener('change', (e) => {
  const id = e.target.dataset?.ag;
  if (!id || !e.target.closest('.settings')) return;
  if (e.target.matches('.ag-name')) { const name = e.target.value.trim(); if (name) saveAgents((l) => l.map((a) => (a.id === id ? { ...a, name } : a))); }
  if (e.target.matches('.ag-run')) saveAgents((l) => l.map((a) => (a.id === id ? { ...a, run: e.target.value } : a)));
});
// Google status (GET /api/gcal/status): connect from the Mac itself — the OAuth callback is 127.0.0.1.
function googleNote() {
  const g = S.gstatus;
  if (!g) return '…';
  if (!g.configured) return 'Not set up — see <code>docs/google.md</code> in the app folder';
  if (g.expired) return `<span class="d-over">Expired</span> — reconnect: ${['127.0.0.1', 'localhost'].includes(location.hostname) ? '<a href="/api/gcal/connect">Connect</a>' : `on the Mac, 127.0.0.1:${location.port || 4747}/api/gcal/connect`}`;
  const on = [['Calendar', g.googleCalendar], ['Gmail', g.gmail], ['Contacts', g.contacts], ['Drive', g.drive]].filter(([, v]) => v).map(([k]) => k);
  const local = ['127.0.0.1', 'localhost'].includes(location.hostname);
  const link = local ? `<a href="/api/gcal/connect">${on.length ? 'Re-connect' : 'Connect'}</a>` : `${on.length ? 'Re-connect' : 'Connect'} on the Mac: 127.0.0.1:${location.port || 4747}/api/gcal/connect`;
  return `${on.length ? `Connected: ${on.join(', ')}` : 'Not connected'} · ${link}`;
}
// Settings → Calendar: where Plan the day reads meetings and puts time blocks — the Mac's own calendars (Calendar.app:
// whatever accounts are added there, one Allow) or Google's (its own sign-in, Settings → Google). lib/calendar.js
const MAC_CAL_NOTE = {
  notDetermined: 'Gubernos needs your permission to read your calendars and add the time blocks you approve.',
  denied: 'Access was turned off: System Settings → Privacy & Security → Calendars → Gubernos Calendar → Full Access.',
  restricted: 'Calendar access is restricted on this Mac (Screen Time or a profile).',
  writeOnly: 'Gubernos can only add events, not read them: System Settings → Privacy & Security → Calendars → Gubernos Calendar → Full Access.',
};
function calendarSourceHtml() {
  const g = S.gstatus;
  if (!g) return '';
  const local = ['127.0.0.1', 'localhost'].includes(location.hostname), mac = g.macAccess;
  const macNote = g.source !== 'macos' ? '' : mac === 'full' ? ' · allowed' : mac === 'notDetermined'
    ? ` · ${local ? '<button class="linkbtn" data-act="set-maccal-allow">Allow access</button> (a macOS dialog)' : 'Allow on the Mac: Settings → Calendar'}`
    : ` · <span class="d-over">${esc(MAC_CAL_NOTE[mac] || String(mac))}</span>`;
  const googleNote = g.source !== 'google' ? '' : g.googleCalendar ? ' · connected' : ' · not connected (Settings → Google)';
  return `<div class="set-row"><div class="set-l">Calendar<small>where Plan the day sees your meetings and puts time blocks: this Mac’s calendars (every account in Calendar.app) or Google directly${macNote}${googleNote}</small></div>
    <span class="seg">${[['macos', 'This Mac'], ['google', 'Google']].map(([v, l]) => `<button data-act="set-calsrc" data-val="${v}" class="${g.source === v ? 'on' : ''}">${l}</button>`).join('')}</span></div>`;
}
// Settings → Calendars: which calendars Plan the day reads for meetings, and (the Mac's) which one gets the time blocks
// (GET /api/gcal/calendars; settings.calendars for Google, macCalendars / macCalendar for the Mac's).
S.gcals = null;
function calendarsHtml() {
  if (!S.gstatus?.connected || S.data?.local) return '';
  if (!S.gcals) { if (S.gcals !== false) { S.gcals = false; api('GET', '/api/gcal/calendars').then((l) => { S.gcals = l; if (S.view === 'settings') renderMain(); }).catch(() => {}); } return ''; }
  const mac = S.gstatus.source === 'macos';
  const main = mac ? `<label class="set-cal-main">Time blocks go to <select data-calmain>${S.gcals.filter((c) => c.writable).map((c) => `<option value="${esc(c.id)}"${c.primary ? ' selected' : ''}>${esc(c.name)}${c.account ? ` · ${esc(c.account)}` : ''}</option>`).join('')}</select></label>` : '';
  return `<div class="set-row"><div class="set-l">Calendars<small>whose meetings Plan the day keeps free · events marked “free” and declined ones don’t count · time blocks go to the main one</small></div>
    <div class="set-cals">${main}${S.gcals.map((c) => `<label><input type="checkbox" data-cal="${esc(c.id)}"${c.on ? ' checked' : ''}${c.primary ? ' disabled' : ''}> ${esc(c.name)}${mac && c.account ? ` <small>${esc(c.account)}</small>` : ''}${c.primary ? ' <small>main</small>' : ''}</label>`).join('')}</div></div>`;
}
const calsChanged = () => { S.planInfoAt = 0; S.planFree = null; S.gcals = null; renderMain(); };
document.addEventListener('change', (e) => {
  const m = e.target.closest('.settings [data-calmain]');
  if (m) return saveSetting({ macCalendar: m.value }).then(calsChanged);
  const x = e.target.closest('.settings [data-cal]');
  if (!x || !S.gcals) return;
  const c = S.gcals.find((y) => y.id === x.dataset.cal);
  if (c) c.on = x.checked;
  const read = S.gcals.filter((y) => y.on && !y.primary).map((y) => y.id);
  saveSetting(S.gstatus?.source === 'macos' ? { macCalendars: S.gcals.every((y) => y.on) ? null : read } : { calendars: read }).then(() => { S.planInfoAt = 0; S.planFree = null; });
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('.settings [data-act^="set-"]');
  if (!b) return;
  e.stopPropagation();
  const v = b.dataset.val;
  if (b.dataset.act === 'set-theme') { applyTheme(v); return renderMain(); }
  if (b.dataset.act === 'set-palette') { applyPalette(v); return saveSetting({ palette: +v }); }
  if (b.dataset.act === 'set-calsrc') return saveSetting({ calendarSource: v }).then(refreshCalStatus);
  if (b.dataset.act === 'set-maccal-allow') { toast('Look for the macOS dialog — Allow full access'); return api('POST', '/api/calendar/mac/access').then(refreshCalStatus, (err) => toast(err.message)); }
  if (b.dataset.act === 'set-notif') { if ((v === 'on') !== !!S.push.on) toggleNotifications(); return; }
  if (b.dataset.act === 'set-digest-off') return saveSetting({ digestAt: v === 'on' ? '08:30' : '' });
  if (b.dataset.act === 'set-undo') return saveSetting({ undoSeconds: +v });
  if (b.dataset.act === 'set-lunch-min') return saveSetting({ lunchMinutes: +v }).then(() => { S.planInfoAt = 0; });
  if (b.dataset.act === 'set-reminder-push') return saveSetting({ reminderPush: v === 'on' });
  if (b.dataset.act === 'set-checkin-push') return saveSetting({ checkinPush: v === 'on' });
  if (b.dataset.act === 'set-time-off') return saveSetting({ [b.dataset.key]: v === 'on' ? b.dataset.def : '' });
  if (b.dataset.act === 'set-reflect-format') return saveSetting({ reflectionFormat: v });
  if (b.dataset.act === 'set-habits') return saveSetting({ habits: v === 'on' }).then(() => load());
  if (b.dataset.act === 'set-provider') return saveSetting({ provider: v }).then(() => { S.ai = null; return load(); });
  if (b.dataset.act === 'set-simple') return saveSetting({ simple: v === 'on' });
  if (b.dataset.act === 'set-pair-show') { S.pairShow = !S.pairShow; return renderMain(); }
  if (b.dataset.act === 'set-pair-copy') return navigator.clipboard?.writeText(S.pair.webLink).then(() => toast('Link copied — open it on the other device'), () => prompt('The pairing link', S.pair.webLink));
  if (b.dataset.act === 'set-pair-required') return api('POST', '/api/pair/required', { on: v === 'on' }).then((x) => { S.pair = x; renderMain(); toast(v === 'on' ? 'Only paired devices get in now' : 'Pairing not required'); });
  if (b.dataset.act === 'set-pair-rotate') { if (!confirm('Make a new code? Every paired phone and browser has to scan it again.')) return; return api('POST', '/api/pair/rotate').then((x) => { S.pair = x; renderMain(); toast('New code — pair your devices again'); }); }
  if (b.dataset.act === 'set-mac-focus') return saveSetting({ macFocus: v === 'on' });
  if (b.dataset.act === 'set-mf-check') { S.macFocus = null; return renderMain(); }
  if (b.dataset.act === 'set-clock') return saveSetting({ clock: v }).then(() => { clockTimes(document.body); render(); });
  if (b.dataset.act === 'set-week-start') return saveSetting({ weekStart: v }).then(() => load());
  if (b.dataset.act === 'set-ow-add') {
    if (S.offWork?.now && !$('#ow-from')?.value) return toast('Pick its first day'); // else it would replace this one
    const from = $('#ow-from')?.value || iso(new Date()), to = $('#ow-to')?.value || null;
    if (to && to < from) return toast('The last day off is before the first');
    return api('POST', '/api/off-work', { add: { from, to, why: $('#ow-why')?.value || '' } }).then((o) => { S.offWork = o; load(); renderMain(); toast(from <= iso(new Date()) ? 'Off work — work habits paused' : 'Planned'); }).catch((err) => toast(err.message));
  }
  if (b.dataset.act === 'set-ow-end' || b.dataset.act === 'set-ow-del') {
    return api('POST', '/api/off-work', { [b.dataset.act === 'set-ow-end' ? 'end' : 'remove']: { from: v } }).then((o) => { S.offWork = o; load(); renderMain(); toast(b.dataset.act === 'set-ow-end' ? 'Back to work' : 'Removed'); }).catch((err) => toast(err.message));
  }
  if (b.dataset.act === 'set-ag-on') return saveAgents((l) => l.map((x) => (x.id === b.dataset.ag ? { ...x, on: v === 'on' } : x)));
  if (b.dataset.act === 'set-ag-del') return saveAgents((l) => l.filter((x) => x.id !== b.dataset.ag));
  if (b.dataset.act === 'set-ag-add') {
    const name = ($('#ag-new')?.value || '').trim();
    if (!name) return toast('Type the agent’s name first');
    let id = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent';
    while (agentOf(id)) id = `${id}-2`;
    return saveAgents((l) => [...l, { id, name, run: 'claude', on: true }]);
  }
}, true);
// a schedule row: off/on + the time (on = the default time)
function timeRow(label, hint, key, def, extra = null) {
  const seg = (act, cur, opts) => `<span class="seg">${opts.map(([v, l]) => `<button data-act="${act}" data-key="${key}" data-def="${def}" data-val="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</span>`;
  const v = S.settings?.[key];
  return `<div class="set-row"><div class="set-l">${label}<small>${hint}</small></div>
    <div class="set-digest">${seg('set-time-off', v ? 'on' : 'off', [['off', 'Off'], ['on', 'On']])}${v ? `<input type="time" class="set-time" data-key="${key}" value="${esc(v)}" step="300">${extra ? extra() : ''}` : ''}</div></div>`;
}
async function toggleNotifications() {
  const reg = await swReady;
  const cur = await reg.pushManager.getSubscription();
  if (cur) {
    await api('POST', '/api/push/unsubscribe', { endpoint: cur.endpoint });
    await cur.unsubscribe();
    S.push.on = false; renderMain(); return toast('Notifications off');
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return toast(navigator.standalone === false ? 'Add the app to the Home Screen first, then enable here' : 'Notifications are blocked in settings');
  try {
    const { key } = await api('GET', '/api/push/key');
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await api('POST', '/api/push/subscribe', { subscription: sub.toJSON(), ua: navigator.userAgent });
    S.push.on = true; renderMain();
    toast('Notifications on: reminders, morning digest, agents');
  } catch (e) { clog(`push subscribe failed: ${e.message}`); toast(`Couldn't enable: ${e.message}`); }
}
// Load the speech models as soon as the app is opened, so the first mic press isn't a cold start.
const warmVoice = () => fetch('/api/voice/warm', { method: 'POST' }).catch(() => {});
warmVoice();
document.addEventListener('visibilitychange', () => { if (!document.hidden) warmVoice(); });
applyTheme(currentTheme());
setInterval(pomoTick, 500);
route();
load().then(() => { for (const r of S.data.runs) if (r.state === 'running') follow(r.id); tourFirstRun(); });


// ---------- commands (voice + palette) ----------
// Executes an interpreted command from /api/voice/parse ({name, taskId, text, due, target}) or the palette.
// "Заметка: купить…" / "note: …" → the note itself.
const stripCaptureWord = (s) => String(s || '').replace(/^\s*(заметк[аиу]|иде[яю]|мысль|запомни|запиши|note( to self)?|idea|capture)\s*[:,.—-]?\s*/i, '').trim();
async function runCommand(c, heard = '') {
  const t = c.taskId ? taskById(c.taskId) : null;
  const current = () => taskById(S.focus?.id || S.openId);
  const missing = (what) => toast(`${what} — heard “${heard.slice(0, 60)}”`);
  switch (c.name) {
    case 'reschedule_overdue': return rescheduleOverdue();
    case 'focus': return startFocus(c.taskId);
    case 'focus_done': return S.focus ? focusDone() : missing('Not in focus');
    case 'focus_skip': return S.focus ? focusSkip() : missing('Not in focus');
    case 'focus_exit': return exitFocus();
    case 'pomodoro_start': if (!S.focus) startFocus(); return pomoStart();
    case 'pomodoro_pause': return pomoPause();
    case 'step_done': {
      const x = t || current();
      const step = x?.subtasks.find((s) => !s.done);
      if (!step) return missing(x ? 'No open steps left' : 'Which task?');
      await patch(x.id, { toggleCheck: step.i });
      toast(`✓ ${step.text.slice(0, 50)}`, 'Undo', async () => { await patch(x.id, { toggleCheck: step.i }); render(); }, GRACE_MS);
      return render();
    }
    case 'capture_note': return captureNote(stripCaptureWord(heard) || c.text, c.text);
    case 'report_feedback': return reportByVoice(c.target === 'idea' ? 'idea' : 'bug', heard.replace(FEEDBACK_RE, '') || c.text); // their own words, verbatim
    case 'add_note': {
      const x = t || current();
      if (!x) return captureNote(stripCaptureWord(heard) || c.text, ''); // no task in sight → it's a note for the Inbox
      if (!c.text) return missing('Which task?');
      await patch(x.id, { addNote: c.text });
      toast(`Note added to “${x.title.slice(0, 40)}”`);
      return render();
    }
    case 'postpone': {
      if (!c.due) return missing('Which date?');
      if (!t) return moveCurrent(c.due); // "move it …" = the task in focus / open in the card / in the inbox

      const old = t.due;
      await patch(t.id, { due: c.due });
      toast(`“${t.title.slice(0, 36)}” → ${dateLabel(c.due)[0]}`, 'Undo', async () => { await patch(t.id, { due: old }); load(); }, GRACE_MS);
      return load();
    }
    case 'drop': return dropCurrent(t?.id || null);
    case 'search': return voiceSearch(c.text || '');
    case 'ask': return askHere(c.text || '');
    case 'timeblock': {
      const x = t || current();
      if (!x) return missing('Which task?');
      const start = c.start || null;
      return timeblockModal(x, { minutes: c.minutes || null, start });
    }
    case 'complete': if (!t && S.focus?.mode === 'inbox' && currentTask()) return triageDone(); return t ? complete(t.id) : missing('Which task?');
    case 'process_inbox': return startMode('inbox');
    case 'undo': {
      const u = S.lastUndo;
      if (!u || Date.now() > u.until) return toast('Nothing to undo');
      S.lastUndo = null; hideToast();
      return u.fn();
    }
    case 'move': return moveCurrent(c.due);
    case 'complete_current': {
      if (S.focus?.mode === 'focus') return focusDone();
      if (S.focus?.mode === 'review') return reviewAccept(true); // "complete" in review = accept & close
      if (S.focus?.mode === 'inbox' && currentTask()) return triageDone();
      if (S.openId) return complete(S.openId);
      return missing('Which task?');
    }
    case 'create_project': return projectModal(null, { title: c.text || '', category: cats().includes(c.target) ? c.target : null });
    case 'set_project': {
      const slug = c.target && proj(c.target) ? c.target : null;
      const x = t || current();
      if (!slug || !x) return missing('Which project?');
      if (S.focus?.mode === 'inbox' && x.id === S.focus.id) return triage({ project: slug }, `# ${proj(slug).title}`);
      await patch(x.id, { project: slug });
      toast(`“${x.title.slice(0, 36)}” → # ${proj(slug).title}`);
      return render();
    }
    case 'review_agents': return startMode('review');
    case 'breakdown': return breakDown(t?.id || null);
    case 'why': return S.focus?.mode === 'focus' ? askWhy() : missing('Not in focus');
    case 'accept': return S.focus?.mode === 'review' ? reviewAccept(false) : missing('Not reviewing');
    case 'accept_close': return S.focus?.mode === 'review' ? reviewAccept(true) : missing('Not reviewing');
    case 'send_back': return S.focus?.mode === 'review' ? reviewSendBack(c.text || '', false) : missing('Not reviewing');
    case 'item_to_task': return currentItem() ? itemToTask(false) : missing('Not processing inbox');
    case 'item_to_agent': return currentItem() ? itemToTask(true) : missing('Not processing inbox');
    case 'item_archive': return currentItem() ? itemDispose('processed') : missing('Not processing inbox');
    case 'item_trash': return currentItem() ? itemDispose('trash') : missing('Not processing inbox');
    case 'open': {
      if (t) { S.openId = t.id; return render(); }
      if (c.target && VIEWS[c.target]) { location.hash = `#/${c.target}`; return; }
      if (c.target && proj(c.target)) { location.hash = `#/project/${c.target}`; return; }
      return missing('Where to?');
    }
  }
  return missing('Unknown command');
}

// Move every overdue open task to today; one Undo restores all previous dates.
async function rescheduleOverdue() {
  const today = S.data.today;
  const list = S.data.tasks.filter((t) => open(t) && t.due && t.due < today && !pendingDone.has(t.id));
  if (!list.length) return toast('Nothing overdue');
  const prev = list.map((t) => [t.id, t.due]);
  await Promise.all(list.map((t) => api('PATCH', `/api/tasks/${t.id}`, { due: today })));
  await load();
  toast(`Moved ${list.length} overdue ${list.length === 1 ? 'task' : 'tasks'} to today`, 'Undo', async () => {
    await Promise.all(prev.map(([id, due]) => api('PATCH', `/api/tasks/${id}`, { due })));
    load();
  }, GRACE_MS);
}

// ---------- palette (⌘K) ----------
function paletteItems(q) {
  const today = S.data.today;
  const overdue = S.data.tasks.filter((t) => open(t) && t.due && t.due < today).length;
  const cur = taskById(S.openId) || flat[S.sel];
  const items = [
    { label: `Reschedule overdue to today${overdue ? ` (${overdue})` : ''}`, hint: 'all overdue → today', run: rescheduleOverdue },
    { label: 'Focus', hint: 'the most important task + a sprint timer · f', run: () => startFocus() },
    ...(cur && open(cur) ? [{ label: `Focus on “${cur.title.slice(0, 40)}”`, hint: 'selected task', run: () => startFocus(cur.id) },
      { label: `Break down “${cur.title.slice(0, 40)}”`, hint: 'agent suggests steps', run: () => breakDown(cur.id) },
      { label: `Block time for “${cur.title.slice(0, 36)}”`, hint: 'Calendar', run: () => timeblockModal(cur) },
      { label: `Drop “${cur.title.slice(0, 40)}”`, hint: 'not done, no longer relevant · ⌫', run: () => dropTask(cur.id) }] : []),
    { label: `Process inbox${S.data.inbox.length ? ` (${S.data.inbox.length})` : ''}`, hint: 'captures one by one', run: () => startMode('inbox') },
    { label: 'Report a bug or idea', hint: ME().feedbackRemote ? 'about this app — a public GitHub issue' : 'about this app — with a snapshot of this screen', run: () => reportModal() },
    { label: `Review agents${VIEWS.agent.hot() ? ` (${VIEWS.agent.hot()})` : ''}`, hint: 'handed-back work one by one', run: () => startMode('review') },
    { label: 'New task', hint: 'q', run: () => quickAdd() },
    { label: 'New project', hint: 'name, category, outcome', run: () => projectModal() },
    { label: 'Ask the agent', hint: 'about what is on screen · c', run: () => askHere() },
    { label: 'Dictate', hint: 'voice: tasks or commands · v', run: () => quickAdd({}, {}, { voice: true }) },
    ...Object.entries(VIEWS).map(([k, v]) => ({ label: `Go to ${v.title}`, hint: v.key, run: () => (location.hash = `#/${k}`) })),
    ...S.data.projects.filter((p) => p.status === 'active').map((p) => ({ label: `Project: ${p.title}`, hint: p.category || '', run: () => (location.hash = `#/project/${p.slug}`) })),
    { label: 'Toggle theme', hint: 'd', run: cycleTheme },
  ];
  const n = q.trim().toLowerCase();
  if (!n) return items;
  const words = n.split(/\s+/);
  const match = (s) => words.every((w) => s.toLowerCase().includes(w));
  const tasks = S.data.tasks.filter((t) => open(t) && match(t.title)).slice(0, 8)
    .map((t) => ({ label: t.title, hint: t.project ? `# ${proj(t.project)?.title || t.project}` : 'task', run: () => { S.openId = t.id; render(); } }));
  return [...items.filter((i) => match(`${i.label} ${i.hint}`)), ...tasks];
}

function openPalette() {
  $('#modal').innerHTML = `<div class="overlay" data-act="qa-close"><div class="qa palette">
    <input class="q" id="pal-in" autocomplete="off" placeholder="Type a command or search tasks…"><div class="pal-list" id="pal-list"></div></div></div>`;
  const input = $('#pal-in'), list = $('#pal-list');
  let items = [], sel = 0;
  const draw = () => {
    items = paletteItems(input.value);
    sel = Math.min(sel, Math.max(0, items.length - 1));
    list.innerHTML = items.length
      ? items.map((it, i) => `<div class="pal-item ${i === sel ? 'on' : ''}" data-i="${i}"><span>${esc(it.label)}</span><span class="hint">${esc(it.hint || '')}</span></div>`).join('')
      : '<div class="empty">No matches</div>';
    list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  };
  const go = (i) => { const it = items[i]; if (!it) return; closeModal(); it.run(); };
  input.oninput = () => { sel = 0; draw(); };
  input.onkeydown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % Math.max(1, items.length); draw(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + items.length) % Math.max(1, items.length); draw(); }
    if (e.key === 'Enter') { e.preventDefault(); go(sel); }
  };
  list.onclick = (e) => { const el = e.target.closest('[data-i]'); if (el) go(+el.dataset.i); };
  draw();
  input.focus();
}

// ---------- one-at-a-time modes: focus · inbox · review ----------
// A full-screen overlay showing one thing at a time. S.focus = { mode, id, skipped[] }, persisted per browser.
// focus  — the most important task + pomodoro
// inbox  — 01_inbox captures, clarify each (task / agent / archive / trash)
// review — tasks agents handed back (accept / send back)
S.todayMode = (() => { try { return localStorage.getItem('todayMode') || 'list'; } catch { return 'list'; } })();
S.focus = (() => { try { const f = JSON.parse(localStorage.getItem('focus')); return f ? { mode: 'focus', skipped: [], ...f } : null; } catch { return null; } })();
S.why = null; // { id, loading, reason, suggestId, suggestTitle }
function saveFocus() { try { S.focus ? localStorage.setItem('focus', JSON.stringify(S.focus)) : localStorage.removeItem('focus'); } catch { /* private mode */ } }

// Deferred actions with Undo (same idea as completion): nothing is written until the grace period ends.
const pendingOps = new Map(); // key -> { timer, commit }
function deferOp(key, label, commit) {
  pendingOps.set(key, { timer: setTimeout(() => runOp(key), GRACE_MS), commit });
  toast(label, 'Undo', () => { const p = pendingOps.get(key); if (!p) return; clearTimeout(p.timer); pendingOps.delete(key); if (S.focus) { S.focus.id = key.split(':')[1]; saveFocus(); } render(); }, GRACE_MS);
  render();
}
async function runOp(key, leaving = false) {
  const p = pendingOps.get(key);
  if (!p) return;
  clearTimeout(p.timer);
  pendingOps.delete(key);
  try { await p.commit(leaving); } catch (e) { toast(`Failed: ${e.message}`); }
  if (!leaving) load();
}
window.addEventListener('pagehide', () => { for (const k of pendingOps.keys()) runOp(k, true); });
document.addEventListener('visibilitychange', () => { if (document.hidden) for (const k of pendingOps.keys()) runOp(k, true); });
const post = (url, body, keepalive) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), keepalive });

function focusQueue(skipped = []) {
  const today = S.data.today;
  const soon = iso(new Date(fromIso(today).getTime() + 3 * 864e5));
  const rank = (t) => {
    const overdue = t.due && t.due < today, dueToday = t.due === today;
    if (overdue && t.priority === 'urgent') return 0;
    if (t.deadline && t.deadline <= soon) return 1;
    if (dueToday && t.priority === 'urgent') return 2;
    if (overdue || dueToday) return 3;
    if (t.priority === 'urgent') return 4;
    return 5;
  };
  return S.data.tasks
    .filter((t) => t.status === 'new' && t.assigned === 'me' && t.priority !== 'someday' && !pendingDone.has(t.id) && !skipped.includes(t.id))
    .sort((a, b) => rank(a) - rank(b) || (a.deadline || '9').localeCompare(b.deadline || '9') || (a.due || '9').localeCompare(b.due || '9') || a.id.localeCompare(b.id));
}
function modeQueue(mode, skipped = []) {
  if (mode === 'inbox') {
    // Captures (01_inbox) first, then tasks without a project — both are what the Inbox view shows.
    const items = S.data.inbox.filter((it) => !pendingOps.has(`item:${it.id}`) && !skipped.includes(it.id));
    const loose = S.data.tasks.filter((t) => open(t) && !t.project && !pendingDone.has(t.id) && !skipped.includes(t.id)).sort(byPri);
    return [...items, ...loose];
  }
  if (mode === 'review') return S.data.tasks.filter((t) => open(t) && agentState(t) === 'review' && !pendingOps.has(`review:${t.id}`) && !skipped.includes(t.id)).sort(byPri);
  return focusQueue(skipped);
}
const MODE_NAMES = { focus: '◎ Focus', inbox: '⌂ Process inbox', review: '✦ Review agents' };
const MODE_TITLES = { focus: 'Focus', inbox: 'Inbox', review: 'Review' };
// Toolbar icons: one stroke style (matches the tab bar), labels live in title/aria-label.
const ICON = Object.fromEntries(Object.entries({
  why: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.6 2.3c-.7.3-1.2.9-1.2 1.7v.4"/><path d="M12 17.2v.1"/>',
  block: '<rect x="3.5" y="4.5" width="17" height="16" rx="3"/><path d="M3.5 9h17M8 2.8v3.4M16 2.8v3.4"/><path d="M12 12v3l2 1.4"/>',
  drop: '<circle cx="12" cy="12" r="9"/><path d="M5.7 5.7l12.6 12.6"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  focus: '<circle cx="12" cy="12" r="8.5"/><path d="M10.2 8.7l5 3.3-5 3.3z"/>',
  obsidian: '<path d="M14 4.5h5.5V10M19.5 4.5l-8.5 8.5"/><path d="M18 13.5V18a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2H11"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9.5M9.5 2.8h5M18.2 6.8l1.3-1.3"/>',
}).map(([k, v]) => [k, `<svg viewBox="0 0 24 24" aria-hidden="true">${v}</svg>`]));
const iconBtn = (act, icon, label, attrs = '') => `<button class="icon-btn" data-act="${act}" ${attrs} title="${label}" aria-label="${label}">${ICON[icon]}</button>`;

function startMode(mode, id = null) {
  const pick = id || modeQueue(mode)[0]?.id;
  if (!pick) return toast(mode === 'inbox' ? 'Inbox is empty' : mode === 'review' ? 'Nothing to review' : 'Nothing to focus on — all clear');
  S.focus = { mode, id: pick, skipped: [] };
  S.openId = null; S.why = null;
  saveFocus();
  render();
}
const startFocus = (id = null) => startMode('focus', id);
function nextFocus(extraSkip) {
  const q = modeQueue(S.focus.mode, [...S.focus.skipped, ...(extraSkip ? [extraSkip] : [])]);
  S.focus.id = q[0]?.id || null;
  S.why = null;
  saveFocus();
  render();
}
function focusDone() {
  if (!S.focus?.id) return;
  if (S.focus.mode === 'review') return reviewAccept();
  if (S.focus.mode !== 'focus') return;
  const id = S.focus.id;
  complete(id); // 5 s grace + Undo, which also brings focus back to this task
  nextFocus(id);
}
function focusSkip() {
  if (!S.focus?.id) return;
  S.focus.skipped.push(S.focus.id);
  nextFocus();
}
function exitFocus() {
  S.focus = null; S.why = null;
  saveFocus();
  document.title = APP_NAME;
  render();
}

// inbox actions
function currentItem() { return S.focus?.mode === 'inbox' ? S.data.inbox.find((x) => x.id === S.focus.id) : null; }
function currentTask() { return S.focus?.id && !currentItem() ? taskById(S.focus.id) : null; }
// Triage a project-less task: apply the change, then move on (it stays in the session's handled list).
async function triage(change, label) {
  const t = currentTask();
  if (!t) return;
  const before = Object.fromEntries(Object.keys(change).map((k) => [k, t[k] ?? null]));
  await patch(t.id, change);
  S.focus.skipped.push(t.id);
  nextFocus();
  toast(`“${t.title.slice(0, 32)}” → ${label}`, 'Undo', async () => {
    await patch(t.id, before);
    if (S.focus) { S.focus.skipped = S.focus.skipped.filter((x) => x !== t.id); S.focus.id = t.id; saveFocus(); }
    load();
  }, GRACE_MS);
}
function triageDone() {
  const t = currentTask();
  if (!t) return;
  complete(t.id);
  nextFocus(t.id);
}
function itemToTask(agent) {
  const it = currentItem();
  if (!it) return;
  quickAdd(agent ? { assigned: 'agent' } : {}, { title: it.title, notes: `From inbox capture [[${it.id}]]${it.sender ? ` (${it.sender})` : ''}:\n\n${it.body}`, itemId: it.id, source: it.source === 'mail' ? 'email' : 'agent' });
}
function itemToGoal(it) {
  goalModal(null, { title: it.title, description: it.body, onCreated: async (g) => {
    await api('POST', `/api/items/${encodeURIComponent(it.id)}/process`, { outcome: 'processed', goal: g.slug });
    if (S.focus?.mode === 'inbox') nextFocus();
    load();
  } });
}
function itemToProject(it) {
  projectModal(null, { title: it.title, outcome: it.body, itemId: it.id });
}
// Discuss a capture with the agent: Ask opens with the note as context; a task it proposes also clears the note.
function askAboutItem(it) {
  S.chat = { key: `i:${it.id}`, context: { itemId: it.id }, label: `✎ ${it.title}`, session: null, msgs: [], busy: false, deep: S.chat?.deep || false };
  openChat();
}
// Capture a raw note into the Inbox (01_inbox) — decide later what it is.
async function captureNote(text, title = '') {
  const body = String(text || '').trim();
  if (!body) return toast('Nothing to save');
  const it = await api('POST', '/api/items', { text: body, title: title || undefined });
  await load();
  toast(`Saved to Inbox: “${it.title.slice(0, 40)}”`, 'Undo', async () => { await api('POST', `/api/items/${encodeURIComponent(it.id)}/process`, { outcome: 'trash' }); load(); }, GRACE_MS);
  return it;
}
function itemDispose(outcome) {
  const it = currentItem();
  if (!it) return;
  deferOp(`item:${it.id}`, `${outcome === 'trash' ? 'Trashed' : 'Archived'} “${it.title.slice(0, 36)}”`,
    (leaving) => post(`/api/items/${encodeURIComponent(it.id)}/process`, { outcome }, leaving));
  nextFocus();
}
// review actions
function reviewAccept(close = false) {
  const t = S.focus?.mode === 'review' && taskById(S.focus.id);
  if (!t) return;
  const text = $('#fx-feedback')?.value.trim();
  deferOp(`review:${t.id}`, `Accepted${close ? ' & closed' : ''} “${t.title.slice(0, 36)}”`, (leaving) => post(`/api/tasks/${t.id}/accept`, { text, close }, leaving));
  nextFocus();
}
async function reviewSendBack(text, andRun) {
  const t = S.focus?.mode === 'review' && taskById(S.focus.id);
  if (!t) return;
  const fb = (text ?? $('#fx-feedback')?.value ?? '').trim();
  if (!fb) { $('#fx-feedback')?.focus(); return toast('Write feedback for the agent first'); }
  await api('POST', `/api/tasks/${t.id}/sendback`, { text: fb });
  toast(`Sent back “${t.title.slice(0, 36)}”`);
  if (andRun) await startRun(t.id);
  nextFocus(t.id);
  load();
}

// agent helpers
async function askWhy() {
  const t = S.focus?.mode === 'focus' && taskById(S.focus.id);
  if (!t) return;
  S.why = { id: t.id, loading: true };
  renderFocus();
  try {
    const r = await api('POST', '/api/focus/why', { taskId: t.id, candidateIds: focusQueue(S.focus.skipped).slice(0, 10).map((x) => x.id) });
    if (S.why?.id === t.id) S.why = { id: t.id, ...r };
  } catch { S.why = null; }
  renderFocus();
}
async function breakDown(id) {
  const t = taskById(id || S.focus?.id || S.openId);
  if (!t) return toast('Which task?');
  $('#modal').innerHTML = `<div class="overlay" data-act="qa-close"><div class="qa"><div class="bd-h">✦ Break down</div><div class="bd-t">${inline(t.title)}</div>
    <div id="bd-body"><div class="vstatus"><span class="spin"></span>Thinking of next steps…</div></div></div></div>`;
  let steps;
  try { steps = (await api('POST', `/api/tasks/${t.id}/breakdown`)).steps; } catch { return closeModal(); }
  if (!$('#bd-body')) return; // closed meanwhile
  if (!steps.length) { closeModal(); return toast('No new steps suggested'); }
  const sel = steps.map(() => true);
  const draw = () => {
    $('#bd-body').innerHTML = `${steps.map((s, i) => `<div class="draft ${sel[i] ? '' : 'off'}"><input type="checkbox" data-bd="${i}" ${sel[i] ? 'checked' : ''}>
      <div class="draft-main"><textarea class="draft-title" data-bdt="${i}" rows="1">${esc(s)}</textarea></div></div>`).join('')}
      <div class="foot"><span class="sp">Edit or untick, then add to the task's subtasks.</span><button class="btn" data-act="qa-close">Cancel</button>
      <button class="btn primary" id="bd-add">Add ${sel.filter(Boolean).length} steps</button></div>`;
    $('#bd-body').querySelectorAll('.draft-title').forEach(autosize);
  };
  draw();
  $('#bd-body').onchange = (e) => { if (e.target.dataset.bd) { sel[+e.target.dataset.bd] = e.target.checked; draw(); } };
  $('#bd-body').oninput = (e) => { if (e.target.dataset.bdt) { steps[+e.target.dataset.bdt] = e.target.value; autosize(e.target); } };
  $('#bd-body').onclick = async (e) => {
    if (e.target.id !== 'bd-add') return;
    const add = steps.filter((s, i) => sel[i] && s.trim());
    closeModal();
    await patch(t.id, { addSubtasks: add });
    toast(`Added ${add.length} steps to “${t.title.slice(0, 30)}”`);
    render();
  };
}

function renderFocus() {
  let el = $('#focus');
  if (!S.focus) { if (el) el.remove(); document.body.classList.remove('focus-on'); return; }
  if (!el) { el = document.createElement('section'); el.id = 'focus'; document.body.appendChild(el); }
  document.body.classList.add('focus-on');
  const keepFx = el.dataset.id === S.focus.id ? $('.fx-body', el)?.scrollTop || 0 : 0;
  el.dataset.id = S.focus.id || '';
  requestAnimationFrame(() => { const b = $('.fx-body', el); if (b && keepFx) b.scrollTop = keepFx; });
  const mode = S.focus.mode;
  const queue = modeQueue(mode, S.focus.skipped);
  // current item vanished (done elsewhere, processed, accepted) → move on
  if (S.focus.id && !queue.some((x) => x.id === S.focus.id) && !pendingDone.has(S.focus.id) && !(mode === 'focus' && taskById(S.focus.id) && open(taskById(S.focus.id)))) {
    S.focus.id = queue[0]?.id || null; saveFocus();
  }
  const cnt = S.focus.id ? `<span class="fx-count">${queue.length} left</span>` : '';
  const header = `<div class="fx-top"><span class="fx-brand">${MODE_TITLES[mode]}</span>${cnt}<span class="sp"></span>
    ${mode === 'focus' && S.focus.id ? iconBtn('why', 'why', 'Why this one? (w)') : ''}
    ${mode === 'focus' && S.focus.id ? iconBtn('tb-open', 'block', 'Block time in your calendar') : ''}
    ${mode !== 'review' && S.focus.id && !currentItem() ? iconBtn('drop', 'drop', 'Drop — not done, no longer relevant') : ''}
    ${iconBtn('focus-exit', 'close', 'Exit (Esc)')}</div>`;
  if (!S.focus.id) {
    const msg = { focus: ['All clear.', 'Nothing urgent or due is left. Pick any task from a list, or take a break.'],
      inbox: ['Inbox zero.', 'Every capture is clarified.'], review: ['All reviewed.', 'No agent work waiting for you.'] }[mode];
    el.innerHTML = `${header}<div class="fx-body fx-clear"><div class="fx-title">${msg[0]}</div><p>${msg[1]}</p>${mode === 'focus' ? pomoHtml() : ''}</div>
      <div class="fx-actions"><button class="btn primary big" data-act="focus-exit">Back to lists</button></div>`;
    return pomoTick();
  }
  const mic = ''; // the global floating #mic serves every screen, so it isn't wedged between Skip and Done
  if (mode === 'inbox' && !currentItem()) {
    const t = taskById(S.focus.id);
    const today = S.data.today;
    const tom = iso(new Date(fromIso(today).getTime() + 864e5));
    const nextMon = iso(new Date(fromIso(today).getTime() + (((8 - fromIso(today).getDay()) % 7) || 7) * 864e5));
    const meta = [];
    if (t.due) { const [l, c] = dateLabel(t.due); meta.push(`<span class="${c}">◷ ${l}</span>`); }
    if (t.deadline) { const [l, c] = dateLabel(t.deadline); meta.push(`<span class="${c}">⚑ ${l}</span>`); }
    if (t.priority !== 'planned') meta.push(`<span class="pill">${t.priority}</span>`);
    const as = agentState(t); if (as) meta.push(`<span class="pill agent">✦ ${as}</span>`);
    if (t.checks.total) meta.push(`<span>☑ ${t.checks.done}/${t.checks.total}</span>`);
    const notes = t.body.replace(/<!--[\s\S]*?-->/g, '').trim();
    const chip = (act, attrs, label, cls = '') => `<button class="chip ${cls}" data-act="${act}" ${attrs}>${label}</button>`;
    el.innerHTML = `${header}<div class="fx-body">
      <div class="meta fx-meta"><span class="pill">task · no project</span>${meta.join('')}</div>
      <div class="fx-title">${inline(t.title)}</div>
      ${notes ? `<details class="fx-notes"><summary>Notes</summary><div class="md fx-clip">${md(notes, false)}</div></details>` : ''}
      <div class="tri"><div class="lbl">Project</div><div class="chips">${S.data.projects.filter((p) => p.status === 'active')
        .map((p) => chip('tri-project', `data-slug="${p.slug}"`, `<span class="dot cat-${p.category || 'none'}"></span> ${esc(p.title)}`)).join('')}${chip('tri-newproject', '', '+ New project')}</div></div>
      <div class="tri"><div class="lbl">When</div><div class="chips">
        ${chip('tri-due', `data-due="${today}"`, 'Today')}${chip('tri-due', `data-due="${tom}"`, 'Tomorrow')}${chip('tri-due', `data-due="${nextMon}"`, 'Next week')}
        ${chip('tri-someday', '', '☁ Someday')}${t.due ? chip('tri-due', 'data-due=""', 'No date') : ''}</div></div>
      </div>
      <div class="fx-actions wrap"><button class="btn big" data-act="focus-skip">Skip</button>${mic}
        ${t.assigned !== 'agent' ? '<button class="btn big agentish" data-act="tri-agent">✦ Agent</button>' : ''}
        <button class="btn primary big" data-act="tri-done">✓ Done</button></div>`;
    return;
  }
  if (mode === 'inbox') {
    const it = S.data.inbox.find((x) => x.id === S.focus.id);
    el.innerHTML = `${header}<div class="fx-body">
      <div class="meta fx-meta"><span class="pill">${esc(it.source || 'item')}</span>${it.sender ? `<span>${esc(it.sender)}</span>` : ''}${it.date ? `<span>${dateLabel(it.date)[0]}</span>` : ''}
        ${it.suggestion ? `<span class="pill agent">suggested: ${esc(it.suggestion)}</span>` : ''}</div>
      <div class="fx-title">${inline(it.title)}</div>
      <div class="md fx-md">${md(it.body, false)}</div></div>
      <div class="fx-actions wrap">
        <button class="btn big" data-act="focus-skip">Skip</button>${mic}
        <button class="btn big" data-act="item-trash">Delete</button><button class="btn big" data-act="item-archive">Archive</button>
        <button class="btn big" data-act="item-ask">Ask</button><button class="btn big" data-act="item-goal">Goal</button><button class="btn big" data-act="item-project">Project</button>
        <button class="btn big agentish" data-act="item-agent">✦ Agent</button><button class="btn primary big" data-act="item-task">Task</button></div>`;
    return;
  }
  const t = taskById(S.focus.id);
  if (mode === 'review') {
    const log = (t.body.match(/^##\s+Agent log\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m) || [])[1] || '';
    const entries = log.split(/\n(?=- \d{4}-\d{2}-\d{2} )/).map((s) => s.trim()).filter(Boolean);
    // "- 2026-09-24 13:36 · claude · text" → small "claude · 13:36" caption + the text
    const report = entries.filter((e) => !/· app · /.test(e)).slice(-2).map((e) => {
      const m = e.match(/^- \d{4}-\d{2}-\d{2} (\d{2}:\d{2}) · ([^·]+?) · ([\s\S]*)$/);
      return m ? `<div class="rep-by">${esc(m[2])} · ${m[1]}</div>${md(m[3].replace(/^ {2}/gm, ''), false)}` : md(e, false);
    }).join('');
    const rest = t.body.replace(/^##\s+Agent log[\s\S]*?(?=^## |(?![\s\S]))/m, '').trim();
    el.innerHTML = `${header}<div class="fx-body">
      <div class="meta fx-meta">${t.project ? `<span># ${esc(proj(t.project)?.title || t.project)}</span>` : ''}${t.checks.total ? `<span>☑ ${t.checks.done}/${t.checks.total}</span>` : ''}</div>
      <div class="fx-title">${inline(t.title)}</div>
      <div class="fx-next"><div class="lbl">Agent report</div><div class="md">${report || '<p class="placeholder">No report in the Agent log.</p>'}</div></div>
      ${rest ? `<details class="fx-notes"><summary>Brief, steps & deliverables</summary><div class="md">${md(rest, false)}</div></details>` : ''}
      <textarea id="fx-feedback" class="fx-feedback" placeholder="Feedback (needed to send back, optional to accept)"></textarea></div>
      <div class="fx-actions wrap"><button class="btn big" data-act="focus-skip">Skip</button>${mic}
        <button class="btn big" data-act="review-back">↺ Send back</button><button class="btn big agentish" data-act="review-back-run">↺ Back & run</button>
        <button class="btn big" data-act="review-accept-close" title="Accept and complete the task">✓ Accept & close</button>
        <button class="btn primary big" data-act="review-accept" title="Accept; the task stays open and comes back to you">✓ Accept</button></div>`;
    return;
  }
  const next = t.subtasks.find((s) => !s.done);
  const rest = t.subtasks.filter((s) => s !== next);
  const meta = [];
  if (t.project) meta.push(`# ${esc(proj(t.project)?.title || t.project)}`);
  if (t.due) { const [l, c] = dateLabel(t.due); meta.push(`<span class="${c}">◷ ${l}</span>`); }
  if (t.deadline) { const [l, c] = dateLabel(t.deadline); meta.push(`<span class="${c}">⚑ ${l}</span>`); }
  if (t.priority === 'urgent') meta.push('<span class="d-over">urgent</span>');
  const notes = t.body.replace(/^##\s+Subtasks[\s\S]*?(?=^## |(?![\s\S]))/m, '').replace(WOOP_SECTION, '').trim();
  const why = S.why?.id === t.id ? `<div class="fx-why"><button class="fx-why-x" data-act="why-close" aria-label="Close">✕</button>${S.why.loading ? '<div class="vstatus"><span class="spin"></span>Asking the agent…</div>'
    : `<p>${esc(S.why.reason)}</p>${S.why.suggestId ? `<button class="btn" data-act="focus-switch" data-id="${S.why.suggestId}">Switch to “${esc(S.why.suggestTitle.slice(0, 50))}”</button>` : ''}`}</div>` : '';
  el.innerHTML = `${header}
    <div class="fx-body">
      <div class="meta fx-meta">${meta.join('')}</div>
      <div class="fx-title">${inline(t.title)}</div>
      ${why}
      ${t.woop?.plan ? `<div class="fx-woop"><div class="lbl">When it gets hard</div><div>${woopPlanHtml(t.woop.plan)}</div></div>` : ''}
      ${next ? `<div class="fx-next"><div class="lbl">Next step</div>
        <div class="fx-step"><button class="check" data-act="sub-toggle" data-id="${t.id}" data-ck="${next.i}"></button><span>${inline(next.text)}</span></div></div>`
        : `<div class="fx-next empty-steps"><div class="lbl">Next step</div><p>No steps yet.</p></div>`}
      ${rest.length ? `<div class="fx-steps">${rest.map((s) => `<div class="subrow ${s.done ? 'done' : ''}" data-id="${t.id}">
        <button class="check sm ${s.done ? 'done' : ''}" data-act="sub-toggle" data-id="${t.id}" data-ck="${s.i}"></button><span class="subtext">${inline(s.text)}</span></div>`).join('')}</div>` : ''}
      <button class="linkbtn fx-bd" data-act="breakdown">✦ Break down into steps</button>
      ${pomoHtml()}
      ${notes ? `<details class="fx-notes"><summary>Notes</summary><div class="md">${md(notes, false)}</div></details>` : ''}
    </div>
    <div class="fx-actions">
      <button class="btn big" data-act="focus-skip" title="s">Skip</button>${mic}
      <button class="btn primary big" data-act="focus-done" title="x">✓ Done → next</button>
    </div>`;
  pomoTick();
}

// ---------- pomodoro 25/5 ----------
// State lives in localStorage with an absolute end time, so reloads and a locked phone don't lose it.
const POMO = { work: 25 * 60, break: 5 * 60 };
let pomo = (() => {
  try { const p = JSON.parse(localStorage.getItem('pomo')); if (p) return p; } catch { /* ignore */ }
  return { phase: 'work', running: false, endsAt: null, left: POMO.work, count: 0, day: iso(new Date()) };
})();
let audioCtx = null;
function savePomo() { try { localStorage.setItem('pomo', JSON.stringify(pomo)); } catch { /* private mode */ } }
function pomoLeft() { return pomo.running ? Math.max(0, Math.round((pomo.endsAt - Date.now()) / 1000)) : pomo.left; }
// AICODE-NOTE: a sprint belongs to the task it was started on (Weekly review while you walk through other tasks):
// it is logged to that task even after Focus moved on, the task was closed or Focus was left; Resume keeps it.
function pomoStart() {
  if (pomo.running) return;
  if (pomo.phase === 'work' && pomo.left === POMO.work) {
    const t = S.focus?.mode === 'focus' && S.focus.id ? taskById(S.focus.id) : null;
    pomo.taskId = t?.id || null; pomo.title = t?.title || null;
  }
  pomo.running = true; pomo.endsAt = Date.now() + pomo.left * 1000; savePomo(); pomoTick();
}
function pomoPause() { if (!pomo.running) return; pomo.left = pomoLeft(); pomo.running = false; pomo.endsAt = null; savePomo(); pomoTick(); }
function pomoReset() { pomo = { ...pomo, phase: 'work', running: false, endsAt: null, left: POMO.work, taskId: null, title: null }; savePomo(); pomoTick(); if (!S.focus) renderMain(); }
// a sprint under way (running, or paused mid-way): shown in every screen's header
let pomoShown = null;
function pomoActive() { return pomo.running || (pomo.phase === 'work' && pomo.left < POMO.work); }
// compact = the Focus icon itself turns into the ring (Today's header, where the Focus button sits): nothing moves
function pomoLiveHtml(compact = false) {
  try { if (!pomoActive()) return ''; } catch { return ''; } // the first render runs before the timer's state is read
  const name = pomo.phase === 'break' ? 'Break' : pomo.title || 'Sprint';
  return `<button class="pomo-live ${pomo.phase}${pomo.running ? '' : ' paused'}${compact ? ' compact' : ''}" id="pomo-live" data-act="pomo-open" title="${esc(pomo.phase === 'break' ? 'Break — back to Focus' : `Sprint on “${name}” — back to Focus`)}">
    <svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" class="pl-track"/><circle cx="10" cy="10" r="8" class="pl-ring" id="pomo-live-ring"/><circle cx="10" cy="10" r="3" class="pl-dot"/></svg>
    <span id="pomo-live-t">${pomo.running ? '' : '❚❚ '}</span><span class="pl-title">${esc(name.slice(0, 32))}</span></button>`;
}
function pomoOpen() {
  const t = pomo.taskId && taskById(pomo.taskId);
  startFocus(t && t.status !== 'done' ? t.id : null);
}
function beep(times = 3) {
  try {
    const ctx = mic.ctx || audioCtx || (audioCtx = new AudioContext()); // created late on purpose (see mic notes)
    for (let i = 0; i < times; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      const t0 = ctx.currentTime + i * 0.35;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
      o.start(t0); o.stop(t0 + 0.3);
    }
  } catch { /* no audio */ }
  navigator.vibrate?.([200, 100, 200]);
}
function pomoTick() {
  if (pomo.day !== iso(new Date())) { pomo.day = iso(new Date()); pomo.count = 0; savePomo(); }
  // the app left open past midnight: "today" starts from zero (the stats were loaded yesterday)
  if (S.pomoStats && S.pomoStatsDay !== iso(new Date())) {
    S.pomoStats = { ...S.pomoStats, today: 0, todayByTask: {} };
    loadPomoStats().then(() => { renderMain(); pomoTick(); });
  }
  if (pomo.running && pomoLeft() <= 0) {
    beep();
    if (pomo.phase === 'work') {
      // A full work phase: log it with its real times (also when noticed late, after the phone was locked).
      const end = pomo.endsAt, start = end - POMO.work * 1000;
      recordPomodoro({ start, end, minutes: POMO.work / 60, taskId: pomo.taskId !== undefined ? pomo.taskId : S.focus?.mode === 'focus' ? S.focus.id : null });
      pomo.count += 1; pomo.phase = 'break'; pomo.left = POMO.break; pomo.endsAt = Date.now() + POMO.break * 1000; // break starts by itself
      toast('Sprint done — take 5');
    } else {
      pomo.phase = 'work'; pomo.left = POMO.work; pomo.running = false; pomo.endsAt = null; // next one starts when you're ready
      toast('Break over — ready for the next one');
    }
    savePomo();
  }
  const left = pomoLeft();
  const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  const total = POMO[pomo.phase];
  const el = $('#pomo');
  if (el) {
    el.classList.toggle('break', pomo.phase === 'break');
    $('#pomo-time').textContent = mmss;
    $('#pomo-phase').textContent = pomo.phase === 'work' ? 'Focus' : 'Break';
    $('#pomo-ring').style.strokeDashoffset = String(339.3 * (1 - left / total));
    $('#pomo-btn').textContent = pomo.running ? '❚❚ Pause' : left === total ? '▶ Start' : '▶ Resume';
    const n = S.pomoStats?.today || 0;
    $('#pomo-count').textContent = n ? `⚡ ${n} today` : '';
  }
  document.title = pomo.running ? `${mmss} · ${pomo.phase === 'work' ? 'Focus' : 'Break'}` : APP_NAME;
  const live = $('#pomo-live');
  const act = pomoActive();
  if (pomoShown !== null && act !== pomoShown && !S.focus) { pomoShown = act; renderMain(); } // started, ended or reset: the header pill comes or goes
  pomoShown = act;
  if (live) {
    $('#pomo-live-t').textContent = `${pomo.running ? '' : '❚❚ '}${mmss}`;
    $('#pomo-live-ring').style.strokeDashoffset = String(50.27 * (1 - left / total));
    live.classList.toggle('break', pomo.phase === 'break'); live.classList.toggle('paused', !pomo.running);
  }
  const pf = $('#pomo-for');
  if (pf) pf.textContent = pomo.taskId && pomo.taskId !== S.focus?.id && pomoActive() && pomo.phase === 'work' ? `Sprint for “${(pomo.title || '').slice(0, 40)}”` : '';
}
function pomoHtml() {
  return `<div class="pomo" id="pomo">
    <svg viewBox="0 0 120 120" class="pomo-svg"><circle cx="60" cy="60" r="54" class="pomo-track"/><circle cx="60" cy="60" r="54" class="pomo-ring" id="pomo-ring"/></svg>
    <div class="pomo-mid"><div class="pomo-time" id="pomo-time">25:00</div><div class="pomo-phase" id="pomo-phase">Focus</div></div>
    <div class="pomo-ctl"><button class="btn" id="pomo-btn" data-act="pomo-toggle" title="p">▶ Start</button><button class="btn ghost" data-act="pomo-reset">Reset</button><span id="pomo-count" class="pomo-count"></span></div>
    <div class="pomo-for" id="pomo-for"></div>
  </div>`;
}

// ---------- projects ----------
function projectModal(p = null, prefill = {}) {
  const cat = p?.category || prefill.category || (S.view === 'project' ? proj(S.arg)?.category : null) || null;
  const goals = S.data.goals || [];
  $('#modal').innerHTML = `<div class="overlay" data-act="qa-close"><div class="qa pm">
    <div class="bd-h">${p ? 'Edit project' : 'New project'}</div>
    <input class="q" id="pm-title" autocomplete="off" placeholder="Project name" value="${esc(p?.title || prefill.title || '')}">
    <div class="tri"><div class="lbl">Category</div><div class="chips">${cats().map((c) => `<button class="chip ${c === cat ? 'on' : ''}" data-cat="${c}"><span class="dot cat-${c}"></span> ${c}</button>`).join('')}</div></div>
    <div class="tri"><div class="lbl">Goal (optional)</div><select id="pm-goal" class="pm-select"><option value="">— none —</option>
      ${goals.map((g) => `<option value="${esc(g.slug)}" ${p?.goal === g.slug ? 'selected' : ''}>${esc(g.title)}</option>`).join('')}<option value="__new__">+ New goal…</option></select>
      <input id="pm-newgoal" class="pm-select" placeholder="New goal name" autocomplete="off" hidden></div>
    <div class="tri"><div class="lbl">Outcome</div><textarea id="pm-outcome" rows="2" placeholder="What does done look like?">${esc(p?.outcome || prefill.outcome || '')}</textarea></div>
    <div class="foot"><span class="sp">${p ? '' : 'Creates 20_projects/&lt;slug&gt;.md from the template.'}</span><button class="btn" data-act="qa-close">Cancel</button>
      <button class="btn primary" id="pm-save">${p ? 'Save' : 'Create project'}</button></div></div></div>`;
  let category = cat;
  const box = $('.pm');
  box.onclick = async (e) => {
    const chip = e.target.closest('[data-cat]');
    if (chip) { category = chip.dataset.cat; box.querySelectorAll('[data-cat]').forEach((b) => b.classList.toggle('on', b === chip)); return; }
    if (e.target.id !== 'pm-save') return;
    const title = $('#pm-title').value.trim();
    if (!title) return $('#pm-title').focus();
    if (!category) return toast('Pick a category');
    let goal = $('#pm-goal')?.value || null;
    if (goal === '__new__') { // a new goal typed right here
      const name = $('#pm-newgoal').value.trim();
      if (!name) return $('#pm-newgoal').focus();
      goal = (await api('POST', '/api/goals', { title: name })).slug;
    }
    const outcome = $('#pm-outcome')?.value || '';
    if (p) {
      await api('PATCH', `/api/projects/${encodeURIComponent(p.slug)}`, { title, category, goal, outcome });
      closeModal(); toast('Project saved'); return load();
    }
    const np = await api('POST', '/api/projects', { title, category, goal, outcome });
    if (prefill.itemId) await api('POST', `/api/items/${encodeURIComponent(prefill.itemId)}/process`, { outcome: 'processed', project: np.slug });
    closeModal();
    if (prefill.onCreated) { await load(); return prefill.onCreated(np); }
    if (prefill.taskId) { // made from a task: move the task there and stay on it
      await patch(prefill.taskId, { project: np.slug });
      await load(); renderDrawer(true);
      return toast(`Created “${np.title}” — task moved there`);
    }
    if (S.focus?.mode === 'inbox') nextFocus();
    await load();
    location.hash = `#/project/${np.slug}`;
    toast(`Created “${np.title}”`);
  };
  $('#pm-goal').onchange = (e) => { const n = $('#pm-newgoal'); n.hidden = e.target.value !== '__new__'; if (!n.hidden) n.focus(); };
  $('#pm-title').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#pm-save').click(); } };
  $('#pm-outcome') && autosize($('#pm-outcome'));
  $('#pm-title').focus();
}

async function completeProject(slug) {
  const p = proj(slug);
  const openCount = S.data.tasks.filter((t) => open(t) && t.project === slug).length;
  await api('PATCH', `/api/projects/${encodeURIComponent(slug)}`, { status: 'done' });
  location.hash = '#/today';
  await load();
  toast(`Completed “${p?.title || slug}”${openCount ? ` — ${openCount} open tasks keep their link` : ''}`, 'Undo', async () => {
    await api('PATCH', `/api/projects/${encodeURIComponent(slug)}`, { status: 'active' });
    await load();
    location.hash = `#/project/${slug}`;
  }, GRACE_MS);
}

// ---------- shared mic resources ----------
// AICODE-NOTE: iOS Safari: an AudioContext must be created/resumed inside the user gesture or its analyser stays
// silent (breaks pause detection), and every fresh getUserMedia may re-prompt for permission. So: one AudioContext
// for the app, resumed on each press, and the mic stream is kept for 60 s after use (stopped when the app hides).
// AICODE-NOTE (iOS): never CREATE the AudioContext before getUserMedia — iOS then records silence (0-byte clips).
// Create it right after the stream exists; on later presses only resume() it inside the gesture.
const mic = { ctx: null, stream: null, idle: 0 };
function micGesture() {
  try { if (mic.ctx && mic.ctx.state !== 'running') mic.ctx.resume(); } catch { /* no audio */ }
}
function micContext() {
  try { mic.ctx = mic.ctx || new (window.AudioContext || window.webkitAudioContext)(); mic.ctx.resume(); } catch { /* no audio */ }
  return mic.ctx;
}
async function micStream() {
  clearTimeout(mic.idle);
  const ok = mic.stream && mic.stream.getAudioTracks().some((t) => t.readyState === 'live' && !t.muted);
  if (ok) return mic.stream;
  micStop();
  mic.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  mic.stream.getAudioTracks().forEach((t) => { t.onended = () => { clog('mic track ended'); micStop(); }; });
  return mic.stream;
}
// Full reset after a silent/empty recording: drop the stream and the audio context, start clean next time.
function micReset(reason) {
  clog(`mic reset: ${reason}`);
  micStop();
  try { mic.ctx?.close(); } catch { /* ignore */ }
  mic.ctx = null;
}
// Release the mic right after each recording: a stream kept open shows iOS's mic indicator, and if it's switched
// off from outside it stays half-dead and records silence. (Allow the mic for this site in Safari to avoid prompts.)
function micRelease() { micStop(); }
function micStop() { mic.stream?.getTracks().forEach((t) => t.stop()); mic.stream = null; }
document.addEventListener('visibilitychange', () => { if (document.hidden) micStop(); });
function clog(msg) {
  try { navigator.sendBeacon?.('/api/log', new Blob([JSON.stringify({ msg, ua: navigator.userAgent.match(/(iPhone|iPad|Mac|Android)[^;)]*/)?.[0] || '' })], { type: 'application/json' })); } catch { /* ignore */ }
}
window.addEventListener('error', (e) => clog(`js error: ${e.message} @${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => clog(`promise: ${e.reason?.message || e.reason}`));

// ---------- mic gesture: hold = push-to-talk, tap = hands-free ----------
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('[data-voice]');
  if (!b || e.button > 0) return;
  e.preventDefault();
  micGesture();
  const field = b.closest('[data-dictate]')?.dataset.dictate;
  S.voiceTarget = field ? `field:${field}` : b.closest('.tchat') ? 'tchat' : b.closest('#chat') ? 'chat' : null; // dictate into that chat / field
  // Already listening hands-free → this tap means "I'm done, send it".
  if (S.qaVoice?.recording()) { clog('mic tap → stop'); return S.qaVoice.stop(); }
  const t0 = Date.now();
  b.classList.add('holding');
  document.body.classList.add('mic-holding'); // no text selection / callouts anywhere while the finger is down
  quickAdd({}, {}, { voice: true, hold: true }); // start listening immediately so the first word isn't lost
  const up = (ev) => {
    document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up);
    b.classList.remove('holding');
    document.body.classList.remove('mic-holding');
    getSelection()?.removeAllRanges();
    S.qaVoice?.release(Date.now() - t0, ev.type);
    $('#mic')?.classList.toggle('recording', !!S.qaVoice?.recording());
  };
  document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
});
// iOS starts its long-press selection/callout from touchstart; pointer preventDefault alone doesn't stop it.
document.addEventListener('touchstart', (e) => { if (e.target.closest('[data-voice]')) e.preventDefault(); }, { passive: false });
document.addEventListener('selectstart', (e) => { if (document.body.classList.contains('mic-holding')) e.preventDefault(); });
document.addEventListener('contextmenu', (e) => { if (e.target.closest('[data-voice]') || document.body.classList.contains('mic-holding')) e.preventDefault(); });

// ---------- fast path for short voice commands ----------
// Exact short phrases run instantly (no model call). Anything else goes to /api/voice/parse.
const normSpeech = (s) => s.toLowerCase().replace(/[.,!?…"'«»“”:;—-]/g, ' ').replace(/\s+/g, ' ').trim();
const DROP_WORDS = ['drop', 'дроп', 'неактуально', 'не актуально', 'удали', 'удали задачу', 'удалить', 'удалить задачу', 'забудь', 'выкинь'];
const MOVE = (kind, say) => ({ when: () => S.focus || S.openId, name: 'move', due: () => quickDate(kind), say });
const FAST_COMMANDS = [
  { when: () => (S.focus && S.focus.mode !== 'review' && !currentItem()) || (!S.focus && S.openId), name: 'drop', say: DROP_WORDS },
  { when: () => true, name: 'undo', say: ['undo', 'revert', 'отмени', 'отмена', 'отменить', 'верни назад'] },
  { when: () => S.focus || S.openId, name: 'complete_current', say: ['complete', 'completed', 'закрой', 'закрыть', 'выполнено', 'выполнил'] },
  { when: () => !S.focus && S.openId, name: 'complete_current', say: ['готово', 'сделано', 'сделал', 'done'] },
  { when: () => S.focus?.mode === 'review', name: 'accept', say: ['go', 'гоу', 'поехали', 'давай'] },
  MOVE('today', ['today', 'move today', 'move to today', 'сегодня', 'на сегодня', 'перенеси на сегодня']),
  MOVE('tomorrow', ['tomorrow', 'move tomorrow', 'move to tomorrow', 'завтра', 'на завтра', 'перенеси на завтра']),
  MOVE('weekend', ['weekend', 'move weekend', 'move to weekend', 'this weekend', 'выходные', 'на выходные', 'перенеси на выходные']),
  MOVE('next_week', ['next week', 'move next week', 'move to next week', 'следующая неделя', 'на следующую неделю', 'перенеси на следующую неделю']),
  { when: () => S.focus?.mode === 'focus', name: 'focus_done', say: ['готово', 'сделано', 'сделал', 'сделала', 'done', 'finished'] },
  { when: () => S.focus?.mode === 'inbox' && currentTask(), name: 'complete', say: ['готово', 'сделано', 'сделал', 'done'] },
  { when: () => S.focus?.mode === 'focus', name: 'step_done', say: ['шаг готов', 'отметь шаг', 'следующий шаг', 'step done', 'next step'] },
  { when: () => S.focus, name: 'focus_skip', say: ['скип', 'скиб', 'skip', 'пропусти', 'пропустить', 'дальше', 'следующая', 'следующий', 'next'] },
  { when: () => S.focus, name: 'focus_exit', say: ['выйди', 'выйти', 'выход', 'хватит', 'стоп', 'exit', 'stop'] },
  { when: () => S.focus?.mode === 'review', name: 'accept_close', say: ['принять и закрыть', 'принимаю и закрываю', 'accept and close', 'accept and complete'] },
  { when: () => S.focus?.mode === 'review', name: 'accept', say: ['принять', 'принимаю', 'принято', 'ок', 'окей', 'accept', 'approve'] },
  { when: () => currentItem(), name: 'item_archive', say: ['в архив', 'архив', 'архивируй', 'archive'] },
  { when: () => currentItem(), name: 'item_trash', say: ['удали', 'удалить', 'в мусор', 'мусор', 'trash', 'delete'] },
  { when: () => currentItem(), name: 'item_to_task', say: ['в задачу', 'задачей', 'сделай задачей', 'make task'] },
  { when: () => currentItem(), name: 'item_to_agent', say: ['агенту', 'отдай агенту', 'to agent'] },
  { when: () => S.focus?.mode === 'focus', name: 'pomodoro_pause', say: ['пауза', 'pause'] },
  { when: () => S.focus?.mode === 'focus', name: 'pomodoro_start', say: ['старт', 'таймер', 'запусти таймер', 'start', 'start timer'] },
  { when: () => S.focus?.mode === 'focus', name: 'why', say: ['почему', 'почему эта', 'why', 'why this one'] },
  { when: () => S.focus?.mode === 'focus', name: 'breakdown', say: ['разбей', 'разбей на шаги', 'break down', 'break it down'] },
  { when: () => !S.focus, name: 'focus', say: ['фокус', 'focus'] },
  { when: () => !S.focus, name: 'process_inbox', say: ['разбери инбокс', 'инбокс', 'inbox', 'process inbox', 'разбери inbox'] },
  { when: () => !S.focus, name: 'review_agents', say: ['что сдали агенты', 'ревью агентов', 'review agents'] },
  { when: () => !S.focus, name: 'reschedule_overdue', say: ['перенеси просроченные', 'перенеси просроченные на сегодня', 'reschedule', 'reschedule overdue'] },
];
// Whisper mixes alphabets on short words ("Fокус", "Fokus", "Скиб"): compare in a Latin transliteration and allow
// one typo on longer words, so what you said still hits the fast path.
const LAT = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'i',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sh',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
const latin = (s) => s.replace(/[а-яё]/g, (ch) => LAT[ch] ?? ch).replace(/c(?!h)/g, 'k').replace(/ph/g, 'f');
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const sameCommand = (heard, phrase) => {
  if (heard === phrase) return true;
  const a = latin(heard), b = latin(phrase);
  return a === b || (b.length >= 5 && lev(a, b) <= 1);
};
// Words that refer to "the thing on screen" or are politeness — dropped before matching ("move it to tomorrow").
const FILLERS = new Set(['it', 'this', 'that', 'the', 'task', 'please', 'это', 'эту', 'этот', 'её', 'ее', 'его', 'задачу', 'задача', 'пожалуйста', 'ну', 'давай']);
const STEM = { moving: 'move', moved: 'move', skipping: 'skip', dropping: 'drop' };
const SEARCH_PREFIX = /^(найди|найти|поиск|ищи|поищи|search|search for|find|look up)\s+(.+)$/;
function fastCommand(text) {
  const n0 = normSpeech(text);
  const sp = n0.match(SEARCH_PREFIX);
  if (sp) return { name: 'search', text: sp[2], fast: true };
  const ap = n0.match(/^(спроси агента|спроси|ask the agent|ask agent|ask)\s+(.+)$/);
  if (ap) return { name: 'ask', text: ap[2], fast: true };
  if (!n0 || n0.split(' ').length > 7) return null;
  const n1 = n0.split(' ').map((w) => STEM[w] || w).filter((w) => !FILLERS.has(w)).join(' ');
  const cands = [...new Set([n0, n1])].filter(Boolean);
  const hit = FAST_COMMANDS.find((c) => c.when() && c.say.some((p) => cands.some((n) => sameCommand(n, p))));
  return hit ? { name: hit.name, due: hit.due?.() || null, fast: true } : null;
}
// Whisper sometimes "hears" stock phrases in near-silence.
function isHallucination(text) {
  const n = normSpeech(text);
  return /^(продолжение следует|субтитры|спасибо за просмотр|thank you for watching|thanks for watching)/.test(n) || n === 'you';
}


// ---------- quick date moves: today / tomorrow / weekend / next week ----------
function quickDate(kind) {
  const d = fromIso(S.data.today), dow = d.getDay();
  const add = (n) => iso(new Date(d.getTime() + n * 864e5));
  if (kind === 'today') return add(0);
  if (kind === 'tomorrow') return add(1);
  if (kind === 'weekend') return dow === 6 || dow === 0 ? add(0) : add(6 - dow); // this Saturday (today if already weekend)
  return add(((8 - dow) % 7) || 7); // next Monday
}
// Re-date the task you're looking at: focus task, inbox task, review task or the one open in the drawer.
async function moveCurrent(due) {
  if (!due) return toast('Which date?');
  if (S.focus?.mode === 'inbox' && currentTask()) return triage({ due }, dateLabel(due)[0]);
  const id = S.focus && !currentItem() ? S.focus.id : S.openId;
  const t = id && taskById(id);
  if (!t) return toast('Which task? Open one or use focus');
  const old = t.due;
  await patch(t.id, { due });
  toast(`“${t.title.slice(0, 36)}” → ${dateLabel(due)[0]}`, 'Undo', async () => {
    await patch(t.id, { due: old });
    if (S.focus && S.focus.mode !== 'inbox') { S.focus.skipped = S.focus.skipped.filter((x) => x !== t.id); S.focus.id = t.id; saveFocus(); }
    load();
  }, GRACE_MS);
  // Moved off today while focusing → it's not today's work anymore, go to the next one.
  if (S.focus && S.focus.mode !== 'inbox' && due > S.data.today) { S.focus.skipped.push(t.id); nextFocus(); }
  load();
}


// Drop the task you're looking at (or a given one) and, in a one-at-a-time mode, move on.
function dropCurrent(id = null) {
  const target = id || (S.focus && !currentItem() && S.focus.mode !== 'review' ? S.focus.id : S.openId);
  if (!target) return toast('Which task? Open one first');
  dropTask(target);
  if (S.focus && S.focus.id === target) nextFocus(target);
}


// ---------- time-blocking in the calendar: the Mac's or Google's (always confirmed) ----------
const nowLocal = () => { const d = new Date(); return `${iso(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const addMin = (loc, m) => { const d = new Date(`${loc}:00`); d.setMinutes(d.getMinutes() + m); return `${iso(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const tbLabel = (b) => `${dateLabel(b.start.slice(0, 10))[0]} ${b.start.slice(11)}–${b.end.slice(11)}`;

async function timeblockModal(t, preset = {}) {
  if (!t) return toast('Which task? Open one first');
  const st = await api('GET', '/api/gcal/status');
  const shell = (inner) => { $('#modal').innerHTML = `<div class="overlay" data-act="qa-close"><div class="qa tb"><div class="bd-h">⏱ Block time · ${st.source === 'macos' ? 'Calendar' : 'Google Calendar'}</div><div class="bd-t">${inline(t.title)}</div><div id="tb-body">${inner}</div></div></div>`; };
  if (!st.connected) {
    if (st.source === 'macos') return shell(`<p class="tb-setup">${MAC_CAL_NOTE[st.macAccess] || 'Your calendar isn’t reachable right now.'}</p><p class="tb-setup">Settings → Calendar.</p><div class="foot"><span class="sp"></span><button class="btn" data-act="qa-close">Close</button></div>`);
    return shell(`<p class="tb-setup">Google Calendar isn't connected yet.</p>
      <ol class="tb-setup"><li>${st.configured ? '✓ OAuth client found.' : `Put the Google OAuth client JSON at <code>${esc(st.setupFile)}</code> (see README).`}</li>
      <li>On the Mac, open <code>http://127.0.0.1:4747/api/gcal/connect</code> and allow access.</li></ol>
      <div class="foot"><span class="sp"></span><button class="btn" data-act="qa-close">Close</button></div>`);
  }
  const open = t.subtasks.filter((x) => !x.done);
  let what = null, minutes = preset.minutes || 50, slots = null, custom = preset.start || '';
  const draw = (confirm = null) => {
    if (confirm) {
      const label = what === null ? t.title : `${t.subtasks.find((x) => x.i === what).text} — ${t.title}`;
      $('#tb-body').innerHTML = `<div class="tb-confirm"><div class="tb-when">${tbLabel(confirm)}</div><div>Create <b>⏱ ${esc(label)}</b> in your calendar?</div></div>
        <div class="foot"><span class="sp"></span><button class="btn" data-tb="back">Back</button><button class="btn primary" data-tb="create">Create event</button></div>`;
      $('#tb-body').dataset.start = confirm.start; $('#tb-body').dataset.end = confirm.end;
      return;
    }
    $('#tb-body').innerHTML = `
      ${open.length ? `<div class="tri"><div class="lbl">What</div><select id="tb-what" class="pm-select"><option value="">Whole task</option>${open.map((x) => `<option value="${x.i}" ${what === x.i ? 'selected' : ''}>${esc(x.text.slice(0, 60))}</option>`).join('')}</select></div>` : ''}
      <div class="tri"><div class="lbl">Duration</div><div class="chips">${[25, 50, 90, 120].map((m) => `<button class="chip ${m === minutes ? 'on' : ''}" data-min="${m}">${m < 60 ? `${m} min` : `${m / 60} h`.replace('1.5 h', '1½ h')}</button>`).join('')}</div></div>
      <div class="tri"><div class="lbl">Free slots</div><div class="tb-slots">${slots === null ? '<div class="vstatus"><span class="spin"></span>Checking your calendar…</div>'
        : slots.length ? slots.map((x, k) => `<button class="tb-slot" data-slot="${k}">${tbLabel(x)}</button>`).join('') : '<div class="empty">No free slot in working hours this week.</div>'}</div></div>
      <div class="tri"><div class="lbl">Or pick a time</div><div class="two"><input type="datetime-local" id="tb-custom" class="pm-select" value="${esc(custom)}" step="900"><button class="btn" data-tb="custom">Use</button></div></div>
      <div class="foot"><span class="sp">Nothing is created until you confirm.</span><button class="btn" data-act="qa-close">Cancel</button></div>`;
  };
  const loadSlots = async () => {
    slots = null; draw();
    try { slots = await api('POST', '/api/gcal/slots', { minutes }); } catch { slots = []; }
    if ($('#tb-body') && !$('.tb-confirm')) draw();
  };
  shell('');
  if (custom) { draw({ start: custom, end: addMin(custom, minutes) }); } else loadSlots();
  $('#tb-body').onclick = async (e) => {
    const b = e.target.closest('[data-min], [data-slot], [data-tb]');
    if (!b) return;
    if (b.dataset.min) { minutes = +b.dataset.min; return loadSlots(); }
    if (b.dataset.slot) return draw(slots[+b.dataset.slot]);
    if (b.dataset.tb === 'custom') { custom = $('#tb-custom').value; if (!custom) return; return draw({ start: custom, end: addMin(custom, minutes) }); }
    if (b.dataset.tb === 'back') return custom && !slots ? loadSlots() : draw();
    if (b.dataset.tb === 'create') {
      b.disabled = true; b.textContent = 'Creating…';
      const { start, end } = $('#tb-body').dataset;
      try {
        const r = await api('POST', `/api/tasks/${t.id}/timeblock`, { start, end, subtask: what });
        closeModal();
        toast(`Blocked ${tbLabel(r.event)}`, 'Undo', async () => { await api('DELETE', `/api/tasks/${t.id}/timeblock/${encodeURIComponent(r.event.id)}`); S.planInfoAt = 0; load(); }, GRACE_MS);
        S.planInfoAt = 0; await load(); if (S.openId === t.id) renderDrawer(true);
      } catch { b.disabled = false; b.textContent = 'Create event'; }
    }
  };
  $('#tb-body').onchange = (e) => { if (e.target.id === 'tb-what') what = e.target.value === '' ? null : +e.target.value; };
}


// ---------- email: the agent drafts, the owner edits and sends (nothing leaves without this card) ----------
async function emailModal(a) {
  const st = await api('GET', '/api/gcal/status');
  const shell = (inner) => { $('#modal').innerHTML = `<div class="overlay" data-act="qa-close"><div class="qa em"><div class="bd-h">✉ ${a.threadId ? 'Reply' : 'New email'} · Gmail</div>${inner}</div></div>`; };
  if (!st.gmail) {
    return shell(`<p class="tb-setup">Gmail isn't connected yet. On the Mac, open <code>http://127.0.0.1:4747/api/gcal/connect</code>
      and allow Calendar + Gmail (one time).</p><div class="foot"><span class="sp"></span><button class="btn" data-act="qa-close">Close</button></div>`);
  }
  shell(`<div class="em-f"><label>To</label><input id="em-to" value="${esc(a.to || '')}" autocomplete="off"></div>
    <div class="em-f"><label>Cc</label><input id="em-cc" value="${esc(a.cc || '')}" autocomplete="off"></div>
    <div class="em-f"><label>Subject</label><input id="em-subj" value="${esc(a.subject || '')}" placeholder="${a.threadId ? 'Re: (from the thread)' : ''}"></div>
    <textarea id="em-body" rows="10">${esc(a.body || '')}</textarea>
    <div class="foot"><span class="sp">Nothing is sent until you tap Send.</span><button class="btn" data-act="qa-close">Cancel</button>
      <button class="btn" data-em="draft">Save draft</button><button class="btn primary" data-em="send">Send</button></div>`);
  const box = $('.qa.em');
  box.onclick = async (e) => {
    const b = e.target.closest('[data-em]');
    if (!b) return;
    const msg = { to: $('#em-to').value.trim(), cc: $('#em-cc').value.trim(), subject: $('#em-subj').value.trim(), body: $('#em-body').value, threadId: a.threadId || null, taskId: a.taskId || null };
    if (!msg.to || !msg.body.trim()) return toast('To and text are required');
    Object.assign(a, msg);
    $$('[data-em]', box).forEach((x) => { x.disabled = true; });
    b.textContent = b.dataset.em === 'send' ? 'Sending…' : 'Saving…';
    try {
      const r = await api('POST', `/api/gmail/${b.dataset.em}`, msg);
      a.done = true; closeModal();
      toast(b.dataset.em === 'send' ? `Sent to ${msg.to.slice(0, 40)}` : 'Draft saved in Gmail', 'Open', () => window.open(r.link, '_blank'));
      if (S.chat?.open) renderChat();
      await load(); if (S.openId) renderDrawer(true);
    } catch { $$('[data-em]', box).forEach((x) => { x.disabled = false; }); b.textContent = b.dataset.em === 'send' ? 'Send' : 'Save draft'; }
  };
}

// ---------- global search: open tasks + projects, jump from the results ----------
function searchResults(q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return { projects: [], tasks: [] };
  // Results from "search by meaning" for exactly this query take over when present.
  if (S.semantic?.q === q) {
    return { projects: S.semantic.projects.map(proj).filter(Boolean), tasks: S.semantic.tasks.map(taskById).filter((t) => t && open(t)), semantic: true };
  }
  const has = (txt) => words.every((w) => txt.includes(w));
  const projects = S.data.projects.filter((p) => p.status === 'active' && has(`${p.title} ${p.slug}`.toLowerCase())).slice(0, 5);
  const tasks = S.data.tasks.filter((t) => open(t) && !pendingDone.has(t.id)).map((t) => {
    const title = t.title.toLowerCase();
    const hay = `${title} ${t.body.toLowerCase()} ${t.labels.join(' ').toLowerCase()} ${(proj(t.project)?.title || t.project || '').toLowerCase()}`;
    if (!has(hay)) return null;
    const score = has(title) ? (title.startsWith(words[0]) ? 0 : 1) : 2; // title hits first, then notes/labels/project
    return { t, score };
  }).filter(Boolean).sort((a, b) => a.score - b.score || byPri(a.t, b.t)).slice(0, 25).map((x) => x.t);
  return { projects, tasks };
}
function markHits(text, q) {
  let h = esc(text);
  for (const w of q.split(/\s+/).filter((x) => x.length > 1)) h = h.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'), '<mark>$1</mark>');
  return h;
}
function renderSearch() {
  const box = $('#search-res');
  if (!box) return;
  const q = (S.q || '').trim();
  if (!q) { box.hidden = true; box.innerHTML = ''; return; }
  const { projects, tasks, semantic } = searchResults(q);
  S.searchItems = [...projects.map((p) => ({ kind: 'p', id: p.slug })), ...tasks.map((t) => ({ kind: 't', id: t.id }))];
  S.searchSel = Math.min(S.searchSel || 0, Math.max(0, S.searchItems.length - 1));
  let k = 0;
  const item = (html, kind, id) => `<button class="sr-item ${k++ === S.searchSel ? 'on' : ''}" data-act="sr-go" data-kind="${kind}" data-id="${esc(id)}">${html}</button>`;
  box.hidden = false;
  box.innerHTML = S.semantic?.q === q && S.semantic.loading ? '<div class="vstatus sr-wait"><span class="spin"></span>Searching by meaning…</div>'
    : !S.searchItems.length ? `<div class="empty">No open tasks or projects match.</div>${S.semantic?.q === q ? '' : '<button class="linkbtn sr-sem" data-act="sr-semantic">✦ Search by meaning</button>'}`
    : `${projects.length ? `<div class="sr-h">Projects</div>${projects.map((p) => item(`<span class="dot cat-${p.category || 'none'}"></span><span class="sr-t">${markHits(p.title, q)}</span>`, 'p', p.slug)).join('')}` : ''}
       ${semantic ? '<div class="sr-h sr-note">✦ matched by meaning</div>' : ''}
       ${tasks.length ? `<div class="sr-h">Tasks <span class="c">${tasks.length}</span></div>${tasks.map((t) => {
         const bits = [];
         if (t.project) bits.push(`# ${esc(proj(t.project)?.title || t.project)}`);
         if (t.due) { const [l, c] = dateLabel(t.due); bits.push(`<span class="${c}">◷ ${l}</span>`); }
         if (t.assigned === 'agent') bits.push('<span class="pill agent">✦</span>');
         return item(`<span class="check sm p-${t.priority}"></span><span class="sr-body"><span class="sr-t">${markHits(t.title, q)}</span>${bits.length ? `<span class="sr-m">${bits.join(' · ')}</span>` : ''}</span>`, 't', t.id);
       }).join('')}` : ''}`;
  box.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  if (matchMedia('(max-width: 800px)').matches) box.style.top = `${$('#search').getBoundingClientRect().bottom + 6}px`; // right under the box
}
function searchGo(kind, id) {
  S.q = ''; S.searchSel = 0;
  $('#search')?.blur();
  if (kind === 'p') { location.hash = `#/project/${id}`; return; }
  S.editingBody = false; S.openId = id; render();
}
// results are chosen with mousedown so the input's blur doesn't close the list first
async function semanticSearch(q) {
  S.semantic = { q, loading: true, projects: [], tasks: [] };
  renderSearch();
  try {
    const r = await api('POST', '/api/search/semantic', { q });
    if (S.semantic?.q === q) S.semantic = { q, loading: false, ...r };
  } catch { S.semantic = { q, loading: false, projects: [], tasks: [] }; }
  if ((S.q || '').trim() === q) renderSearch();
}
document.addEventListener('mousedown', (e) => {
  if (e.target.closest('[data-act="sr-semantic"]')) { e.preventDefault(); return semanticSearch((S.q || '').trim()); }
  const b = e.target.closest('[data-act="sr-go"]');
  if (b) { e.preventDefault(); return searchGo(b.dataset.kind, b.dataset.id); }
  if (!e.target.closest('.search-wrap, #mic')) { // tapping elsewhere ends the search
    const box = $('#search-res');
    if (box && !box.hidden) { box.hidden = true; S.q = ''; S.semantic = null; const i = $('#search'); if (i) i.value = ''; }
  }
}, true);
document.addEventListener('focusin', (e) => { if (e.target.id === 'search' && S.q) renderSearch(); });
document.addEventListener('keydown', (e) => {
  if (e.target.id !== 'search') return;
  const n = (S.searchItems || []).length;
  if (e.key === 'ArrowDown' && n) { e.preventDefault(); S.searchSel = (S.searchSel + 1) % n; renderSearch(); }
  else if (e.key === 'ArrowUp' && n) { e.preventDefault(); S.searchSel = (S.searchSel - 1 + n) % n; renderSearch(); }
  else if (e.key === 'Enter' && n) { e.preventDefault(); const it = S.searchItems[S.searchSel]; searchGo(it.kind, it.id); }
  else if (e.key === 'Escape') { e.stopPropagation(); S.q = ''; e.target.value = ''; renderSearch(); e.target.blur(); }
}, true);


// Voice "найди X" / "search X": show the search results for X on the current screen.
function voiceSearch(text) {
  if (!text.trim()) return toast('Search for what?');
  if (S.focus) exitFocus();
  S.openId = null;
  render();
  S.q = text.trim(); S.searchSel = 0;
  const box = $('#search'); if (box) box.value = S.q;
  renderSearch();
  if (!(S.searchItems || []).length) semanticSearch(S.q); // spoken words often differ from the task's language
}


// ---------- pomodoro statistics (server: 50_reviews/pomodoros.csv) ----------
S.pomoStats = null;
async function loadPomoStats() {
  S.pomoStatsDay = iso(new Date());
  try { S.pomoStats = await api('GET', '/api/pomodoros'); } catch { /* offline */ }
}
async function recordPomodoro(p) {
  try {
    const r = await fetch('/api/pomodoros', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p), keepalive: true });
    if (r.ok) S.pomoStats = await r.json();
  } catch { clog('pomodoro log failed'); }
  renderMain(); pomoTick();
}
loadPomoStats().then(() => { renderMain(); pomoTick(); });


// ---------- Ask: a light chat with the agent about what's on screen ----------
// One conversation per context (task / project / view). Read-only agent; its proposals are buttons you tap.
function chatContext() {
  if (S.chatPin && S.chat?.key === S.chatPin) return S.chat; // opened for one thing (a decision) until closed
  if (S.chat?.key?.startsWith('i:') && S.data.inbox.some((x) => `i:${x.id}` === S.chat.key)) return S.chat;
  if (currentItem()) { const it = currentItem(); return { key: `i:${it.id}`, context: { itemId: it.id }, label: `✎ ${it.title}` }; }
  if (S.focus?.id && !currentItem()) { const t = taskById(S.focus.id); if (t) return { key: `t:${t.id}`, context: { taskId: t.id }, label: t.title }; }
  if (S.openId) { const t = taskById(S.openId); if (t) return { key: `t:${t.id}`, context: { taskId: t.id }, label: t.title }; }
  if (S.view === 'project' && S.arg) return { key: `p:${S.arg}`, context: { project: S.arg }, label: `# ${proj(S.arg)?.title || S.arg}` };
  return { key: `v:${S.view}`, context: { view: S.view }, label: VIEWS[S.view]?.title || 'Today' };
}
// ✦ / "c" / voice "спроси агента": with a task open, talk in that task's chat (one conversation per task).
function askHere(text = '') {
  const box = !S.focus && S.openId && taskById(S.openId) ? $('#tc-in') : null;
  if (box) {
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (text) { box.value = text; return taskChatSend(); }
    return box.focus();
  }
  openChat();
  if (text) chatSend(text);
}
function openChat() {
  const c = chatContext();
  if (!S.chat || S.chat.key !== c.key) S.chat = { ...c, session: null, msgs: [], busy: false, deep: S.chat?.deep || false };
  S.chat.open = true;
  fitChat();
  document.body.classList.add('chat-on');
  renderChat();
  chatDiag('open');
  if (!matchMedia('(max-width: 800px)').matches) $('#chat-in')?.focus();
}
function closeChat() {
  if (S.chat) S.chat.open = false;
  S.chatPin = null;
  document.body.classList.remove('chat-on');
  const el = $('#chat'); if (el) el.hidden = true;
}
function chatGeneral() { // drop the task/project context → a general conversation about today
  S.chat = { key: 'v:general', context: { view: 'today' }, label: 'Everything', session: null, msgs: [], busy: false, deep: S.chat?.deep, open: true };
  renderChat();
}
function actionLabel(a) {
  const d = a.date ? dateLabel(a.date)[0] : '';
  return { add_subtasks: `+ ${a.items.length} step${a.items.length === 1 ? '' : 's'}`, set_due: `◷ Due → ${d}`, set_deadline: `⚑ Deadline → ${d}`,
    create_task: `+ Task: ${(a.text || '').slice(0, 40)}${d ? ` · ${d}` : ''}`, add_note: '✎ Add as note',
    timeblock: `⏱ Block ${a.start ? `${d} ${a.start.slice(11)}` : 'time'}`, open_task: 'Open task',
    run: `▶ Do it: ${(a.text || '').replace(/\s+/g, ' ').slice(0, 48)}${(a.text || '').length > 48 ? '…' : ''}`, drop_decision: '✕ Not a decision', decision_to: `→ Make it a ${a.text || 'task'}`,
    email: `✉ ${a.threadId ? 'Reply' : 'Email'} to ${(a.to || '').replace(/<.*>/, '').trim().slice(0, 28) || '…'}`, link_email: `✉ Link “${(a.subject || 'email').slice(0, 30)}”`,
    set_woop: Object.entries(a.woop || {}).map(([k, v]) => `↯ ${k[0].toUpperCase()}${k.slice(1)}: ${v.length > 60 ? `${v.slice(0, 59)}…` : v}`).join(' · ') }[a.type] || a.type;
}
function renderChat() {
  const el = $('#chat');
  if (!S.chat?.open) { el.hidden = true; return; }
  el.hidden = false;
  const C = S.chat;
  const scroller = $('.chat-msgs', el);
  const atBottom = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
  el.innerHTML = `<div class="chat-h"><span class="chat-title">✦ Ask</span>
      <span class="chat-ctx" title="Context: the agent sees this">${esc(C.label.slice(0, 48))}${C.key !== 'v:general' ? '<button class="chat-ctx-x" data-act="chat-general" aria-label="Drop context">✕</button>' : ''}</span>
      <span class="sp"></span>
      <button class="chat-deep ${C.deep ? 'on' : ''}" data-act="chat-deep" title="Think deeper (a stronger model, slower)">${C.deep ? 'Deep' : 'Fast'}</button>
      ${iconBtn('chat-close', 'close', 'Close (Esc)')}</div>
    <div class="chat-msgs">${C.msgs.length ? '' : `<div class="chat-empty"><div class="chat-sugg">${(C.key.startsWith('d:') ? ['What would you choose and why?', 'What am I missing?', 'What happens if I wait?']
      : C.key.startsWith('i:') ? ['What is this — task, project or reference?', 'What is the next action?', 'Make it a task']
      : C.key.startsWith('t:') ? ['What should I do next here?', 'What is blocking this?', 'Break it into steps']
      : C.key.startsWith('p:') ? ['Where does this project stand?', 'What is blocking it?', 'Plan my next week here']
      : ['What matters most today?', 'What is overdue and why?', 'What can an agent take over?']).map((q) => `<button class="chip" data-act="chat-suggest">${q}</button>`).join('')}</div>
      <p>Or hold the mic and speak.</p></div>`}
      ${C.msgs.map((m, i) => m.role === 'user' ? userBubble(m.text, m.atts)
        : `<div class="msg ai"><div class="md">${md(m.text, false)}</div>
            ${m.actions?.length ? `<div class="msg-acts">${m.actions.map((a, k) => `<button class="chip act ${a.done ? 'done' : ''}" data-act="chat-action" data-m="${i}" data-k="${k}" ${a.done ? 'disabled' : ''}>${a.done ? '✓ ' : ''}${esc(actionLabel(a))}</button>`).join('')}</div>` : ''}
            ${C.key.startsWith('t:') || C.key.startsWith('p:') ? `<button class="linkbtn msg-save" data-act="chat-save" data-m="${i}" ${m.saved ? 'disabled' : ''}>${m.saved ? '✓ Saved' : `Save to ${C.key.startsWith('t:') ? 'task' : 'project'}`}</button>` : ''}
          </div>`).join('')}
      ${C.busy ? '<div class="msg ai typing"><span></span><span></span><span></span></div>' : ''}</div>
    ${composerHtml('ask', `Ask about ${C.key.startsWith('t:') ? 'this task' : C.key.startsWith('p:') ? 'this project' : 'your tasks'}…`, C.draft || '', C.busy)}`;
  const sc = $('.chat-msgs', el);
  if (atBottom) sc.scrollTop = sc.scrollHeight;
  const ta = $('#chat-in'); autosize(ta);
}
async function chatSend(text) {
  const C = S.chat;
  if (!C?.open) openChat();
  const msg = String(text || '').trim();
  const pending = takePending('ask');
  if (!msg && !pending.length) return;
  if (S.chat.busy) return toast('Still thinking — one moment');
  S.chat.msgs.push({ role: 'user', text: msg, atts: pending.map((p) => ({ name: p.file.name, url: p.url, image: p.image })) });
  S.chat.busy = true; S.chat.draft = '';
  renderChat();
  let attachments = [];
  try {
    attachments = await uploadAll(pending, S.chat.context);
    // Files without a question, in a task/project context: just attach them there.
    if (!msg && (S.chat.context.taskId || S.chat.context.project)) {
      S.chat.msgs.push({ role: 'ai', text: `Attached ${attachments.length} file${attachments.length === 1 ? '' : 's'} to the ${S.chat.context.taskId ? 'task' : 'project'}.` });
      S.chat.busy = false; renderChat(); load(); return;
    }
    // AICODE-NOTE: a request cut mid-way (server restart, Tailscale hiccup) may never settle — cap it, so the chat can't get stuck.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 100000);
    const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl.signal,
      body: JSON.stringify({ message: msg, context: S.chat.context, session: S.chat.session, deep: S.chat.deep, attachments }) }).finally(() => clearTimeout(timer));
    const r = await res.json();
    if (!res.ok) throw new Error(r.error || `error ${res.status}`);
    S.chat.session = r.session;
    S.chat.msgs.push({ role: 'ai', text: r.reply, actions: r.actions });
  } catch (e) {
    clog(`chat error: ${e.name} ${e.message}`);
    S.chat.msgs.push({ role: 'ai', text: `_Couldn't answer: ${e.name === 'AbortError' ? 'timed out, try again' : e.message || 'error'}_` });
  }
  S.chat.busy = false;
  renderChat();
  if (!matchMedia('(max-width: 800px)').matches) $('#chat-in')?.focus();
}
// a task title from a request: its first sentence, cut at a word
function shortTitle(text = '') {
  const s = String(text).trim().split(/(?<=[.!?])\s|\n/)[0].trim() || 'Agent task';
  return s.length <= 80 ? s : `${s.slice(0, 80).replace(/\s+\S*$/, '')}…`;
}
async function chatAction(m, k) {
  await runAgentAction(S.chat.msgs[m].actions[k], S.chat.msgs[m].text);
  renderChat();
}
// Executes one proposed action (from Ask or the task chat) through the normal API.
async function runAgentAction(a, replyText = '') {
  const t = a.taskId && taskById(a.taskId);
  const need = () => { if (!t) throw new Error('task not found'); };
  try {
    if (a.type === 'add_subtasks') { need(); await patch(t.id, { addSubtasks: a.items }); toast(`Added ${a.items.length} steps`); }
    if (a.type === 'set_due' || a.type === 'set_deadline') {
      need(); const f = a.type === 'set_due' ? 'due' : 'deadline'; const old = t[f];
      await patch(t.id, { [f]: a.date });
      toast(`${f === 'due' ? 'Due' : 'Deadline'} → ${dateLabel(a.date)[0]}`, 'Undo', async () => { await patch(t.id, { [f]: old }); load(); }, GRACE_MS);
    }
    if (a.type === 'create_task') {
      const nt = await api('POST', '/api/tasks', { title: a.text, notes: a.notes || '', project: a.project, due: a.date, source: 'agent' });
      const itemId = S.chat?.context?.itemId;
      if (itemId && S.data.inbox.some((x) => x.id === itemId)) await api('POST', `/api/items/${encodeURIComponent(itemId)}/process`, { outcome: 'processed', taskId: nt.id });
      toast(`Created “${nt.title.slice(0, 40)}”`, 'Open', () => { S.openId = nt.id; closeChat(); render(); });
    }
    if (a.type === 'add_note') { need(); await patch(t.id, { addNote: a.text || replyText.slice(0, 500) }); toast('Note added'); }
    if (a.type === 'timeblock') { need(); timeblockModal(t, { start: a.start, minutes: a.minutes }); }
    if (a.type === 'open_task') { need(); S.openId = t.id; if (matchMedia('(max-width: 800px)').matches) closeChat(); render(); }
    if (a.type === 'email') return emailModal(a);
    if (a.type === 'drop_decision' || a.type === 'decision_to') {
      const d = (S.data.decisions || []).find((x) => x.slug === a.decision);
      if (!d) throw new Error('decision already closed');
      if (a.type === 'decision_to') { closeChat(); decisionTo(d, ['task', 'project', 'goal'].includes(a.text) ? a.text : 'task'); return; }
      await api('POST', `/api/decisions/${encodeURIComponent(d.slug)}/drop`, { reason: a.text || '' });
      toast('Not a decision — closed'); closeChat();
    }
    if (a.type === 'run') {
      // no task in context (Ask from Inbox, Today, a project): the work gets a task of its own; an Inbox note becomes it
      let rt = t;
      if (!rt) {
        const itemId = S.chat?.context?.itemId, it = itemId && S.data.inbox.find((x) => x.id === itemId);
        rt = await api('POST', '/api/tasks', { title: it?.title || shortTitle(a.text), notes: a.text || '', project: a.project, assigned: 'agent', source: 'agent' });
        if (it) await api('POST', `/api/items/${encodeURIComponent(itemId)}/process`, { outcome: 'processed', taskId: rt.id });
      }
      await startRun(rt.id, a.text); toast('Agent started — progress is in the task chat');
      if (S.openId !== rt.id) { S.openId = rt.id; if (matchMedia('(max-width: 800px)').matches) closeChat(); render(); }
    }
    if (a.type === 'link_email') { need(); await api('POST', `/api/tasks/${t.id}/mail`, { threadId: a.threadId, subject: a.subject }); toast('Linked to the task'); }
    if (a.type === 'set_woop') { need(); await patch(t.id, { woop: a.woop }); toast(`WOOP: ${Object.keys(a.woop).join(', ')} saved`); }
    if (a.type !== 'timeblock' && a.type !== 'open_task') a.done = true;
    await load();
  } catch (e) { toast(e.message || 'Failed'); }
}
async function chatSave(m) {
  const C = S.chat, msg = C.msgs[m];
  const text = msg.text.replace(/\s+/g, ' ').slice(0, 800);
  if (C.context.taskId) await patch(C.context.taskId, { addNote: `✦ ${text}` });
  else if (C.context.project) await api('POST', `/api/projects/${encodeURIComponent(C.context.project)}/note`, { text: `✦ ${text}` });
  msg.saved = true; toast('Saved'); renderChat();
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('#chat [data-act]');
  if (!b) return;
  e.stopPropagation();
  const act = b.dataset.act;
  if (act === 'chat-close') return closeChat();
  if (act === 'chat-general') return chatGeneral();
  if (act === 'chat-deep') { S.chat.deep = !S.chat.deep; return renderChat(); }
  if (act === 'chat-send') { const v = $('#chat-in').value; return chatSend(v); }
  if (act === 'chat-suggest') return chatSend(b.textContent);
  if (act === 'chat-action') return chatAction(+b.dataset.m, +b.dataset.k);
  if (act === 'chat-save') return chatSave(+b.dataset.m);
}, true);
document.addEventListener('keydown', (e) => {
  if (e.target.id !== 'chat-in') return;
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); chatSend(e.target.value); }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'chat-in') { S.chat.draft = e.target.value; autosize(e.target); }
  if (e.target.id === 'chat-in' || e.target.id === 'tc-in') {
    const kind = e.target.id === 'chat-in' ? 'ask' : 'task';
    const has = !!e.target.value.trim() || S.pendingAtt[kind].length > 0;
    setGo(e.target.parentElement.querySelector('.chat-go'), has);
    const m = e.target.parentElement.querySelector('.cp-mic'); if (m) m.hidden = !has;
  }
});
// AICODE-NOTE (iOS): fixed elements live in the layout viewport, the keyboard shrinks the visual one. On phones the
// chat is sized to the visual viewport itself, so the input always sits right above the keyboard.
function fitChat() {
  const vv = window.visualViewport;
  if (!vv) return;
  document.documentElement.style.setProperty('--vvh', `${vv.height}px`);
  document.documentElement.style.setProperty('--vvtop', `${vv.offsetTop}px`);
}
window.visualViewport?.addEventListener('resize', fitChat);
window.visualViewport?.addEventListener('scroll', fitChat);

// Layout diagnostics from the phone → server.log (to debug iOS viewport issues without a cable).
function chatDiag(when) {
  const vv = window.visualViewport, c = $('#chat')?.getBoundingClientRect(), i = $('#chat-in')?.getBoundingClientRect();
  const f = (r) => (r ? `${Math.round(r.top)}..${Math.round(r.bottom)}` : '-');
  clog(`chat ${when}: vv ${Math.round(vv?.width)}x${Math.round(vv?.height)}@${Math.round(vv?.offsetTop)} inner ${innerWidth}x${innerHeight} chat ${f(c)} input ${f(i)} busy ${!!S.chat?.busy} standalone ${!!navigator.standalone}`);
}
document.addEventListener('focusin', (e) => { if (e.target.id === 'chat-in') setTimeout(() => chatDiag('focus'), 600); });


// ---------- task chat (inline in the task card; history in the task's ## Chat) ----------
S.tchat = {}; // taskId → { session, busy, actions, all }
S.chatLang = (() => { try { return localStorage.getItem('chatLang') || null; } catch { return null; } })(); // the language the owner last chatted in
const CHAT_SECTION = /^##\s+Chat\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m;
const LOG_SECTION = /^##\s+Agent log\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m;
const withoutChat = (body) => body.replace(CHAT_SECTION, '').replace(LOG_SECTION, '').replace(/\n{3,}/g, '\n\n');
function sectionEntries(sec, src) {
  return sec.split(/\n(?=- \d{4}-\d{2}-\d{2} )/).map((e) => e.trim()).filter(Boolean).map((e) => {
    const m = e.match(/^- (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) · ([^·]+?) · ([\s\S]*)$/);
    return m ? { src, date: m[1], time: m[2], who: m[3].trim(), text: m[4].replace(/^ {2,4}/gm, '') } : null;
  }).filter(Boolean);
}
// The task's conversation: ## Chat and the agents' ## Agent log, in time order.
function chatEntries(body) {
  const all = [...sectionEntries((body.match(CHAT_SECTION) || [])[1] || '', 'chat'), ...sectionEntries((body.match(LOG_SECTION) || [])[1] || '', 'log')];
  return all.map((e, i) => ({ ...e, i })).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`) || a.i - b.i);
}
function feedBubble(e) {
  // system lines, not messages: the run's own lines, "▶ Do it" (the request is already in the chat above), "Accepted"
  if (e.src === 'log' && e.who === 'app') return /^Run started/.test(e.text) ? '' : `<div class="msg sys">${esc(e.text.replace(/\s+—\s+transcript.*$/, ''))}</div>`;
  if (e.src === 'log' && e.who === ME().id && /^▶ Do it:/.test(e.text)) return `<div class="msg sys run">▶ Handed to the agent: ${esc(e.text.replace(/^▶ Do it:\s*/, '').slice(0, 90))}${e.text.length > 100 ? '…' : ''}</div>`;
  if (e.src === 'log' && e.who === ME().id && /^Accepted/.test(e.text)) return `<div class="msg sys">✓ ${esc(e.text)}</div>`;
  if (e.who === ME().id) return userBubble(e.text);
  return `<div class="msg ai ${e.src === 'log' ? 'log' : ''}">${e.src === 'log' ? `<div class="msg-by">✦ ${esc(e.who)} · report</div>` : ''}<div class="md">${md(e.text, false)}</div></div>`;
}
function taskChatHtml(t) {
  const st = S.tchat[t.id] || {};
  const all = chatEntries(t.body).filter((e) => !(e.src === 'log' && e.who === 'app' && /^Run started/.test(e.text)));
  const shown = st.all ? all : all.slice(-4);
  const bubble = feedBubble;
  const st2 = agentState(t);
  const ph = t.assigned === 'agent' && st2 === 'review' ? 'Feedback or a question…' : t.assigned === 'agent' && st2 === 'blocked' ? 'Answer the agent…' : 'Ask, or ask to do…';
  return `<div class="tchat">
    <div class="body-h"><span>CHAT</span>${all.length > shown.length ? `<button class="btn ghost" data-act="tc-all">show all ${all.length}</button>` : ''}</div>
    ${shown.length ? `<div class="tchat-msgs">${shown.map(bubble).join('')}</div>` : ''}
    ${st.busy ? '<div class="msg ai typing"><span></span><span></span><span></span></div>' : ''}
    ${st.actions?.length ? `<div class="msg-acts">${st.actions.map((a, k) => `<button class="chip act ${a.done ? 'done' : ''}" data-act="tc-action" data-k="${k}" ${a.done ? 'disabled' : ''}>${a.done ? '✓ ' : ''}${esc(actionLabel(a))}</button>`).join('')}</div>` : ''}
    ${agentStrip(t)}
    ${composerHtml('task', ph, st.draft || '', st.busy)}
  </div>`;
}
async function taskChatSend(opts = {}) {
  const id = S.openId, box = $('#tc-in');
  const msg = (opts.message || box?.value || '').trim();
  const pending = opts.message ? [] : takePending('task');
  if (/[а-яё]/i.test(msg)) S.chatLang = 'ru'; else if (msg.length > 12) S.chatLang = 'en';
  try { localStorage.setItem('chatLang', S.chatLang || ''); } catch { /* private mode */ }
  if (!id || (!msg && !pending.length)) return;
  const st = (S.tchat[id] = S.tchat[id] || {});
  if (st.busy) return toast('Still thinking — one moment');
  st.draft = '';
  let attachments = [];
  if (pending.length) {
    try { attachments = await uploadAll(pending, { taskId: id }); }
    catch (e) { return toast(`Upload failed: ${e.message}`); }
    if (!msg) { if (box) box.value = ''; toast(`Attached ${attachments.length} file${attachments.length === 1 ? '' : 's'}`); await load(); return renderDrawer(true); }
  }
  st.busy = true; st.actions = [];
  // show the question immediately (it's written to the file together with the answer)
  const t = taskById(id);
  const now = new Date(), stamp = `${S.data.today} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (!CHAT_SECTION.test(t.body)) t.body = `${t.body.replace(/\s*$/, '')}\n\n## Chat\n\n- ${stamp} · ${ME().id} · ${msg}\n`;
  else t.body = t.body.replace(CHAT_SECTION, (m0) => `${m0.replace(/\s*$/, '')}\n- ${stamp} · ${ME().id} · ${msg}\n`);
  if (box && !opts.message) box.value = '';
  renderDrawer(true);
  try {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 100000);
    const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl.signal,
      body: JSON.stringify({ message: msg, context: { taskId: id, ...(opts.woop ? { woop: true } : {}) }, session: st.session || null, persist: true, attachments }) }).finally(() => clearTimeout(timer));
    const r = await res.json();
    if (!res.ok) throw new Error(r.error || `error ${res.status}`);
    st.session = r.session; st.actions = r.actions;
  } catch (e) {
    clog(`task chat error: ${e.name} ${e.message}`);
    toast(e.name === 'AbortError' ? 'The agent timed out — try again' : `Couldn't answer: ${e.message}`);
  }
  st.busy = false;
  await load();
  if (S.openId === id) { renderDrawer(true); if (!matchMedia('(max-width: 800px)').matches) $('#tc-in')?.focus(); }
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('#drawer [data-act="tc-send"], #drawer [data-act="tc-all"], #drawer [data-act="tc-action"]');
  if (!b) return;
  e.stopPropagation();
  const st = (S.tchat[S.openId] = S.tchat[S.openId] || {});
  if (b.dataset.act === 'tc-send') return taskChatSend();
  if (b.dataset.act === 'tc-all') { st.all = true; return renderDrawer(true); }
  if (b.dataset.act === 'tc-action') {
    const a = st.actions[+b.dataset.k];
    await runAgentAction(a);
    // a WOOP option chosen: say so in the chat, and the agent goes on to the next line
    if (a.type === 'set_woop' && a.done) {
      const t = taskById(a.taskId), left = WOOP_FIELDS.some(([k]) => !t?.woop?.[k]);
      if (left && S.openId === a.taskId) return taskChatSend({ message: Object.entries(a.woop).map(([k, v]) => `${k[0].toUpperCase()}${k.slice(1)}: ${v}`).join('\n'), woop: true });
    }
    if (a.type === 'run') st.actions = []; // the run shows in the chat and the agent line; the button would only confuse
    return renderDrawer(true);
  }
}, true);
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'tc-in' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); taskChatSend(); }
});
// WOOP lines: one line each, saved when the field is left
document.addEventListener('change', async (e) => {
  const k = e.target.dataset?.woop, id = S.openId;
  if (!k || !id) return;
  await patch(id, { woop: { [k]: e.target.value } });
  renderMain();
});
document.addEventListener('keydown', (e) => { if (e.target.dataset?.woop && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); e.target.blur(); } });
document.addEventListener('input', (e) => { if (e.target.dataset?.woop) autosize(e.target); });
document.addEventListener('input', (e) => { if (e.target.id === 'tc-in') { autosize(e.target); if (S.openId) (S.tchat[S.openId] = S.tchat[S.openId] || {}).draft = e.target.value; } });
// iOS: once the keyboard is up, bring the inline chat input to the middle of what's still visible.
document.addEventListener('focusin', (e) => { if (e.target.id === 'tc-in') setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 350); });


// One button at the right of every chat input, under the thumb: mic while empty (hold / tap to talk), send once typed.
const SEND_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>';
function goButton(sendAct, hasText, busy) {
  return `<button type="button" class="chat-go ${hasText ? 'send' : 'mic'}" ${hasText ? `data-act="${sendAct}"` : 'data-voice'} data-send="${sendAct}"
    aria-label="${hasText ? 'Send' : 'Hold to talk, or tap and speak'}" ${busy && hasText ? 'disabled' : ''}>${hasText ? SEND_SVG : MIC_SVG}</button>`;
}
function setGo(btn, hasText) {
  if (!btn || btn.classList.contains(hasText ? 'send' : 'mic')) return;
  btn.classList.toggle('send', hasText); btn.classList.toggle('mic', !hasText);
  if (hasText) { btn.removeAttribute('data-voice'); btn.dataset.act = btn.dataset.send; btn.innerHTML = SEND_SVG; btn.setAttribute('aria-label', 'Send'); }
  else { btn.removeAttribute('data-act'); btn.setAttribute('data-voice', ''); btn.innerHTML = MIC_SVG; btn.setAttribute('aria-label', 'Hold to talk, or tap and speak'); }
}


// ---------- composer (ChatGPT-style floating pill) + attachments ----------
// [+] [text] [mic*] [●]  — ● is the mic while empty, send once there's text or a file (then the plain mic shows).
S.pendingAtt = { ask: [], task: [] };
const PLUS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
function composerHtml(kind, placeholder, draft, busy) {
  const id = kind === 'ask' ? 'chat-in' : 'tc-in';
  const pend = S.pendingAtt[kind];
  const has = !!draft.trim() || pend.length > 0;
  return `<div class="composer ${kind}">
    ${pend.length ? `<div class="att-chips">${pend.map((p, i) => `<span class="att-chip">${p.image ? `<img src="${p.url}" alt="">` : '📎'}<span>${esc(p.file.name.slice(0, 24))}</span>
      <button data-act="att-remove" data-kind="${kind}" data-i="${i}" aria-label="Remove">✕</button></span>`).join('')}</div>` : ''}
    <div class="pill">
      <button type="button" class="cp-plus" data-act="attach" data-kind="${kind}" aria-label="Attach photo or file">${PLUS_SVG}</button>
      <textarea id="${id}" rows="1" placeholder="${esc(placeholder)}">${esc(draft)}</textarea>
      <button type="button" class="cp-mic" data-voice aria-label="Hold to talk" ${has ? '' : 'hidden'}>${MIC_SVG}</button>
      ${goButton(kind === 'ask' ? 'chat-send' : 'tc-send', has, busy)}
    </div>
    <input type="file" class="att-input" data-kind="${kind}" multiple hidden accept="image/*,application/pdf,.txt,.md,.csv,.doc,.docx,.xls,.xlsx">
  </div>`;
}
function takePending(kind) { const p = S.pendingAtt[kind]; S.pendingAtt[kind] = []; return p; }
async function uploadAll(pending, context = {}) {
  const out = [];
  for (const p of pending) {
    const q = new URLSearchParams({ name: p.file.name });
    if (context.taskId) q.set('task', context.taskId); else if (context.project) q.set('project', context.project);
    const r = await fetch(`/api/attachments?${q}`, { method: 'POST', headers: { 'Content-Type': p.file.type || 'application/octet-stream' }, body: p.file });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `upload failed (${r.status})`);
    out.push(j);
  }
  return out;
}
function userBubble(text, atts = []) {
  // History lines "📎 [[name]]" come from the task file; fresh messages carry local previews.
  const lines = String(text || '').split('\n');
  const files = lines.filter((l) => /^📎 \[\[.+\]\]$/.test(l.trim())).map((l) => l.trim().slice(5, -2));
  const words = lines.filter((l) => !/^📎 \[\[.+\]\]$/.test(l.trim())).join('\n').trim();
  const thumbs = [...(atts || []).map((a) => (a.image ? `<img class="att-img" src="${a.url}" alt="">` : `<span class="att-file">📎 ${esc(a.name)}</span>`)),
    ...files.map((n) => (/\.(png|jpe?g|gif|webp)$/i.test(n) ? `<img class="att-img" loading="lazy" src="/api/attachment-by-name?name=${encodeURIComponent(n)}" alt="">`
      : `<a class="att-file" href="/api/attachment-by-name?name=${encodeURIComponent(n)}" target="_blank" rel="noopener">📎 ${esc(n)}</a>`))];
  return `<div class="msg me">${thumbs.length ? `<div class="msg-atts">${thumbs.join('')}</div>` : ''}${words ? `<div>${esc(words)}</div>` : ''}</div>`;
}
function refreshComposer(kind) {
  if (kind === 'ask') return renderChat();
  const st = S.tchat[S.openId] = S.tchat[S.openId] || {};
  st.draft = $('#tc-in')?.value || st.draft || '';
  renderDrawer(true);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act="attach"], [data-act="att-remove"]');
  if (!b) return;
  e.stopPropagation(); e.preventDefault();
  const kind = b.dataset.kind;
  if (b.dataset.act === 'attach') return b.closest('.composer').querySelector('.att-input').click();
  const [gone] = S.pendingAtt[kind].splice(+b.dataset.i, 1);
  if (gone?.url) URL.revokeObjectURL(gone.url);
  refreshComposer(kind);
}, true);
document.addEventListener('change', (e) => {
  if (!e.target.matches('.att-input')) return;
  const kind = e.target.dataset.kind;
  for (const f of e.target.files) S.pendingAtt[kind].push({ file: f, image: /^image\//.test(f.type), url: URL.createObjectURL(f) });
  refreshComposer(kind);
});

// While the task-chat pill is on screen, the floating mic would sit on top of its send button — hide the dock then.
let composerObs = null;
function watchTaskComposer() {
  composerObs?.disconnect();
  const el = $('#drawer .tchat .composer');
  document.body.classList.remove('composer-visible');
  if (!el || !window.IntersectionObserver) return;
  composerObs = new IntersectionObserver(([e]) => document.body.classList.toggle('composer-visible', e.isIntersecting), { threshold: 0.1 });
  composerObs.observe(el);
}

// AICODE-NOTE: Settings → Time format (am / pm). Times are built as "HH:MM" all over the app (calendar, blocks, protocols,
// pushes' text), so instead of a formatter at every site the rendered text is rewritten: every "16:30" in a text node
// becomes "4:30pm" (and "19:00" → "7pm") while the setting is 12h. Fields people type in (inputs, textareas) and code are left alone.
const CLOCK_RE = /\b([01]\d|2[0-3]):([0-5]\d)\b(?!\s?[ap]m)/g;
const to12 = (_, h, m) => `${+h % 12 || 12}${m === '00' ? '' : `:${m}`}${+h < 12 ? 'am' : 'pm'}`; // 9am, 4:30pm (as Google Calendar)
function clockTimes(root) {
  if (S.settings?.clock !== '12h' || !root) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement?.closest('textarea, input, code, pre, script, style, #pomo-time, #rec-t, [data-noclock]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  for (let n = root.nodeType === 3 ? root : w.nextNode(); n; n = w.nextNode()) {
    CLOCK_RE.lastIndex = 0;
    if (CLOCK_RE.test(n.data)) n.data = n.data.replace(CLOCK_RE, to12);
    if (root.nodeType === 3) break;
  }
}
new MutationObserver((ms) => { if (S.settings?.clock === '12h') for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 || n.nodeType === 3) clockTimes(n); })
  .observe(document.body, { childList: true, subtree: true });
