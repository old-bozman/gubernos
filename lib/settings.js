// App settings shared by all devices (the theme stays per device, in the browser). Stored in data/settings.json.
import fs from 'node:fs';
import path from 'node:path';
import { DEV_AGENT, profile } from './config.js';

const DATA = process.env.GUBERNOS_DATA_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data');
const FILE = path.join(DATA, 'settings.json');
const DEFAULTS = { eveningAt: process.env.GUBERNOS_EVENING_AT ?? '19:00', reflectionAt: '22:00', reflectionFormat: 'esp', habits: true, weekStart: 'monday', clock: '24h', simple: false, digestAt: process.env.GUBERNOS_DIGEST_AT ?? '08:30', lunchAt: '12:00', sprintMinutes: 25 }; // digestAt, lunchAt "" = off

export function get() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch { return { ...DEFAULTS }; }
}

// Agents a task can go to (Settings → Your Mac → Agents): each with a name, how it starts, and whether the task's picker shows it.
// run: claude = Claude Code here, in the vault (▶ Run) · codex = Codex here · queue = it takes its
// own queue (an assistant, a session elsewhere) · dev = the developer session's queue, in the app's code (the developer's
// own install only). A task with no agent goes to the app's model (provider, lib/llm.js).
// Built-ins can be renamed or hidden, not removed; custom ones are added and removed in Settings. Ids never change, so
// tasks keep pointing at their agent.
const RUNS = ['claude', 'codex', 'api', 'queue'];
export const PROVIDER_IDS = ['claude', 'codex', 'api']; // the model the app uses: lib/llm.js
export function agentList(s = get()) {
  const p = profile();
  const base = [
    { id: 'claude', name: 'Claude', run: 'claude' },
    ...(p.assistant ? [{ id: p.assistant.id, name: p.assistant.name, run: 'queue' }] : []),
    { id: 'codex', name: 'Codex', run: 'codex' },
    ...(DEV_AGENT ? [{ id: 'dev', name: 'Dev', run: 'dev' }] : []),
  ];
  const saved = Array.isArray(s.agents) ? s.agents : [];
  const out = base.map((a) => {
    const x = saved.find((y) => y?.id === a.id);
    return { ...a, builtin: true, on: x?.on !== false, name: String(x?.name || '').trim() || a.name, run: a.run === 'dev' ? 'dev' : RUNS.includes(x?.run) ? x.run : a.run };
  });
  for (const x of saved) { // Gemini was a built-in until 2026-11: an old install's saved row isn't a custom agent
    if (!x?.id || out.some((a) => a.id === x.id) || x.id === 'dev' || x.id === 'gemini' || !/^[a-z0-9][a-z0-9-]*$/.test(x.id)) continue;
    out.push({ id: x.id, name: String(x.name || '').trim() || x.id, run: RUNS.includes(x.run) ? x.run : 'claude', on: x.on !== false, builtin: false });
  }
  return out;
}
export const withAgents = (s) => ({ ...s, agentList: agentList(s) });

export function update(patch = {}) {
  const s = get();
  if (patch.provider !== undefined && PROVIDER_IDS.includes(patch.provider)) s.provider = patch.provider; // chosen at setup or in Settings → Your Mac → Agents
  // Focus: a sprint's length by default (minutes; the Focus screen can change it for one sprint)
  // Voice: the language spoken to the app (a locale, "mixed" = several, "" = from profile.md); lib/voice.js
  if (patch.voiceLanguage !== undefined) s.voiceLanguage = /^([a-z]{2,3}([-_][A-Za-z]{2,4})?|mixed)$/.test(String(patch.voiceLanguage)) ? String(patch.voiceLanguage).replace('_', '-') : '';
  if (patch.sprintMinutes !== undefined) s.sprintMinutes = Math.min(180, Math.max(1, Math.round(Number(patch.sprintMinutes) || DEFAULTS.sprintMinutes)));
  if (patch.relayPush !== undefined) s.relayPush = !!patch.relayPush;
  if (patch.weekStart !== undefined) s.weekStart = patch.weekStart === 'sunday' ? 'sunday' : 'monday'; // the wins week, the weekly review, habits
  if (patch.simple !== undefined) s.simple = !!patch.simple; // the Focus view of Today (was "Simple Today"): only #1 and the tasks, each one tap from Focus
  if (patch.macFocus !== undefined) s.macFocus = !!patch.macFocus; // the Mac's Focus follows the Focus view (lib/macfocus.js)
  if (patch.clock !== undefined) s.clock = patch.clock === '12h' ? '12h' : '24h'; // how times are shown: 16:30 or 4:30pm
  if (patch.screenIntros !== undefined) s.screenIntros = !!patch.screenIntros; // a line on each screen, the first time (public/app.js INTROS)
  if (Array.isArray(patch.seenIntros)) s.seenIntros = patch.seenIntros.map(String).slice(0, 50);
  if (patch.habits !== undefined) s.habits = !!patch.habits; // the habits module: check-ins, AM/PM protocols, their reminders
  for (const k of ['eveningAt', 'reflectionAt']) if (patch[k] !== undefined) s[k] = /^([01]\d|2[0-3]):[0-5]\d$/.test(patch[k]) ? patch[k] : ''; // "" = off
  if (patch.reflectionFormat !== undefined) s.reflectionFormat = patch.reflectionFormat === 'journal' ? 'journal' : 'esp';
  if (Array.isArray(patch.agents)) {
    s.agents = patch.agents.filter((x) => x && /^[a-z0-9][a-z0-9-]*$/.test(x.id)).slice(0, 20)
      .map((x) => ({ id: x.id, name: String(x.name || '').replace(/\s+/g, ' ').trim().slice(0, 40), run: x.run === 'dev' ? 'dev' : RUNS.includes(x.run) ? x.run : 'claude', on: x.on !== false }));
  }
  // lunch for Plan the day: lunchAt "" = not counted; minutes 15–180 (unset: 12:00, profile.md's workday.lunch)
  if (patch.lunchAt !== undefined) s.lunchAt = /^([01]\d|2[0-3]):[0-5]\d$/.test(patch.lunchAt) ? patch.lunchAt : '';
  // lunch for one day (Plan the day → Lunch → Move / Skip today): {date, at: "HH:MM" | "" = none that day}; null clears it
  if (patch.lunchDay !== undefined) {
    const d = patch.lunchDay;
    s.lunchDay = d && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? { date: d.date, at: /^([01]\d|2[0-3]):[0-5]\d$/.test(d.at) ? d.at : '' } : null;
  }
  if (patch.lunchMinutes !== undefined) s.lunchMinutes = Math.min(180, Math.max(15, Math.round(Number(patch.lunchMinutes) || 60)));
  // extra Google calendars read for busy time (lib/gcal.js readCalendars): calendar ids
  if (Array.isArray(patch.calendars)) s.calendars = [...new Set(patch.calendars.filter((x) => typeof x === 'string' && /^[^\s/]{3,200}$/.test(x)))].slice(0, 10);
  // where Plan the day reads and writes: the Mac's own calendars (Calendar.app, lib/maccal.js) or Google (lib/gcal.js);
  // null = Google when it is connected, else the Mac's (lib/calendar.js)
  if (patch.calendarSource !== undefined) s.calendarSource = ['macos', 'google'].includes(patch.calendarSource) ? patch.calendarSource : null;
  // the Mac's calendars: the one time blocks go to (null = Calendar.app's default) and the ones read for busy time (null = all)
  if (patch.macCalendar !== undefined) s.macCalendar = typeof patch.macCalendar === 'string' && patch.macCalendar.length < 200 ? patch.macCalendar : null;
  if (patch.macCalendars !== undefined) s.macCalendars = Array.isArray(patch.macCalendars) ? [...new Set(patch.macCalendars.filter((x) => typeof x === 'string' && x.length < 200))].slice(0, 30) : null;
  // the colours (Settings → Colours): 0 = the original, 1–4 = the other palettes (public/app.css data-palette)
  if (patch.palette !== undefined) s.palette = [1, 2, 3, 4].includes(Number(patch.palette)) ? Number(patch.palette) : 0;
  // projects and goals pinned on top of their menus (the app's top bar, the phone's More): "project:<slug>" | "goal:<slug>"
  if (Array.isArray(patch.pins)) s.pins = [...new Set(patch.pins.filter((x) => typeof x === 'string' && /^(project|goal):[^\s:]{1,160}$/.test(x)))].slice(0, 12);
  if (patch.digestAt !== undefined) s.digestAt = /^([01]\d|2[0-3]):[0-5]\d$/.test(patch.digestAt) ? patch.digestAt : '';
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(s, null, 1));
  return s;
}
