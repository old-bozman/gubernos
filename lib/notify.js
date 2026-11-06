// What to notify about, checked every 20 s: task reminders, the morning digest, and agents handing work back.
// Agent changes are detected from the vault itself, so runs from the app, the assistant or Claude Code all count.
import fs from 'node:fs';
import path from 'node:path';
import { listTasks, localDate } from './vault.js';
import { sendAll, deviceCount } from './push.js';
import * as Settings from './settings.js';
import { listDecisions } from './model.js';
import { dayFree } from './planner.js';
import { getReflection } from './reflection.js';
import { stateBrief } from './habits.js';
import * as Daily from './daily.js';
import * as Oura from './oura.js';
import { authStatus, accessTokenFor } from './google.js';

const DATA = process.env.GUBERNOS_DATA_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data');
const STATE = path.join(DATA, 'notify-state.json');
const REMINDER_WINDOW_H = 6; // a reminder missed by more than this (Mac asleep) is skipped, not sent late

const pad = (n) => String(n).padStart(2, '0');
const nowLocal = (d = new Date()) => `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const read = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return null; } };
const save = (s) => { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(s, null, 1)); };
const url = (id) => `/#/task/${id}`;
const short = (s, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
// The agent's last word in a task's ## Agent log (what it found, or what it needs): the push shows it, so the result can be
// read and accepted on the watch.
export function agentWord(body) {
  const sec = String(body || '').match(/^##\s+Agent log[ \t]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m)?.[1] || '';
  const entries = sec.split(/\n(?=- \d{4}-\d{2}-\d{2})/).map((e) => e.trim()).filter((e) => e.startsWith('- '));
  const last = entries.at(-1);
  if (!last) return '';
  return last.replace(/^- [^·]*·[^·]*·\s*/, '').replace(/^Blocked:\s*/, '').replace(/\n\s+/g, '\n').trim();
}
// Notification actions (the iPhone app's categories, Gubernos/Reminders.swift; shown on the watch too): what a push can do in place
const habitAction = (n) => (n ? { category: n.quit ? 'GUBERNOS_HABIT_QUIT' : 'GUBERNOS_HABIT', data: { habit: n.slug } } : {});

// Pure: given tasks, previous state and now → messages + next state. (Tested without the clock or the network.)
export function plan(tasks, prev, now = new Date(), { digestAt: DIGEST_AT = Settings.get().digestAt, decisions = [], freeMinutes = null, eveningAt = Settings.get().eveningAt, reflectionAt = Settings.get().reflectionAt, reflected = false, protocols = [] } = {}) {
  const st = { agent: {}, sent: { ...(prev?.sent || {}) } };
  const out = [];
  const nl = nowLocal(now), today = localDate(now);
  const open = tasks.filter((t) => t.status !== 'done');
  const since = nowLocal(new Date(now.getTime() - REMINDER_WINDOW_H * 3600e3));

  for (const t of open) {
    const r = t.reminder && t.reminder.length >= 16 ? t.reminder.slice(0, 16) : null;
    const key = `r:${t.id}:${r}`;
    if (r && r <= nl && r >= since && !st.sent[key]) {
      out.push({ title: `⏰ ${short(t.title)}`, body: t.due ? `Due ${t.due}` : 'Reminder', url: url(t.id), tag: `task-${t.id}`, kind: 'reminder', category: 'GUBERNOS_REMINDER', data: { taskId: t.id } });
      st.sent[key] = now.toISOString();
    }
  }

  // Only within 3 h of DIGEST_AT: a Mac that wakes up in the evening shouldn't send a "morning" digest.
  const late = DIGEST_AT && `${pad(Math.min(23, +DIGEST_AT.slice(0, 2) + 3))}:${DIGEST_AT.slice(3)}`;
  if (DIGEST_AT && nl.slice(11) >= DIGEST_AT && nl.slice(11) < late && !st.sent[`d:${today}`]) {
    st.sent[`d:${today}`] = now.toISOString();
    const mine = open.filter((t) => t.assigned !== 'agent' && t.due && t.due <= today);
    const overdue = mine.filter((t) => t.due < today).length;
    const review = open.filter((t) => t.assigned === 'agent' && t.agent_state === 'review').length;
    // open decisions due within 3 days or overdue (vault AGENTS.md → "Decision queue"); parked ones wait for their date
    const soon = localDate(new Date(now.getTime() + 3 * 864e5));
    const dec = decisions.filter((d) => d.status === 'open' && d.decide_by && d.decide_by <= soon).sort((a, b) => a.decide_by.localeCompare(b.decide_by));
    if (mine.length || review || dec.length) {
      const order = { urgent: 0, planned: 1, someday: 2 };
      const top = [...mine].sort((a, b) => (order[a.priority] ?? 3) - (order[b.priority] ?? 3)).slice(0, 3).map((t) => `• ${short(t.title, 60)}`);
      const when = (d) => (d.decide_by < today ? 'overdue' : d.decide_by === today ? 'today' : `by ${new Date(`${d.decide_by}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })}`);
      const decLine = dec.length ? [`⚖️ Decide: ${dec.slice(0, 3).map((d) => `${short(d.question.replace(/\?$/, ''), 40)} (${when(d)})`).join('; ')}`] : [];
      const parts = [mine.length ? `${mine.length} task${mine.length === 1 ? '' : 's'}` : '', overdue ? `${overdue} overdue` : '', review ? `${review} to review` : '', dec.length ? `${dec.length} decision${dec.length === 1 ? '' : 's'}` : ''].filter(Boolean);
      // with the owner's own tasks it's an invitation to plan the day (free time from the calendar), opening Plan the day
      const free = freeMinutes != null ? `${Math.round(freeMinutes / 60)}h free` : '';
      out.push({ title: mine.length ? `Plan your day${free ? ` · ${free}` : ''} · ${parts.join(' · ')}` : `Today: ${parts.join(' · ')}`,
        body: [...top, ...decLine].join('\n') || 'Agent work is waiting for review', url: mine.length ? '/#/plan' : dec.length ? '/#/decisions' : '/#/today', tag: 'digest', kind: 'checkin' });
    }
  }

  // Evening (Settings → evening check-in, default 19:00; within 3 h, once): the owner's own tasks still due today →
  // offer to move them (opens the app's evening screen).
  const within3h = (at) => at && nl.slice(11) >= at && nl.slice(11) < (+at.slice(0, 2) + 3 > 23 ? '24:00' : `${pad(+at.slice(0, 2) + 3)}:${at.slice(3)}`);
  if (within3h(eveningAt) && !st.sent[`e:${today}`]) {
    st.sent[`e:${today}`] = now.toISOString();
    const left = open.filter((t) => t.assigned !== 'agent' && t.due && t.due <= today);
    if (left.length) out.push({ title: `${left.length} left for today`, body: `Move ${left.length === 1 ? 'it' : 'them'} to tomorrow? ${left.slice(0, 2).map((t) => short(t.title, 40)).join(' · ')}`, url: '/#/plan/evening', tag: 'evening', kind: 'checkin' });
  }

  // Daily reflection (Settings, default 22:00; within 3 h, once, unless today's is written): opens #/reflect.
  if (within3h(reflectionAt) && !st.sent[`rf:${today}`]) {
    st.sent[`rf:${today}`] = now.toISOString();
    if (!reflected) out.push({ title: 'Daily reflection', body: 'Three short answers about today — under five minutes.', url: '/#/reflect', tag: 'reflection', kind: 'checkin' });
  }

  // AM / PM protocols (habits module): when a window starts (within 3 h, once a day), unless all of it is done already.
  for (const p of protocols) {
    if (!p.window || !within3h(p.window.start) || st.sent[`pr:${p.slug}:${today}`]) continue;
    st.sent[`pr:${p.slug}:${today}`] = now.toISOString();
    if (p.done < p.total) out.push({ title: `${p.title} · ${p.done}/${p.total}`, body: p.habits.slice(0, 4).join(' → ') || 'Your protocol', url: '/#/day', tag: `protocol-${p.slug}`, kind: 'checkin', ...habitAction(p.next) });
  }
  // halfway through a window with less than half done: the next habit (once)
  for (const p of protocols) {
    if (!p.window) continue;
    const [a, z] = [p.window.start, p.window.end].map((x) => +x.slice(0, 2) * 60 + +x.slice(3));
    const mid = Math.round((a + z) / 2), nowM = now.getHours() * 60 + now.getMinutes();
    if (nowM < mid || nowM >= z || st.sent[`pm:${p.slug}:${today}`]) continue;
    st.sent[`pm:${p.slug}:${today}`] = now.toISOString();
    if (p.next && p.done * 2 < p.total) out.push({ title: `${p.title} · ${p.done}/${p.total} — next: ${short(p.next.title, 40)}`, body: p.next.cue || `${p.total - p.done} left before ${p.window.end}`, url: '/#/day', tag: `protocol-${p.slug}`, kind: 'checkin', ...habitAction(p.next) });
  }

  for (const t of tasks) {
    if (t.assigned !== 'agent' && !prev?.agent?.[t.id]) continue;
    const s = t.status === 'done' ? 'done' : t.assigned === 'agent' ? t.agent_state || 'queued' : 'mine';
    st.agent[t.id] = s;
    const was = prev?.agent?.[t.id];
    if (!prev || was === s) continue; // first run only records the current states
    const said = short(agentWord(t.body), 600);
    if (s === 'review') out.push({ title: `✦ Agent finished: ${short(t.title)}`, body: said || 'Ready for your review', url: url(t.id), tag: `task-${t.id}`, kind: 'agent', category: 'GUBERNOS_REVIEW', data: { taskId: t.id } });
    if (s === 'blocked') out.push({ title: `✦ Agent is blocked: ${short(t.title)}`, body: said || 'It needs something from you', url: url(t.id), tag: `task-${t.id}`, kind: 'agent', category: 'GUBERNOS_BLOCKED', data: { taskId: t.id } });
  }

  const cutoff = now.getTime() - 3 * 864e5;
  for (const [k, v] of Object.entries(st.sent)) if (new Date(v).getTime() < cutoff) delete st.sent[k];
  return { messages: out, state: st };
}

let busy = false;
export async function tick() {
  if (busy) return;
  busy = true;
  try {
    let decisions = [];
    try { decisions = listDecisions(); } catch { /* no model yet */ }
    // free time only matters for the morning digest; the calendar is asked only then
    const prev = read(), nowD = new Date(), day = localDate(nowD);
    let freeMinutes = null;
    if (!prev?.sent?.[`d:${day}`] && Settings.get().digestAt && `${String(nowD.getHours()).padStart(2, '0')}:${String(nowD.getMinutes()).padStart(2, '0')}` >= Settings.get().digestAt) {
      try { const f = await dayFree(nowD); if (!f.calendarError) freeMinutes = f.freeMinutes; } catch { /* no calendar */ }
    }
    // Google: refresh once a day so an expired connection is noticed even on days nothing asks the calendar; then push once a day
    const g = authStatus();
    const checkGoogle = g.configured && !g.expired && !prev?.sent?.[`gc:${day}`];
    if (checkGoogle) { try { await accessTokenFor('calendar'); } catch { /* an expired token is recorded by google.js */ } }
    let reflected = false;
    try { reflected = getReflection(day).exists; } catch { /* no reviews folder yet */ }
    let protocols = [];
    try {
      const b = stateBrief();
      protocols = b.protocols.map((p) => ({ ...p, ...(b.summary.find((s) => s.protocol === p.slug) || { done: 0, total: p.habits.length }) }));
    } catch { /* no habits */ }
    // yesterday's plan vs actual, if the evening didn't write it (no reflection, no evening screen)
    if (!prev?.sent?.[`cl:${day}`]) {
      try { const y = Daily.addDays(day, -1), p = Daily.getPlan(y); if (p && !p.line) Daily.closeDay(y); } catch (e) { console.warn('[notify] close day', e.message); }
    }
    // Oura → habits, once an hour (no token or no habit taking it: nothing happens)
    const hourKey = `o:${day}T${String(nowD.getHours()).padStart(2, '0')}`;
    if (!prev?.sent?.[hourKey]) { try { const r = await Oura.sync(nowD); if (r.applied?.length) console.log(`[oura] ${r.applied.length} habit value(s)`); } catch (e) { console.warn('[oura]', e.message); } }
    const { messages, state } = plan(listTasks(), prev, nowD, { decisions, freeMinutes, reflected, protocols });
    state.sent[`cl:${day}`] = state.sent[`cl:${day}`] || nowD.toISOString();
    state.sent[hourKey] = state.sent[hourKey] || nowD.toISOString();
    if (checkGoogle) state.sent[`gc:${day}`] = nowD.toISOString();
    if (authStatus().expired && !state.sent[`ge:${day}`]) {
      state.sent[`ge:${day}`] = nowD.toISOString();
      messages.push({ title: 'Google connection expired', body: 'Plan the day can’t see your calendar and agents can’t read mail. Reconnect on the Mac: Settings → Your Mac → Google.', url: '/#/settings', tag: 'google' });
    }
    save(state);
    if (messages.length && deviceCount()) {
      for (const m of messages) {
        const r = await sendAll(m);
        console.log(`[notify] ${m.title} → ${r.sent}/${r.devices}`);
      }
    }
  } catch (e) { console.error('[notify]', e.message); }
  finally { busy = false; }
}

export function start() {
  tick();
  return setInterval(tick, 20000);
}
