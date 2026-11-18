// A dictated utterance → new tasks or a command to the app, by the app's model (lib/llm.js). Split from lib/voice.js
// (transcription, which needs the computer) so the iPhone app runs it too with no Mac (scripts/build-local.mjs MODEL), on
// the text its own speech recognition heard.
import { ask } from './llm.js';
import { listProjects, listTasks, localDate } from './vault.js';
import { resolveDateSpec, DATE_SPEC_SCHEMA } from './dates.js';
import { parseRepeat } from '../public/recur.js';
import { parseDate } from '../public/parse.js';
import { profile } from './config.js';

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

export const SCHEMA = {
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
        const y = { ...x, ...reminderOf(t.time, x.due, now) };
        // AICODE-NOTE: 2026-11-16 Alex: a task said without a date got none and was forgotten ("я забываю её сказать, а у
        // меня никто не спрашивает"). No date, no deadline, no repeat → today; "someday" stays undated.
        if (!y.due && !y.deadline && !y.recurrence && y.priority !== 'someday') y.due = localDate(now);
        return y;
      }),
      cost,
    };
  });
}
