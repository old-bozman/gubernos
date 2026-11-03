// The vault-only API: everything that needs just the markdown files — no Claude, Google, push or child processes.
// The Mac server registers these plus its own (server.js); the iOS app runs the same routes in the page over its
// copy of the vault when the Mac is out of reach (gubernos-ios). Handlers: (params, query, body) → JSON-able value.
import * as V from './vault.js';
import * as Wins from './wins.js';
import * as M from './model.js';
import * as Settings from './settings.js';
import * as MacFocus from './macfocus.js';
import * as P from './pomodoros.js';
import { weekly, saveWeekly, focusSuggestions } from './review.js';
import { getReflection, saveReflection } from './reflection.js';
import * as Daily from './daily.js';
import * as H from './habits.js';
import { profile, clientConfig } from './config.js';
import * as DoneToday from './done-today.js';

// stateExtras: what the host adds to /api/state (the server: agent runs, which agents and voice exist)
// A task change keeps today's plan honest (lib/daily.js noteTask); it never fails the change itself.
const noted = (task, how) => { try { Daily.noteTask(task, how); } catch (e) { console.warn('[daily]', e.message); } return task; };

// A route's :params, URL-decoded once here (a task file named "… 2.md", an iCloud copy, comes as "%202"); a malformed
// escape stays as it is.
export function routeParams(groups) {
  return Object.fromEntries(Object.entries(groups || {}).map(([k, v]) => { try { return [k, decodeURIComponent(v)]; } catch { return [k, v]; } }));
}

export function registerCore(route, { stateExtras = () => ({}) } = {}) {
  route('GET', '/api/state', () => {
    const areas = M.listAreas();
    return {
      today: V.localDate(), vault: V.VAULT, me: clientConfig(), voice: false, runs: [], agents: {}, reflectedToday: (() => { try { return getReflection().exists; } catch { return false; } })(),
      tasks: V.listTasks(), projects: V.listProjects(), goals: V.listGoals(), inbox: V.listInbox(), checklists: V.listChecklistTemplates(),
      // personal model (05_model/): shown only where there is data
      areas, containers: M.listContainers(areas), goalDetails: M.goalDetails(areas), decisions: M.listDecisions(), focus: Wins.withAuto(M.readFocus()),
      // what's coming up (commitments / wants / issues), minus containers that already have an open task
      attention: M.attentionItems(new Set(V.listTasks().filter((t) => t.status !== 'done' && t.project).map((t) => t.project))),
      day: (() => { try { return H.stateBrief(); } catch (e) { console.warn('[habits]', e.message); return null; } })(),
      ...stateExtras(),
    };
  });
  route('GET', '/api/logbook', () => V.listLogbook());
  route('POST', '/api/projects', (_, __, b) => V.createProject(b));
  route('PATCH', '/api/projects/:slug', ({ slug }, _, b) => V.updateProject(slug, b));
  route('POST', '/api/projects/:slug/note', ({ slug }, _, b) => V.addProjectNote(slug, b.text || ''));
  route('POST', '/api/goals', (_, __, b) => M.createGoal(b));
  route('PATCH', '/api/goals/:slug', ({ slug }, _, b) => M.updateGoal(slug, b));
  route('POST', '/api/decisions/:slug/decide', ({ slug }, _, b) => M.decide(slug, b));
  route('POST', '/api/decisions/:slug/drop', ({ slug }, _, b) => M.dropDecision(slug, b));
  route('POST', '/api/decisions/:slug/park', ({ slug }, _, b) => M.park(slug, b));
  route('GET', '/api/focus/suggestions', () => focusSuggestions() || { file: null, items: [] });
  route('PUT', '/api/focus/week', (_, __, b) => Wins.withAuto(M.setWeek(b.items, { next: !!b.next, commit: !!b.commit, past: b.past || null })));
  route('POST', '/api/model/:slug/snooze', ({ slug }, _, b) => M.snooze(slug, b.days));
  route('POST', '/api/model/:slug/cycle', ({ slug }) => M.cycleDone(slug));
  route('GET', '/api/reflection', (_, q) => getReflection(q.date || undefined));
  route('PUT', '/api/reflection', (_, __, b) => saveReflection(b));
  // The day (vault CLAUDE.md → "Daily file"): plan, #1, habits and the AM / PM protocols.
  route('GET', '/api/day', (_, q) => H.dayView(q.date || undefined));
  route('PUT', '/api/habits/:slug/checkin', ({ slug }, _, b) => H.checkIn(slug, b));
  route('POST', '/api/habits', (_, __, b) => H.createHabit(b));
  route('POST', '/api/habits/auto', (_, __, b) => H.applyAuto(b)); // the iPhone's Apple Health values, the Mac's Oura values
  route('PATCH', '/api/habits/:slug', ({ slug }, _, b) => H.updateHabit(slug, b));
  route('GET', '/api/off-work', () => H.offWorkState());
  route('POST', '/api/off-work', (_, __, b) => H.setOffWork(b)); // {add: {from, to, why}} | {end: {from}} | {remove: {from}}
  route('POST', '/api/habits/:slug/move', ({ slug }, _, b) => H.arrange(slug, { to: b.to || null, before: b.before || null }));
  // #1 is always a task you can start (Focus, a block): your own words, or a win's project / goal, become a new task due that
  // day (under that project when it is one); a task picked as #1 is due that day at the latest. Returns the #1 with its task linked.
  const oneToTask = (date, one) => {
    const text = String(one?.text || '').trim();
    if (!text) return { one, created: false };
    if (one.link) {
      let t = null;
      try { t = V.getTask(one.link); } catch { /* a project, a goal: not a task */ }
      // a task made for #1 on the phone offline, not yet brought by iCloud: 404 → the phone's queue tries again later
      if (!t && /^\d{8}-\d{6}-/.test(one.link)) throw Object.assign(new Error(`task ${one.link} not found`), { status: 404 });
      if (t) { if (t.status !== 'done' && (!t.due || t.due > date)) V.updateTask(t.id, { due: date }); return { one, created: false }; } // #1 is done that day
    }
    // a #1 with the title of an open task (a win picked again on another day) is that task, not a copy of it
    const key = (x) => String(x || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const same = V.listTasks().filter((x) => x.status !== 'done' && key(x.title) === key(text))
      .sort((a, b) => (b.project === one.link) - (a.project === one.link) || a.id.localeCompare(b.id))[0];
    if (same) { if (!same.due || same.due > date) V.updateTask(same.id, { due: date }); return { one: { ...one, text, link: same.id }, created: false }; }
    let t;
    try { t = V.createTask({ title: text, project: one.link || null, due: date, source: 'manual' }); } catch { t = V.createTask({ title: text, due: date, source: 'manual' }); }
    return { one: { ...one, text, link: t.id }, created: true };
  };
  // the morning plan (Apply in Plan the day): #1 and the tasks taken on; blocks and "Added later" stay
  route('PUT', '/api/day/plan', (_, __, b) => {
    const date = Daily.checkDate(b.date || V.localDate());
    if (b.one?.text) {
      const r = oneToTask(date, b.one);
      b.one = r.one;
      if (!(b.tasks || []).some((x) => x?.id === r.one.link)) b.tasks = [{ id: r.one.link, minutes: null }, ...(b.tasks || [])]; // #1's task is taken on today
    }
    return Daily.changePlan(date, (p) => {
      p.setAt = Daily.stamp();
      if (b.one !== undefined) p.one = b.one && (b.one.text || b.one.link) ? { text: String(b.one.text || '').trim(), link: b.one.link || null, done: !!b.one.done } : null;
      const was = Object.fromEntries(p.tasks.map((x) => [x.id, x]));
      const next = (b.tasks || []).filter((x) => x?.id).map((x) => ({ id: String(x.id), minutes: Number(x.minutes) || null, done: !!was[x.id]?.done }));
      // re-planning later in the day: what's already done from the earlier plan stays in it (it counts in the evening)
      p.tasks = [...p.tasks.filter((x) => x.done && !next.some((y) => y.id === x.id)), ...next];
      p.added = p.added.filter((id) => !was[id] && !p.tasks.some((x) => x.id === id));
    });
  });
  route('PUT', '/api/day/one', (_, __, b) => {
    const date = Daily.checkDate(b.date || V.localDate());
    if (b.text !== undefined && String(b.text).trim()) b.link = oneToTask(date, { text: b.text, link: b.link || null }).one.link;
    const p = Daily.changePlan(date, (x) => {
      const cur = x.one || { text: '', link: null, done: false };
      x.one = { text: b.text !== undefined ? String(b.text).trim() : cur.text, link: b.link !== undefined ? b.link || null : cur.link, done: b.done !== undefined ? !!b.done : cur.done };
      if (!x.one.text && !x.one.link) x.one = null;
    });
    // tomorrow's #1 chosen tonight (Daily reflection): that's tonight's "plan the next day" habit done
    if (p.one && b.text !== undefined) { try { H.nextOneChosen(date); } catch (e) { console.warn('[habits]', e.message); } }
    return p;
  });
  route('POST', '/api/day/close', (_, __, b) => Daily.closeDay(Daily.checkDate(b.date || V.localDate())));
  route('GET', '/api/weekly', () => weekly());
  route('PUT', '/api/weekly', (_, __, b) => saveWeekly(b.notes || {}));

  route('GET', '/api/tasks', (_, q) => V.listTasks().filter((t) =>
    Object.entries(q).every(([k, v]) => (k === 'label' ? t.labels.includes(v) : String(t[k] ?? '') === v))));
  route('POST', '/api/tasks', (_, __, body) => { const t = V.createTask(body); return t?.due === V.localDate() ? noted(t, { taken: true }) : t; });
  route('GET', '/api/tasks/:id', ({ id }) => V.getTask(id));
  route('PATCH', '/api/tasks/:id', ({ id }, _, body) => { const t = V.updateTask(id, body); return body.due === V.localDate() ? noted(t, { taken: true }) : t; });
  route('POST', '/api/tasks/:id/complete', ({ id }, _, b) => { const r = V.completeTask(id, { carry: !!b?.carry }); noted({ id }, { done: true }); DoneToday.noteDone(id); return r; });
  route('POST', '/api/tasks/:id/reopen', ({ id }) => { const r = V.reopenTask(id); noted({ id }, { done: false }); DoneToday.noteDone(id, false); return r; });
  route('POST', '/api/tasks/:id/drop', ({ id }) => V.dropTask(id));
  route('POST', '/api/tasks/:id/log', ({ id }, _, b) => V.appendLog(id, b.author || 'agent', b.text || ''));
  route('POST', '/api/tasks/:id/mail', ({ id }, _, b) => V.addMail(id, { threadId: b.threadId, subject: b.subject }));
  // Agent handshake: claim → (work, log) → submit for review | block.
  route('POST', '/api/tasks/:id/claim', ({ id }, _, b) => {
    const t = V.getTask(id);
    if (t.agent_state === 'running') throw V.httpError(409, 'already running');
    V.appendLog(id, b.agent || 'agent', 'Claimed');
    return V.updateTask(id, { assigned: 'agent', agent_state: 'running' });
  });
  route('POST', '/api/tasks/:id/submit', ({ id }, _, b) => {
    if (b.text) V.appendLog(id, b.agent || 'agent', b.text);
    return V.updateTask(id, { agent_state: 'review' });
  });
  route('POST', '/api/tasks/:id/block', ({ id }, _, b) => {
    V.appendLog(id, b.agent || 'agent', `Blocked: ${b.text || 'needs input'}`);
    return V.updateTask(id, { agent_state: 'blocked', status: 'wait' });
  });
  // Human review of agent work.
  // Accept = the agent's work is approved and the task comes back to the owner (still open).
  // Accept & close ({close: true}) = the agent's result completes the task.
  route('POST', '/api/tasks/:id/accept', ({ id }, _, b) => {
    V.appendLog(id, profile().id, `Accepted${b.close ? ' & closed' : ''}${b.text ? `: ${b.text}` : ''}`);
    if (b.close) { const r = V.completeTask(id); DoneToday.noteDone(id); return r; }
    return V.updateTask(id, { assigned: 'me' });
  });
  route('POST', '/api/tasks/:id/sendback', ({ id }, _, b) => {
    V.appendLog(id, profile().id, `Sent back: ${b.text || '(no comment)'}`);
    return V.updateTask(id, { agent_state: 'queued', status: 'new' });
  });
  route('GET', '/api/checklists', () => V.listChecklistTemplates());
  route('POST', '/api/checklists', (_, __, b) => V.saveChecklistTemplate(b));
  route('POST', '/api/items', (_, __, b) => V.createItem({ text: b.text, title: b.title, source: b.source || (b.url ? 'clipping' : 'manual'), suggestion: b.suggestion, url: b.url, note: b.note }));
  route('POST', '/api/items/:id/process', ({ id }, _, b) => { V.processItem(id, b); return { ok: true }; });

  route('GET', '/api/settings', () => Settings.withAgents(Settings.get()));
  route('PATCH', '/api/settings', (_, __, b) => {
    const was = Settings.get(), s = Settings.update(b);
    const focus = (x) => !!(x.macFocus && x.simple); // the Mac's Focus follows the Focus view (lib/macfocus.js)
    if (focus(was) !== focus(s)) MacFocus.set(focus(s));
    return Settings.withAgents(s);
  });
  route('GET', '/api/mac-focus', () => MacFocus.state());
  route('GET', '/api/pomodoros', () => P.stats());
  route('POST', '/api/pomodoros', (_, __, b) => P.logPomodoro(b));
  route('POST', '/api/sweep', () => ({ moved: V.sweepArchive() }));
}
