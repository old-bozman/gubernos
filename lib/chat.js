// "Ask" chat: a read-only session of the app's model (lib/llm.js) over the vault, primed with what's on the owner's screen.
// The agent never writes; it may propose actions, which the UI shows as buttons and executes via the normal API.
import fs from 'node:fs';
import path from 'node:path';
import { VAULT, getTask, listTasks, listProjects, listInbox, localDate, httpError, appendLog } from './vault.js';
import { resolveDateSpec, DATE_SPEC_SCHEMA } from './dates.js';
import { profile } from './config.js';
import { chatTurn, current } from './llm.js';

const ACTION = {
  type: 'object',
  required: ['type'],
  properties: {
    type: { enum: ['add_subtasks', 'set_due', 'set_deadline', 'create_task', 'add_note', 'timeblock', 'open_task', 'email', 'link_email', 'run', 'drop_decision', 'decision_to', 'set_woop'] },
    task_id: { type: ['string', 'null'] },          // null = the task in context
    items: { type: 'array', items: { type: 'string' } }, // add_subtasks
    text: { type: ['string', 'null'] },              // add_note, create_task title
    notes: { type: ['string', 'null'] },             // create_task
    project: { type: ['string', 'null'] },           // create_task: project slug
    date: DATE_SPEC_SCHEMA,                          // set_due, set_deadline, create_task, timeblock day
    time: { type: ['object', 'null'], properties: { hour: { type: 'integer' }, minute: { type: 'integer' } } },
    minutes: { type: ['integer', 'null'] },          // timeblock
    to: { type: ['string', 'null'] },                // email
    cc: { type: ['string', 'null'] },                // email
    subject: { type: ['string', 'null'] },           // email, link_email
    body: { type: ['string', 'null'] },              // email: the full text, ready to send
    thread_id: { type: ['string', 'null'] },         // email (reply in this thread), link_email
    wish: { type: ['string', 'null'] },              // set_woop: the lines to set; null = leave as is
    outcome: { type: ['string', 'null'] },
    obstacle: { type: ['string', 'null'] },
    plan: { type: ['string', 'null'] },
  },
};
// Requests that need the full agent (web, writing files). Used only as a fallback when the model proposed nothing.
const DO_RE = /(найди|найти|поищи|поиск|исследуй|разузнай|собери|сравни|проверь в интернете|запиши|сохрани|добавь в (?:заметки|задачу)|подготовь|составь и сохрани|\b(?:research|find|look up|search|compare|save|write down|record)\b)/i;
const SCHEMA = { type: 'object', required: ['reply', 'actions'], properties: { reply: { type: 'string' }, actions: { type: 'array', items: ACTION } } };

// the owner's name comes from profile.md; pronouns stay neutral
const system = (N = profile().name) => `You are ${N}'s assistant inside Gubernos, their personal system, talking about their tasks and projects.
You answer and propose actions; when they want something DONE that needs the web or writing files (find / look up / research /
compare / save / write down / prepare), you hand it to the full agent with the "run" action ("▶ Do it") — that agent CAN browse
the web and write to the vault. Never answer "I can't search the internet" or "I can't edit files": propose run instead.
The current directory is their vault (markdown is the source of truth): tasks in 10_tasks/, projects in 20_projects/,
goals in 30_goals/, reference notes in 40_reference/, the archive in 80_archive/. Rules and schemas are in CLAUDE.md and AGENTS.md.
You can READ files (search and open them) to answer; you can never write.
You can also READ ${N}'s Gmail, Google Calendar, Contacts and Drive with the gubernos-tools tools (gmail_search, gmail_thread, calendar_events,
contacts_search for someone's email address or who they are, drive_search / drive_read for documents).
Search queries go in the language of what you look for (file names are mostly English: "status-sync", not "статус-синк"); if a
search finds nothing, try again shorter or with another word before saying there is nothing.
Use them when they ask about mail/meetings or when a task clearly depends on an email (a sender, an invoice, "what did X write").
When citing an email, give sender, date and a markdown link to the thread ([subject](link)).

${N} sees ONLY the "reply" field — nothing you write outside it. Put the full content they asked for (a draft, an ad, a list,
an email text) in "reply" itself, complete and ready to copy; never refer to text "above" or "earlier".
ALWAYS reply in the language of ${N}'s latest message (Russian → Russian, English → English, Dutch → Dutch). Be brief and concrete: a few sentences or a short list; no preamble, and never narrate what you're doing ("Reading the task…", "Читаю задачу…") — just answer.
When a change would help, propose it in "actions" (the app shows each as a button ${N} may tap):
- add_subtasks {task_id|null, items[]}   - set_due / set_deadline {task_id|null, date}
- create_task {text (title), notes, project slug|null, date|null}   - add_note {task_id|null, text}
- timeblock {task_id|null, date, time {hour, minute}, minutes}   - open_task {task_id}
- email {to, cc|null, subject, body, thread_id|null, task_id|null} — a complete email draft ${N} reviews, edits and sends themselves.
  Replying: set thread_id, to = the person to answer (their address from the thread); subject may be null.
  The email body is in the language the thread is written in (a Dutch thread → Dutch), NOT the language ${N} spoke to you;
  ${N}'s voice, signed "${N.split(/\s+/)[0]}", no placeholders. In the reply say the draft is ready for review ("Черновик ниже — проверь и отправь"),
  never that you send or sent it.
- link_email {task_id|null, thread_id, subject} — keep a link to the thread in the task (## Mail).
- set_woop {task_id|null, wish, outcome, obstacle, plan} — write lines of the task's ## WOOP (null = leave that line as is).
- run {task_id|null, text} — "▶ Do it": hand real work to a full agent that CAN search and read the web, read
  Gmail/Calendar, and write vault files (save texts into the task, create reference notes, record research). It runs a few
  minutes and reports back in this chat. text = exactly what to do, self-contained.
  Propose it when ${N} asks you to do / make / write / save / research something that your other actions can't do;
  you can't do such work yourself here. In the reply say what the agent will do and that it starts with the button ("Агент найдёт … — кнопка ▶ Do it ниже"), never that it's already done.
task_id null = the task in context; with no task in context, run starts a new task for the work (the app creates it), so propose it there too.
Use real task ids from the context or from files you read (the filename without .md).
Dates: NEVER compute calendar dates or weekdays yourself — in text, look them up in the calendar given in the context; in actions describe them as a date spec (today, tomorrow, weekday{weekday, week_offset}, in_days{n}, absolute{day, month}, …); the app resolves them.
If ${N} asks to change something ("поставь срок", "добавь шаги", "создай задачу", "перенеси", "set the due date", "block time"),
you MUST return the matching action — the reply alone changes nothing. This holds even when the same message also asks a
question: answer it AND include the action (e.g. "suggest a day and set the due date" → pick the day, return set_due for it). Example: "поставь срок на понедельник" →
actions: [{"type": "set_due", "task_id": null, "date": {"kind": "weekday", "weekday": "mon", "week_offset": 0}}].
When you recommend a specific day or time for a task, also propose set_due (or timeblock if a time was discussed).
Never tell ${N} to copy, paste or edit files themselves, and never say you can't edit files or search the internet — propose the action that does it:
saving a text / draft / answer into the task → add_note with the FULL text; anything bigger (write files, research and record,
change several things) → run. "сохрани в задачу", "запиши", "добавь в заметки", "save it to the task" = add_note.
Propose at most 3 actions and only when they clearly follow from the conversation.
You never change anything yourself: phrase actions as proposals ("Предлагаю понедельник — кнопка ниже"), never as done ("Срок перенесён").`;

function taskSummary(t, full = false) {
  const bits = [`${t.title} (id ${t.id})`, `status ${t.status}`, `priority ${t.priority}`, `owner ${t.assigned}`];
  if (t.project) bits.push(`project ${t.project}`);
  if (t.due) bits.push(`due ${t.due}`);
  if (t.deadline) bits.push(`deadline ${t.deadline}`);
  if (t.checks.total) bits.push(`steps ${t.checks.done}/${t.checks.total}`);
  if (t.moved) bits.push(`due date pushed later ${t.moved} time${t.moved === 1 ? '' : 's'} after it had come`);
  return full ? `${bits.join(' · ')}\nFile: ${t.file}\n${t.body.replace(/<!--[\s\S]*?-->/g, '').slice(0, 5000)}` : `- ${bits.join(' · ')}`;
}

// "✦ Discuss" on a task's WOOP block: coach it step by step; the options come back as set_woop buttons.
const woopCoach = (N = profile().name) => `${N} wants to WOOP this task with you (Gabriele Oettingen's mental contrasting): Wish → Outcome → Obstacle → Plan.
Go one step at a time, from the first line missing in the task's ## WOOP section (all four set → ask which one to sharpen).
For the current step give 2–3 concrete options, short, in ${N}'s voice, and propose each as a set_woop action with only that line set:
the buttons are the options; ${N} may also answer in their own words. Ask one short question; no lecture about the method,
and never mention files or sections (say "the wish", not "## WOOP").
- Wish: specific and checkable, with a date when it has one.
- Outcome: the best thing about having it done, felt and personal, one line.
- Obstacle: something in ${N}, not outside: a habit, an emotion, a belief, a distraction (never "no time"). Read the task's history
  (how often it was pushed later, notes, chat, steps left) and say in a few words what you base an option on.
- Plan: "If <the obstacle> → then I <one small action that takes under a minute>".
A message like "Wish: …" / "Outcome: …" is an option ${N} picked: it is already saved, so don't propose it again; go to the next step.
You never write anything yourself: never say a line was recorded or saved by you.
When ${N} answers in their own words, propose set_woop with that line as they said it (tidied) plus up to 2 options for the next step.
Once all four lines are set, say the plan in one line and stop.`;

// ctx: {taskId?, project?, view?, woop?}
export function contextText(ctx = {}) {
  const today = localDate();
  // AICODE-NOTE: the model miscounts weekdays even in prose; give it a calendar to look up.
  const cal = Array.from({ length: 15 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${localDate(d)}`; }).join(', ');
  const head = `Today is ${new Date().toLocaleDateString('en-GB', { weekday: 'long' })} ${today}. Calendar: ${cal}.`;
  const open = listTasks().filter((t) => t.status !== 'done');
  if (ctx.taskId) {
    const t = getTask(ctx.taskId);
    return `${head}\n${profile().name} is looking at this task:\n${taskSummary(t, true)}${ctx.woop ? `\n\n${woopCoach()}` : ''}`;
  }
  if (ctx.decision) {
    const f = path.join(VAULT, '05_model', 'decisions', `${ctx.decision}.md`);
    if (!fs.existsSync(f)) throw httpError(404, 'decision not found (already recorded?)');
    return `${head}\n${profile().name} is looking at an open decision they have to make (file 05_model/decisions/${ctx.decision}.md). Help them think it through:
answer their questions, weigh the options against the criteria, point out what's missing. They record a choice themselves with the buttons in the app.
If they say it isn't a decision for them (not their level, nothing to choose, just to know), propose drop_decision {text: short reason}.
If it is really a task, a project or a goal, propose decision_to {text: "task" | "project" | "goal"}.
You can't change anything yourself: never say it was or will be removed, archived or recorded by you — say the button below does it ("Tap ✕ Not a decision to close it").\n\n${fs.readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, '').slice(0, 8000)}`;
  }
  if (ctx.itemId) {
    const it = listInbox().find((x) => x.id === ctx.itemId);
    if (!it) throw httpError(404, 'note not found (already processed?)');
    return `${head}\n${profile().name} is clarifying an unprocessed Inbox note (clarify: decide what it is — a task, a project, reference, someday, or trash).
Note "${it.title}" (file ${it.file}, source ${it.source || 'manual'}${it.sender ? `, from ${it.sender}` : ''}, ${it.date || ''}):\n${it.body.slice(0, 5000)}
Help them decide and phrase the next action; propose create_task when it's actionable (it clears the note).
Active projects: ${listProjects().filter((p) => p.status === 'active').map((p) => p.slug).join(', ')}`;
  }
  if (ctx.project) {
    const p = listProjects().find((x) => x.slug === ctx.project);
    if (!p) throw httpError(404, 'project not found');
    const tasks = open.filter((t) => t.project === p.slug);
    return `${head}\n${profile().name} is looking at the project "${p.title}" (slug ${p.slug}, category ${p.category}${p.goal ? `, goal ${p.goal}` : ''}); file ${p.file}.\nOpen tasks:\n${tasks.map((t) => taskSummary(t)).join('\n') || '(none)'}`;
  }
  const due = open.filter((t) => t.due && t.due <= today);
  return `${head}\n${profile().name} is on the ${ctx.view || 'today'} view. Open tasks due today or overdue:\n${due.map((t) => taskSummary(t)).join('\n') || '(none)'}\nProjects: ${listProjects().filter((p) => p.status === 'active').map((p) => p.slug).join(', ')}`;
}

export function ask({ message, context = {}, session = null, deep = false, persist = false, attachments = [] }) {
  const files = (Array.isArray(attachments) ? attachments : []).filter((a) => a?.path).slice(0, 6);
  if (!String(message || '').trim() && !files.length) throw httpError(400, 'message required');
  // First turn carries the screen context; follow-ups resume the same session.
  // AICODE-NOTE: the vault context is mostly Russian/Dutch, so the model drifts to the wrong language; decide it here.
  const msg = String(message);
  const lang = /[а-яё]/i.test(msg) ? 'Russian'
    : /\b(de|het|een|ik|niet|wat|hoe|wanneer|moet|kun|kan je|graag|welke|waarom)\b/i.test(msg) ? 'Dutch' : 'English';
  const att = files.length ? `\n\nAttached files (open them — images and PDFs too):\n${files.map((a) => `- ${a.path}`).join('\n')}` : '';
  const tagged = `${msg || '(see the attached files)'}${att}\n\n(Reply in ${lang}; email drafts go in the thread's language.)`;
  const prompt = session ? (context.woop && context.taskId ? `${woopCoach()}\n\n${tagged}` : tagged) : `${contextText(context)}\n\n${profile().name} asks:\n${tagged}`;
  // one retry with a nudge when the model answers in prose instead of the structured reply (see lib/llm.js)
  const attempt = (text, retried) => chatTurn({ system: system(), prompt: text, schema: SCHEMA, session, deep, cwd: VAULT }).then((d) => {
        const r = d.output;
        const now = new Date();
        if (process.env.GUBERNOS_DEBUG_CHAT) console.log('[chat raw actions]', JSON.stringify(r.actions));
        const actions = (r.actions || []).slice(0, 3).map((a) => {
          const date = resolveDateSpec(a.date, now);
          const hh = Number.isInteger(a.time?.hour) ? a.time.hour : null;
          return {
            type: a.type, taskId: a.task_id || context.taskId || null, items: a.items || [], text: a.text || null, notes: a.notes || null,
            project: a.project || context.project || null, date,
            start: date && hh !== null ? `${date}T${String(hh).padStart(2, '0')}:${String(a.time.minute || 0).padStart(2, '0')}` : null,
            minutes: Number.isInteger(a.minutes) ? a.minutes : null,
            ...(a.type === 'run' ? { text: a.text || msg } : {}),
            ...(context.decision ? { decision: context.decision } : {}),
            ...(a.type === 'set_woop' ? { woop: Object.fromEntries(['wish', 'outcome', 'obstacle', 'plan'].filter((k) => a[k]?.trim()).map((k) => [k, a[k].trim()])) } : {}),
            ...(a.type === 'email' || a.type === 'link_email'
              ? { to: a.to || '', cc: a.cc || '', subject: a.subject || '', body: a.body || '', threadId: a.thread_id || null } : {}),
          };
        }).filter((a) => (a.type === 'set_due' || a.type === 'set_deadline' ? !!a.date : a.type === 'link_email' ? !!a.taskId && !!a.threadId : a.type === 'run' ? true : a.type === 'drop_decision' || a.type === 'decision_to' ? !!context.decision
          : a.type === 'set_woop' ? !!a.taskId && Object.keys(a.woop).length > 0 : true));
        // Haiku sometimes refuses work it can't do itself ("I can't search the web") instead of handing it over — offer the run.
        // Without a task in context the run gets a new task (the app creates it from the text, or from the Inbox note).
        // It also promises "▶ Do it below" without returning the action — add the button it meant.
        if (!actions.some((a) => a.type === 'run') && ((!actions.length && DO_RE.test(msg)) || /Do it/i.test(r.reply))) {
          actions.push({ type: 'run', taskId: context.taskId || null, items: [], text: msg, project: context.project || null });
        }
        // Haiku sometimes answers "set the due date" with only a time block — add the due-date button it meant.
        if (/срок|дедлайн|due|deadline/i.test(message) && !actions.some((a) => a.type === 'set_due' || a.type === 'set_deadline')) {
          const dated = actions.find((a) => a.date && a.taskId);
          if (dated) actions.unshift({ type: /дедлайн|deadline/i.test(message) ? 'set_deadline' : 'set_due', taskId: dated.taskId, items: [], date: dated.date });
        }
        // Task chat keeps its history in the task file (## Chat), so it's visible in Obsidian and seen by the next session.
        // the model tends to say "Searching…" as if the agent were already on it: make clear the button starts it
        if (actions.some((a) => a.type === 'run') && !/Do it/i.test(r.reply)) r.reply = `${r.reply.trim()}\n\n_▶ Do it below starts the agent — nothing runs until you tap it._`;
        if (persist && context.taskId) {
          appendLog(context.taskId, profile().id, [msg, ...files.map((a) => `📎 [[${a.name}]]`)].filter(Boolean).join('\n'), 'Chat');
          appendLog(context.taskId, current(), r.reply, 'Chat');
        }
        return { reply: r.reply, actions: actions.slice(0, 3), session: d.session, cost: d.cost };
  }, (e) => {
    if (!retried) return attempt(`${text}\n\n(Answer with the structured output: reply + actions. If something is missing, answer from what you have.)`, true);
    console.error('[chat] failed:', String(e.message).slice(0, 200));
    throw httpError(502, 'The agent couldn’t answer this time — try again');
  });
  return attempt(prompt, false);
}
