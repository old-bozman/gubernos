// Voice capture: audio → text on this Mac → the app's model → task drafts.
// Two engines, both local: the Mac's own speech models (tools/voice/gubernos-voice, macOS 26+, nothing to install) and
// Whisper (MLX, lib/stt.py; scripts/setup.sh voice). Whisper when it's installed: it hears Russian, mixed languages and
// accents far better (2026-11-02 comparison); otherwise the Mac's models, in the language set in Settings → Voice.
// The app sends 16 kHz mono WAV (public/app.js toWav), so neither needs ffmpeg.
// Nothing is written to the vault here; the UI shows drafts and creates tasks via /api/tasks.
import { spawn, execFile } from 'node:child_process';
import { ask } from './llm.js';
import fs from 'node:fs';
import path from 'node:path';
import { listProjects, listTasks, httpError, localDate } from './vault.js';
import { resolveDateSpec, DATE_SPEC_SCHEMA } from './dates.js';
import { parseRepeat } from '../public/recur.js';
import { parseDate } from '../public/parse.js';
import { profile } from './config.js';
import { get as settings } from './settings.js';

// A spoken clock time ("в 10", "at 3pm") → a reminder that day; with no date: today, or tomorrow if that time is gone.
function reminderOf(time, due, now) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || '').trim());
  if (!m || +m[1] > 23 || +m[2] > 59) return {};
  const hm = `${m[1].padStart(2, '0')}:${m[2]}`, today = localDate(now);
  const nowHm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const day = due || (hm > nowHm ? today : localDate(new Date(now.getTime() + 864e5)));
  return { due: day, reminder: `${day}T${hm}` };
}

// "every monday" → { recurrence, due (first occurrence unless a date was said) }
function repeatOf(t, now) {
  const r = t.repeat ? parseRepeat(t.repeat, localDate(now)) : null;
  return r ? { recurrence: r.recurrence, due: resolveDateSpec(t.due, now) || r.due } : {};
}

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const TMP = path.join(ROOT, '.runs');
const PY = process.env.GUBERNOS_STT_PYTHON || path.join(ROOT, '.venv/bin/python');
const HELPER = process.env.GUBERNOS_VOICE_BIN || path.join(ROOT, 'tools/voice/gubernos-voice');
const whisperInstalled = () => fs.existsSync(PY);
// Whisper reads WAV itself; any other format (an old client) goes through ffmpeg, if there is one
const hasFfmpeg = () => ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].some((f) => fs.existsSync(f));
const NO_FFMPEG = 'This recording needs ffmpeg on the Mac: reload the app (it sends WAV now), or brew install ffmpeg';

// The language the owner speaks to the app: Settings → Voice (settings.voiceLanguage: a locale such as "en-US", or
// "mixed" — several languages, which only Whisper hears); unset → profile.md's language, else English.
const LANGS = { english: 'en-US', russian: 'ru-RU', ukrainian: 'uk-UA', dutch: 'nl-NL', german: 'de-DE', french: 'fr-FR', spanish: 'es-ES', italian: 'it-IT', portuguese: 'pt-BR', japanese: 'ja-JP', korean: 'ko-KR', chinese: 'zh-CN', hindi: 'hi-IN' };
export const voiceLanguage = () => settings().voiceLanguage || LANGS[String(profile().language || '').trim().toLowerCase()] || 'en-US';

// What the Mac's own models hear ({speech: [...], dictation: [...]}, e.g. "en_US"): asked once at start
let locales = { speech: [], dictation: [] };
if (process.platform === 'darwin' && fs.existsSync(HELPER)) {
  execFile(HELPER, ['locales'], { timeout: 30000 }, (e, out) => {
    try { const r = JSON.parse(String(out).trim().split('\n').pop()); if (!r.error) locales = r; else vlog('Mac speech models:', r.error); } catch { vlog('voice helper failed:', e?.message); }
  });
}
// "ru-RU" in ["ru_RU", …], or the same language in another region (the helper maps it: supportedLocale(equivalentTo:))
const macHears = (kind, lang) => { const l = lang.replace('-', '_'), base = l.split('_')[0]; return (locales[kind] || []).some((x) => x === l || x.split('_')[0] === base); };
// whisper | speech (the Mac's newer model) | dictation (its older one: more languages) | null = no voice
export function voiceEngine(lang = voiceLanguage()) {
  if (whisperInstalled()) return 'whisper';
  if (lang === 'mixed') return null;
  return macHears('speech', lang) ? 'speech' : macHears('dictation', lang) ? 'dictation' : null;
}
export const voiceAvailable = () => !!voiceEngine();
export const voiceStatus = () => ({ engine: voiceEngine(), language: voiceLanguage(), whisper: whisperInstalled(), mac: locales });
const IDLE_MS = 15 * 60 * 1000; // AICODE-NOTE: the model holds ~1.6 GB; free it when voice isn't used.

// AICODE-NOTE: two worker processes — "quick" (whisper-small, short commands) and "full" (large-v3-turbo,
// dictation). Separate processes so a command never waits behind the big model loading or decoding.
const workers = { quick: null, full: null };
let idleTimer = null, seq = 0;
const pending = new Map();

function getWorker(kind) {
  if (workers[kind]) return workers[kind];
  const w = spawn(PY, [path.join(ROOT, 'lib/stt.py'), kind], { stdio: ['pipe', 'pipe', 'pipe'] });
  workers[kind] = w;
  let buf = '';
  w.stdout.on('data', (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try { const r = JSON.parse(line); pending.get(r.id)?.(r); pending.delete(r.id); } catch { /* ignore */ }
    }
  });
  w.stderr.on('data', () => {}); // model download progress / warnings
  w.on('error', (e) => { vlog('worker failed to start:', e.message); }); // 'exit' follows and fails the pending calls
  w.on('exit', () => {
    workers[kind] = null;
    for (const [id, cb] of pending) if (cb.kind === kind) { cb({ id, error: 'speech worker exited' }); pending.delete(id); }
  });
  return w;
}

function touchIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { for (const k of Object.keys(workers)) { workers[k]?.kill(); workers[k] = null; } }, IDLE_MS);
}

export function vlog(...a) { console.log(new Date().toISOString().slice(11, 23), '[voice]', ...a); }

const EXT = { 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mpeg': 'mp3' };

// A 0.5 s silent WAV, used to load both models into memory before the user finishes speaking.
function silentWav() {
  const n = 8000, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
let warmedAt = 0;
export function warm() {
  if (!voiceAvailable()) return { warm: false, unavailable: true };
  if (voiceEngine() !== 'whisper') return { warm: true }; // the Mac's models start in a blink
  if (workers.quick && workers.full && Date.now() - warmedAt < IDLE_MS - 60000) { touchIdle(); return { warm: true }; }
  warmedAt = Date.now();
  const wav = silentWav();
  vlog('warming models');
  // Both in parallel (separate processes): quick is ready in ~1 s, full in ~4 s.
  transcribe(wav, 'audio/wav', { quick: true }).catch(() => { warmedAt = 0; });
  transcribe(wav, 'audio/wav').catch(() => { warmedAt = 0; });
  return { warm: false };
}

export async function transcribe(buffer, contentType, { quick = false } = {}) {
  if (!buffer.length) throw httpError(400, 'empty audio');
  const engine = voiceEngine(), lang = voiceLanguage();
  if (!engine) throw httpError(503, lang === 'mixed' ? 'Several languages need Whisper on the Mac: scripts/setup.sh voice' : `No speech model for ${lang} on this Mac (macOS 26 has them): pick another language in Settings → Voice, or install Whisper (scripts/setup.sh voice)`);
  const ext = EXT[(contentType || '').split(';')[0]] || 'webm';
  if (engine === 'whisper' && ext !== 'wav' && !hasFfmpeg()) throw httpError(503, NO_FFMPEG);
  fs.mkdirSync(TMP, { recursive: true });
  const file = path.join(TMP, `voice-${Date.now()}.${ext}`);
  fs.writeFileSync(file, buffer);
  if (engine !== 'whisper') return macTranscribe(file, lang, buffer.length, contentType);
  // Vocabulary hint so project names and agent words come out right.
  // Vocabulary hint: command words for short utterances, project names for dictation.
  const prompt = quick
    ? 'Команды: найди, поиск, скип, пропусти, дальше, готово, отмени, закрой, неактуально, удали задачу, стоп, пауза, старт, в архив, удали, принять, фокус, инбокс, сегодня, завтра, на выходные, на следующую неделю. Commands: search, find, skip, done, complete, drop, undo, revert, go, ok, focus, inbox, today, tomorrow, weekend, next week, stop.'
    : `Tasks. Projects: ${listProjects().filter((p) => p.status === 'active').map((p) => p.title).join(', ')}. ${profile().assistant ? `${profile().assistant.name}, ` : ''}агент, Claude.`;
  const id = ++seq;
  const kind = quick ? 'quick' : 'full';
  const t0 = Date.now();
  try {
    const r = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(httpError(504, 'transcription timed out')); }, 120000);
      const cb = (res) => { clearTimeout(timer); resolve(res); };
      cb.kind = kind;
      pending.set(id, cb);
      // a language chosen in Settings → Voice: Whisper decodes in it (accented English stays English); not chosen (the
      // default from profile.md is only a guess) or "mixed": it detects the language itself, as before
      const set = settings().voiceLanguage, language = set && set !== 'mixed' ? set.split('-')[0] : null;
      getWorker(kind).stdin.write(JSON.stringify({ id, path: file, prompt, quick, language }) + '\n');
    });
    if (r.error) throw httpError(/ffmpeg/i.test(r.error) ? 503 : 500, /ffmpeg/i.test(r.error) ? NO_FFMPEG : `transcription failed: ${r.error}`);
    if (buffer.length > 20000 || r.text) vlog(`${kind} ${Math.round(buffer.length / 1024)}KB ${contentType} → "${r.text.slice(0, 60)}" model ${r.ms}ms total ${Date.now() - t0}ms`);
    return { text: r.text, language: r.language, ms: r.ms, quick, engine };
  } finally {
    touchIdle();
    fs.rm(file, () => {});
  }
}

// The Mac's own models: one helper run per recording (they load in a blink). Hints: the active projects' names and the
// assistant's, so they come out right. The first use of a language may wait while macOS downloads its model.
function macTranscribe(file, lang, size, contentType) {
  const words = [...listProjects().filter((p) => p.status === 'active').map((p) => p.title), profile().assistant?.name, 'Claude']
    .filter(Boolean).map((w) => String(w).replace(/,/g, ' ')).slice(0, 60).join(',') || '-';
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    execFile(HELPER, ['transcribe', lang, words, file], { timeout: 600000 }, (e, out) => {
      fs.rm(file, () => {});
      let r;
      try { r = JSON.parse(String(out).trim().split('\n').pop()); } catch { return reject(httpError(500, `transcription failed: ${e?.message || out}`)); }
      if (r.error) return reject(httpError(500, `transcription failed: ${r.error}`));
      vlog(`${r.engine} ${lang} ${Math.round(size / 1024)}KB ${contentType} → "${r.text.slice(0, 60)}" ${r.ms}ms total ${Date.now() - t0}ms`);
      resolve({ text: r.text, language: lang, ms: r.ms, quick: false, engine: r.engine });
    });
  });
}

const TASK_SCHEMA = {
  type: 'object',
  required: ['title', 'priority', 'assigned', 'due', 'deadline', 'project', 'notes'],
  properties: {
    title: { type: 'string' },
    notes: { type: 'string' },
    due: DATE_SPEC_SCHEMA,
    deadline: DATE_SPEC_SCHEMA,
    priority: { enum: ['urgent', 'planned', 'someday'] },
    assigned: { enum: ['me', 'agent', 'someone'] },
    project: { type: ['string', 'null'] },
    labels: { type: 'array', items: { type: 'string' } },
    repeat: { type: ['string', 'null'] }, // as said: "every monday", "каждый месяц 1-го"; null if not recurring
    time: { type: ['string', 'null'] }, // "HH:MM" 24h when a clock time is said ("в 10", "at 3pm", "в 7 вечера") → a reminder; else null
  },
};

// Commands the app can execute from speech. Keep in sync with runCommand() in public/app.js.
export const COMMANDS = {
  reschedule_overdue: 'move ALL overdue tasks to today ("перенеси просроченные на сегодня", "reschedule")',
  focus: 'start focus mode; task = the task to focus on if one is named, else null (app picks the most important)',
  focus_done: 'the task in focus is done → go to the next one ("готово", "сделал", "done")',
  focus_skip: 'skip the current task / capture / review item for now, in any mode ("пропусти", "skip", "дальше")',
  focus_exit: 'leave focus / inbox / review mode ("выйди", "хватит", "stop")',
  step_done: 'tick the next unchecked subtask of the current task ("шаг готов", "следующий шаг", "отметь подзадачу")',
  pomodoro_start: 'start or resume the pomodoro timer ("запусти таймер", "start pomodoro")',
  pomodoro_pause: 'pause the pomodoro timer',
  add_note: 'add a note to an EXISTING task that is named or open (current); text = the note ("запиши к задаче …", "заметка к этой задаче: …"). No task named or open → capture_note instead',
  report_feedback: 'a bug report or an idea about THIS APP itself (its screens, buttons, behaviour) — not a task or note about life; said with "баг", "ошибка в приложении", "фидбек", "идея для приложения", "bug", "feedback", "app idea"; text = what they said without that word; target = "bug" or "idea"',
  capture_note: 'save a raw note / idea / thought to the Inbox to decide later — "заметка", "идея", "мысль", "запомни", "note", "idea", "capture", or a longer reflection / brainstorm that is not one clear action; text = a short title for it (≤ 8 words, speaker\'s language); the app keeps the full dictation',
  postpone: 'move one task to another date; task = named task or null for the current one; date required ("перенеси X на пятницу", "на завтра")',
  drop: 'drop / abandon a task — NOT done, just no longer relevant; task = named task or null for the current one ("удали задачу X", "неактуально", "drop it")',
  complete: 'mark one named task done ("закрой задачу X", "X сделано") — only outside focus or for a task other than the focused one',
  open: 'navigate; target = one of inbox|today|upcoming|agent|waiting|someday|logbook, or a project slug; or task = a task to open',
  process_inbox: 'go through inbox captures one by one ("разбери инбокс", "process inbox")',
  review_agents: 'review tasks the agents handed back, one by one ("что сдали агенты", "review agents")',
  breakdown: 'split a task into small steps/subtasks; task = named task or null for the current one ("разбей на шаги", "break it down")',
  why: 'explain why the current focus task is the most important one ("почему эта задача?", "why this one")',
  accept: 'REVIEW mode: accept the agent result; the task stays open and goes back to the owner ("принять", "ок, принимаю")',
  accept_close: 'REVIEW mode: accept the agent result AND complete the task ("принять и закрыть", "accept and close")',
  send_back: 'REVIEW mode: send the task back to the agent; text = the feedback ("верни: добавь цены")',
  item_to_task: 'INBOX mode: turn the current capture into a task for me ("в задачу", "сделай задачей")',
  item_to_agent: 'INBOX mode: turn the current capture into a task for an agent ("отдай агенту")',
  item_archive: 'INBOX mode: archive the capture, no action needed ("в архив", "не нужно")',
  item_trash: 'INBOX mode: throw the capture away ("удали", "в мусор")',
  undo: 'undo the last action ("отмени", "undo", "revert")',
  search: 'search open tasks and projects; text = what to look for ("найди страховку", "search douglas")',
  timeblock: 'block time in Google Calendar for a task; task = named task or null for the current one; date = the day; time = start time if said; minutes = duration if said ("заблокируй час завтра в 10 на это", "block 30 minutes for X on friday")',
  create_project: `create a NEW project; text = its name; target = category if said (${profile().categories.join('|')}) else null ("создай проект ремонт кухни", "new project …")`,
  set_project: 'put a task into a project; target = project slug; task = named task or null for the current one ("в проект туин", "это в personal os")',
};

const SCHEMA = {
  type: 'object',
  required: ['intent', 'tasks', 'command'],
  properties: {
    intent: { enum: ['tasks', 'command'] },
    tasks: { type: 'array', items: TASK_SCHEMA },
    command: {
      type: ['object', 'null'],
      required: ['name', 'task', 'text', 'date', 'target', 'time', 'minutes'],
      properties: {
        name: { enum: Object.keys(COMMANDS) },
        task: { type: ['integer', 'null'] },
        text: { type: ['string', 'null'] },
        date: DATE_SPEC_SCHEMA,
        time: { type: ['object', 'null'], properties: { hour: { type: 'integer' }, minute: { type: 'integer' } } },
        minutes: { type: ['integer', 'null'] },
        target: { type: ['string', 'null'] },
      },
    },
  },
};

const SYSTEM = `You interpret a short dictated utterance for Gubernos, a personal task app. It is EITHER new tasks to capture (intent "tasks") OR a command to the app (intent "command"). Commands are imperative requests about existing tasks or the app itself; anything describing things to do later is new tasks. A thought, idea or reflection to keep (not a clear action) is the capture_note command. If unsure between tasks and a note, choose "tasks".

Commands (fill command.name; unused fields null; tasks = []):
${Object.entries(COMMANDS).map(([k, v]) => `- ${k}: ${v}`).join('\n')}
command.task = the NUMBER of the task from the open-task list (match by meaning, any language); "это/эту/this/it" = the task marked (current). Never guess a number if no task matches — use null.

New tasks (intent "tasks"; command = null):
- One task per distinct action: every sentence or clause with its own verb and object is a separate task, even if the speaker switches language. A single action → exactly one task. Ignore filler and false starts.
- title: short, verb first, in the language the speaker used.
- notes: ONLY details the speaker actually said beyond the title (condensed, in their language). If they said nothing more, notes = "". Never add purposes, steps, explanations or your own wording of the goal. Do not repeat the project, dates, priority or owner.
- due: when to do it ("в среду", "tomorrow"). deadline: when the speaker says by when it must be done — "к …" ("к пятнице", "к 15 октября", "к концу месяца"), "до …", "не позже …", "by …", "before …", "no later than …", "uiterlijk …" — then put that date in deadline and leave due null. Never put the same date in both. No date said → null.
- project: a slug from the list only if the speaker clearly names that project; else null.
- assigned: "agent" if delegated to an agent/AI/Claude${profile().assistant ? `/${profile().assistant.name}` : ''}; "someone" if waiting on another person; else "me".
- priority: "urgent" only if said (срочно, urgent, ASAP, важно); "someday" for когда-нибудь/someday/maybe; else "planned".
- repeat: only if the task recurs ("каждый понедельник", "по будням", "каждый месяц 1-го", "раз в две недели", "every friday") — the phrase as said, in the speaker's words; else null. Keep it out of the title; due stays null unless a separate start date was said.
- time: only when a clock time is said for the task ("в 10", "в 10:30", "в 7 вечера" → 19:00, "в 3 дня" → 15:00, "at 3pm", "at 10") — as HH:MM, 24-hour; else null. It becomes a reminder; keep it out of the title and notes.

Dates (tasks and postpone): NEVER compute calendar dates. Describe what was said as a date spec; the app resolves it against the local clock.
  kinds: today · tomorrow · day_after_tomorrow (послезавтра) · in_days{n} · in_weeks{n} · in_months{n} ·
  weekday{weekday: mon..sun, week_offset} — "в среду"/"on wednesday"/"next wednesday" → week_offset 0 (nearest upcoming); "в субботу через неделю"/"a week from saturday" → 1 ·
  next_week (на следующей неделе, no day) · end_of_week (only for "конец недели"/"end of the week" said as such) · end_of_month · absolute{day, month, year only if said} ("5 октября" → day 5, month 10).
  A named weekday is always weekday{that day}, whatever the preposition: "к пятнице"/"до пятницы"/"by friday" → weekday fri, week_offset 0 — never end_of_week.
  Fill only fields that kind needs; others null.
Never invent facts, dates, projects or tasks.`;

// context: { mode: focus|inbox|review|null, focusTaskId, openTaskId, itemTitle, view }
export function interpret(text, context = {}) {
  const weekday = new Date().toLocaleDateString('en-GB', { weekday: 'long' });
  const projects = listProjects().filter((p) => p.status === 'active');
  const open = listTasks().filter((t) => t.status !== 'done');
  const current = context.focusTaskId || context.openTaskId || null;
  const list = open.map((t, i) => `${i + 1}. ${t.title}${t.project ? ` [#${t.project}]` : ''}${t.id === current ? ' (current)' : ''}`).join('\n');
  // AICODE-NOTE: dates are resolved by lib/dates.js on the local clock; the model only names them.
  const mode = context.mode ? ` The app is in ${String(context.mode).toUpperCase()} mode.` : '';
  const item = context.itemTitle ? ` Current inbox capture: "${context.itemTitle}".` : '';
  const prompt = `Today is ${weekday}.${mode}${item}
Projects: ${projects.map((p) => `${p.slug} (${p.title})`).join('; ') || 'none'}.
Open tasks:
${list || '(none)'}

Utterance:
"""${text}"""`;
  return ask({ system: SYSTEM, prompt, schema: SCHEMA }).then(({ output: r, cost }) => {
    if (process.env.GUBERNOS_VOICE_DEBUG) console.log('[voice] model', JSON.stringify(r));
    const now = new Date();
    if (r.intent === 'command' && r.command?.name) {
      const c = r.command;
      const t = Number.isInteger(c.task) ? open[c.task - 1] : null;
      const due = resolveDateSpec(c.date, now);
      const hh = Number.isInteger(c.time?.hour) && c.time.hour >= 0 && c.time.hour < 24 ? c.time.hour : null;
      const start = hh !== null ? `${due || localDate(now)}T${String(hh).padStart(2, '0')}:${String(Number.isInteger(c.time.minute) ? c.time.minute : 0).padStart(2, '0')}` : null;
      return { kind: 'command', name: c.name, taskId: t?.id || null, taskTitle: t?.title || null,
        text: c.text || null, due, target: c.target || null, start, minutes: Number.isInteger(c.minutes) && c.minutes > 0 ? c.minutes : null, cost };
    }
    const slugs = new Set(projects.map((p) => p.slug));
    // Haiku sometimes restates the title/project in notes; keep notes only if they add something.
    const cleanNotes = (t) => {
      const n = (t.notes || '').trim();
      const low = n.toLowerCase();
      if (!n || low.includes(t.title.trim().toLowerCase()) || t.title.trim().toLowerCase().includes(low)) return '';
      if (n.length < 60 && /(проект|project)/i.test(n)) return '';
      return n;
    };
    return {
      kind: 'tasks',
      tasks: (r.tasks || []).filter((t) => t.title?.trim()).map((t, _, all) => {
        const x = {
          title: t.title.trim(), notes: cleanNotes(t), due: resolveDateSpec(t.due, now), deadline: resolveDateSpec(t.deadline, now),
          priority: t.priority || 'planned', assigned: t.assigned || 'me',
          project: slugs.has(t.project) ? t.project : null, labels: t.labels || [],
          ...repeatOf(t, now),
        };
        // AICODE-NOTE: the model miscounts weekdays ("к субботе" on a Friday → "day after tomorrow"). With one task, the
        // date said is read by the same parser as quick add; "к/до/by …" makes it the deadline.
        const said = all.length === 1 && !x.recurrence ? parseDate(text, localDate(now)) : null;
        if (said?.by) { x.deadline = said.date; x.due = null; } else if (said) { x.due = said.date; if (x.deadline === said.date) x.deadline = null; }
        return { ...x, ...reminderOf(t.time, x.due, now) };
      }),
      cost,
    };
  });
}
