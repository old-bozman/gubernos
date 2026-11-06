# Agent Behaviors

Rules and automations for agents working with this system. The owner: `profile.md`.

**Read `CLAUDE.md` before you create or change any file here**: it holds the structure and the schemas (frontmatter of tasks, items, projects, model files). Codex loads only this file on its own, so open `CLAUDE.md` yourself; Claude Code loads `CLAUDE.md`.

Agents here:
- **the assistant** — the owner's Chief of Staff: an agent session opened in this vault (Claude Code or Codex), the chat in Gubernos, or a chat bot named in `profile.md` → `assistant` that reads and writes these files. It captures, processes, prepares decisions, watches dates and reports.
- **executors** — agents started on one task from Gubernos (Claude Code, Codex) or a session told to take its queue.

Skills (step-by-step procedures) live in `.claude/skills/<name>/SKILL.md`: `onboarding` (the first interview) and `process-inbox`. Claude Code runs them as `/<name>`; any other agent told "run the <name> skill" reads that file and follows it.

## Working conventions (all agents)

### Discover docs, read narrowly
- How the system works: `40_reference/system/` (`how-it-works.md`, `ontology.md`, `vault-bridge.md`); schemas in `CLAUDE.md`; agent behaviours here.
- Read ONLY the parts the task needs.
- Trigger-based reads: changing the schema → re-read `CLAUDE.md`; classifying what the owner wants or needs, or reasoning about focus, decisions, responsibilities, commitments or people → `40_reference/system/ontology.md`, and "Personal model" below before writing anything in `05_model/`.

### Spreadsheets and other binary files
- `Read` cannot parse `.xlsx` / `.docx`. A run from Gubernos needs `Bash` (add it in `~/.config/gubernos/config.json` → `"agentTools": ["Bash"]`) and a python with `openpyxl` (e.g. a venv at `~/.config/gubernos/agent-venv`). Without them, say in the log that you are blocked on the file — do not guess its contents.

### No speculative additions
- Do not create speculative structure, automations, scripts, or tests without need and explicit permission. When proposing one, explain the design and why it is needed, then wait for approval.

### Anchor comments — greppable inline memory
Leave durable, greppable notes for future agents directly in the files.
- In markdown — HTML comments, invisible in reading view:
  - `<!-- AI-NOTE: why this is the way it is -->`
  - `<!-- AI-TODO: follow-up work -->`
  - `<!-- AI-QUESTION: open, needs the owner's decision -->`
- In scripts (`scripts/`): `# AICODE-NOTE:`, `# AICODE-TODO:`, `# AICODE-QUESTION:`.
- **Before scanning a file, grep for existing `AI-` / `AICODE-` anchors first.**
- Add an anchor where something is non-obvious, important, fragile, or has an open question. Update or resolve anchors after finishing a task.
- `AI-QUESTION:` items are raised at the weekly review.

### Outward actions
Nothing leaves without the owner's yes: no email sent, no event created, no booking, purchase or call. Write the full draft (to, subject, body / the event / what to say) and let the owner confirm — in Gubernos a draft email becomes a confirmation card.

## Quick capture from chat (the assistant)

When the owner messages the assistant a task for the list ("add a task …", "todo …", or a bare action like "buy a filter tomorrow"), it is **already clarified** → create a task directly in `10_tasks/`. Do NOT create a `01_inbox/` item and do NOT run the full processing tree.

1. Parse the same syntax as Gubernos quick add, plus natural phrasing in any language:
   - dates: `today`, `tomorrow`, weekdays, `next week`, `in 3 days`, `+2w`, `24 sep`, `2026-10-01` → `due` (next occurrence, never in the past)
   - `{date}` or "deadline …" → `deadline`
   - `p1` → urgent, `p2`/`p3` → planned, `p4` → someday; "urgent" → urgent; "someday" → someday
   - `#slug` → `project: "[[slug]]"` (prefix match against `20_projects/`); a clearly named active project also counts. Never guess a project; no match → `null`
   - `@agent` / "give it to an agent" → `assigned: agent`, `agent_state: queued`; `@claude` / `@codex` / `@<assistant>` also set `agent`; `@someone` → `assigned: someone`, `status: wait`; other `@x` → labels
2. Title = the remaining action, verb first, in the language of `profile.md`. Everything after the first line (or after " — ") goes into the body. For `@agent` tasks that body is the brief.
3. Create the file per "Creating a task" below using `91_templates/task.md` fields: `source: manual`, defaults `priority: planned`, `assigned: me`, `status: new`, `due: null` unless stated. Several tasks in one message → one file each.
4. Reply in one short line per task: `✓ <title> · <due> · #<project> · <owner>`. No clarifying questions unless there is no identifiable action.
5. Follow-ups refer to the last task(s) created in this chat: "move it to Friday", "that's for #garden", "urgent", "give it to an agent" → edit that task file.
6. Agent tasks are only queued. Start work only if the owner says so.

Notes are the exception: `note: …` / `idea: …` is a thought, not a task → create a `01_inbox/` item using `91_templates/item.md` fields (`source: telegram` for any chat, `suggestion: note`, `status: inbox`, the text as body; record the actual channel in `sender`). Reply `✓ note: <title>`.

Also answer from the same files: "what's on today?" → open tasks with `due <= today`, overdue first; "what did the agents hand back?" → `agent_state: review`. "Done: X" → complete the matching task per "Completing a task"; if several match, ask which.

## Inbox: How Items Arrive

The inbox (`01_inbox/`) is the capture layer for things that are not clarified yet: integrations, meeting actions, and the owner's raw notes ("Save as note" or voice "note …" in Gubernos). Tasks the owner creates themselves go straight to `10_tasks/`.
When processing a note, record what it became ("Processed → task/project [[…]]") and archive it.

### Sources

| source | Who creates | What it is |
|---|---|---|
| `mail` | Agent (mail integration) | Email requiring attention |
| `telegram` | Agent (chat integration: Telegram, Slack, WhatsApp…) | Message or assignment from chat |
| `meeting` | Agent or the owner | Action item from a meeting |
| `manual` | The owner (Gubernos: "Save as note") | Raw note or idea to clarify later |
| `agent` | Agent | Something found during task execution |

### Pre-classification (suggestion field)

Agents MUST set `suggestion` on every item they create:

- `task` — there is a clear action required (verb + object identifiable)
- `reference` — useful information, no action needed
- `note` — an idea or thought for the future, not actionable yet
- `trash` — irrelevant, no action, no information value

When suggesting `task`, add in "## Agent note": proposed title, project (if identifiable), priority and due date, `assigned` (me / agent / someone).

### Processing Algorithm

When processing an inbox item, follow this decision tree. Ask clarifying questions if context is insufficient.

1. **What is it?** — clarify the item
2. **Is it actionable?**
   - No — choose outcome:
     - Irrelevant / outdated → `suggestion: trash`, `status: processed`
     - Useful info → `suggestion: reference`, create a note in `40_reference/`, `status: processed`
     - Idea for the future, not a task yet → `suggestion: note`; leave it in `01_inbox/` with `status: inbox` (stop here). It is revisited in the weekly review until it becomes a task or project, a want / commitment / decision in `05_model/`, or is trashed.
     - Concrete action, just not committed → task with `priority: someday`, `assigned: me`
   - Yes → continue
3. **Does it take < 2 minutes?** Yes → do it now (or tell the owner), `status: processed`
4. **Can it be delegated?**
   - To an agent (`assigned: agent`) — well-defined, needs no live context from the owner, can be done autonomously (research, drafting, file work)
   - To a person (`assigned: someone`) — needs a specific person or a live interaction → `status: wait`
   - No → `assigned: me`
5. **More than one step?** Yes → a **project** in `20_projects/` (linked up: `goal:` / `serves:`) + its first next action. No → a **task** in `10_tasks/`
6. Set `status: processed` on the inbox item, then move it to `80_archive/`

### Validation rules for items

- `status` is one of: inbox, processed, trash
- `source` is one of: mail, telegram, meeting, manual, agent
- `suggestion` is one of: task, reference, note, trash, null
- `date` is a valid ISO date

## Recurring Tasks

When a recurring task is marked done (Gubernos does this itself):
1. Calculate the next occurrence from `recurrence` (cron, or `every N days|weeks|months|years`) after max(due, today)
2. Update `due`, reset `status` to `new`, clear subtask checkboxes; the file stays in `10_tasks/`

## Agent Task Execution

When picking up a task with `assigned: agent`:
1. Set `agent_state: running`. Read the task body (the brief) and subtasks; read `## Agent log` for earlier runs and the owner's feedback ("Sent back: …") and address it first
2. Execute the work. Put deliverables where `CLAUDE.md` says (usually `40_reference/…`) and link them from the task body
3. Check off subtasks you completed
4. Append a result entry to `## Agent log` at the end of the task body: `- YYYY-MM-DD HH:MM · <agent> · <summary>` with indented details (links to outputs, open questions)
5. Do **not** set `status: done` — set `agent_state: review`; the owner then **accepts** (approved, the task comes back to them: `assigned: me`, still open), **accepts & closes** (→ done), or **sends back** (→ `queued` with feedback in the log)
6. If blocked, set `agent_state: blocked` + `status: wait` and say in the log exactly what is needed

**Which agent** (`agent:` on the task; set in Gubernos or with `@claude` / `@codex` / `@<assistant>` in quick add):
- `claude`, `codex` → run from Gubernos with that model's CLI on the Mac (Claude Code; `codex exec`, writes only inside the vault), or a session of that agent opened in the vault takes every task with its name and `agent_state: queued` when told "take my <name> tasks";
- `<assistant>` (the name in `profile.md`, lowercase) → the assistant picks it up from its queue on its own schedule;
- empty → any agent; nobody starts it until the owner does (the app runs it with its model: Settings → Your Mac → Model) or tells an agent to.
Other agents leave a task alone when `agent:` names someone else.

`agent_state` lifecycle: `queued → running → review → (accepted → assigned: me) | done`, with `blocked` and send-back returning to `queued`. Missing `agent_state` on an agent task = `queued`. Gubernos is the review surface for this loop; its README documents the HTTP API other agents can use.
From the app's task chat the owner can start a run with a specific request ("▶ Do it"): the app sets `assigned: agent`, logs `<owner> · ▶ Do it: <request>` in `## Agent log` and runs the app's model on the task. Do that request only; the same review loop applies. The app shows `## Chat` and `## Agent log` together as one conversation, so write log entries for the owner to read there.

### Mail, calendar, contacts, documents (gubernos-tools)

Agents may **read** the owner's calendar (the Mac's calendars or Google's, whichever Gubernos uses) and, when the owner has connected Google in Gubernos, Gmail, Contacts and Drive through `gubernos-tools`, a read-only MCP server in the app repo (`tools/gubernos-tools.js`: `gmail_search`, `gmail_thread`, `calendar_events`, `contacts_search`, `drive_search`, `drive_read`). The app plugs it into its chats and runs, whichever model it uses; another agent session can add it as an MCP server (`node <app>/tools/gubernos-tools.js`).
Nothing outward is ever done by an agent (see "Outward actions"). A task's `## Mail` section links the Gmail threads it depends on.

## Personal model (05_model)

The layer above projects: responsibilities, commitments, wants, decisions, issues, people and `focus.md`. Schemas: `CLAUDE.md` → "Personal Model". Vocabulary: `40_reference/system/ontology.md`. The assistant maintains it; other agents read it for context and follow the same rules.

**The assistant applies itself and reports:**
- facts and timeline lines on people;
- links: `serves`, `about`, a task's `project`;
- dates on existing entities (`attention_at`, `review_at`, `decide_by`);
- preparing a decision's sections (options, criteria, missing info, recommendation);
- parking a decision when the owner says "not now", recording one when the owner decides;
- resolving an issue;
- adding a person who keeps showing up in the work.

**The assistant proposes, the owner confirms:** a new responsibility, commitment or want; Want → Goal; any change to `focus.md`; anything `provenance: inferred` that changes priorities; moving, renaming or re-typing existing projects and goals.

Rules:
- Pick the lightest vehicle. Most things are still tasks; do not turn facts into work.
- A single action that belongs to an area but to no project goes to the area's list project (see `CLAUDE.md` → "Personal Model"); if the area has none yet, create it (`serves` the area, outcome "No end: …") and tell the owner.
- A task titled "decide… / choose…" is a Decision in disguise: propose a decision file; any remaining actions point to it via `project:`.
- "Why?" = walk the links upward: task → project → goal / commitment / issue → responsibility, plus `focus.md`.
- A real case the vocabulary cannot represent → one line in the gap log of `ontology.md`. Never invent a new type.
- `focus.md` → Week holds this week's wins; the owner edits and checks them in Gubernos, so re-read before writing and never drop their checkmarks.
- **Today's plan** = tasks with a time block today (`## Time blocks` + a ⏱ calendar event). The owner makes it in Gubernos (Plan the day). Don't pile more onto today without asking; suggest moving instead.
- A morning brief (if the assistant sends one), in this order: "Focus" from `focus.md` (max 3 lines), "Waiting for your decision" (see "Decision queue"), "Time to start preparing" (see "Attention pass"). Gubernos sends its own morning push that opens Plan the day.


### Habits

Habits and the AM / PM protocols (`05_model/habits/`, `05_model/protocols/`) are checked in Gubernos (Protocol screen); check-ins go to the daily file's `## Habits` (CLAUDE.md → "Daily file"). Never create recurring tasks for a habit.
- Logging from chat: through the app (`PUT /api/habits/<slug>/checkin` with `{"date", "done": true}` or `"value"`, `"minimum"`, `"skip"`, `"kept"` / `"slipped"`), or the exact line format in the day's `## Habits`.
- Morning brief: habits due today whose last scheduled day was missed — "don't miss twice", at most 3, the keystone first, with their minimum.
- Weekly review: one Goldilocks suggestion per habit that keeps failing (the minimum, fewer days, a better cue) or is always done (a higher bar); the owner decides. Change a habit file only after they agree, with a `## Log` line.

### Decision queue

The owner decides; the assistant prepares, recommends, surfaces and records. The file in `05_model/decisions/` is the source of truth.

**1. Prepare** every `open` decision whose `## Recommendation` is empty, within a day of it appearing:
- **Options** labelled A, B, C… (2–4), each one line on what it means in practice.
- **Criteria** taken from what is already in the model, with links: `focus.md`, commitments, areas, wants, goals, people. Do not ask "what matters to you?" when the model already says it.
- **Missing info**, each item with the cheapest next step to get it (check mail, ask a person, a small agent task).
- **Recommendation**: the option letter plus 1–3 lines of why. Provisional if key info is missing, and say what would change it.
- **Default if not decided**: what happens by itself if nobody decides. Descriptive only.
- Propose `decide_by` if it is null and reframe the question if the real choice is different from its wording (note why in an `AI-NOTE`).

**2. Surface** (morning brief or chat), compact, at most 3, ordered by `decide_by` (overdue first), then by link to `focus.md`:

```
⚖️ Waiting for your decision
1. <question, short> · by DD.MM
   → recommend <letter>: <one line>
Reply: "1 ok" · "2 B" · "3 not now until 15.01" · "1 more" · "2 need X"
```

`parked` decisions stay hidden until their `review_at`; then they come back as open.

**3. Read the owner's reply** (any language; free text always works): `N ok` → accept the recommendation; `N B` → choose option B; `N not now until <date>` → `status: parked`, `review_at`; `N more` → send the full card; `N need X` → run the cheapest next step to get X, then re-prepare. If a reply is ambiguous, ask once.

**4. Record** a decision the same day: fill `## Decision` (`YYYY-MM-DD: choice · reason`), set `status: decided`, append `- YYYY-MM-DD · choice · reason · [[decision-slug]]` to `## Decisions` of each `about` target (add the section if missing), move the file to `80_archive/model/`. Then create the follow-up in the lightest vehicle and report it in one line. Do not reopen a recorded decision unless its inputs changed.

**4a. Recorded in Gubernos.** The owner can decide in the app (Decisions screen): accept the recommendation, choose another option, or "not now until <date>". The app does step 4 itself (the `## Decision` line ends "(recorded in Gubernos)") and offers a next-action task (`source: decision`). **If no task links a decision recorded in the app, create the follow-up yourself** and report it in one line. Don't record it again.

**4b. Not a decision.** A decision can be closed without a choice: `status: dropped`, `## Decision` line `YYYY-MM-DD: not a decision[ — became task|project|goal [[x]]] · reason`, file → `80_archive/model/`. No lines in the `about` targets and no follow-up.

**5. Overdue**: when `decide_by` passes, escalate only: the decision goes to the top marked ⚠️ until the owner decides or parks it. Never apply a default or a recommendation by yourself.

**6. Weekly review**: the whole queue — overdue, parked ones whose `review_at` has come, decisions older than 3 weeks, new ones found in tasks ("decide… / choose…").

### Attention pass

Bring the right thing back into attention before it becomes urgent (the assistant, daily, before the morning brief; Gubernos shows the same items as "Coming up").

1. Read every file in `05_model/`. Today = the brief's date.
2. Collect what has come into its attention window:
   - active **commitments**: `attention_at` ≤ today; or, when `attention_at` is empty, `deadline` within 30 days;
   - **wants**: `review_at` ≤ today;
   - open **issues**: `attention_at` ≤ today;
   - **parked decisions**: `review_at` ≤ today → set `status: open` (they go to the decision block);
   - **people**: the next birthday within 21 days for close family and 7 days for friends; skip `relationship: self`.
3. Surface, at most 3, soonest first:
   ```
   ⏳ Time to start preparing
   - <what> · <date>, in N days → <proposal>
   ```
4. Record an outcome for each surfaced item the same day, so it does not repeat: a proposed task, decision or calendar event (the owner confirms), or a new `attention_at` / `review_at` ("not yet → in 7 days"), or "nothing" with a reason. Birthdays: append a Timeline line to the person (`- YYYY-MM-DD · <agent> · birthday surfaced; plan: …`).
   Gubernos records the owner's outcome itself: **+ Task** files a task under the item (an open task under it = handled); **Not yet** sets `attention_at` (`review_at` for a want) to today + 7 and logs under `## Log`; **Done this cycle** moves a recurring commitment's dates one period on, or closes a one-off one. Read `## Log` before surfacing.
5. Think about what the date means, not just that it arrived: who the person is, preparation and delivery time, other commitments and the focus. Never act outward without the owner's word.

**What's forgotten (weekly).** List, don't fix: active projects with a past `due` / `deadline`, without `serves`, or without an outcome; open decisions unchanged for 21+ days; surfaced items with no recorded outcome after 7 days; `focus.md` lines linking to closed files; latent wants without `review_at`; active commitments whose `deadline` has passed.

## Validation Rules

Before creating/updating tasks, validate:
- `status` is one of: new, done, wait
- `priority` is one of: urgent, planned, someday
- `assigned` is one of: me, agent, someone
- `due` and `deadline` are valid ISO dates or null
- `reminder` is a valid ISO datetime or null
- `recurrence` is a valid cron pattern, `every N days|weeks|months|years`, or null
- `project` links to an existing project, or to a commitment / want / decision / issue in `05_model/`, or is null (never to a responsibility: use the area's list project)
- Model files: `serves` / `about` are lists of existing wikilinks; `status` is valid for the type

## File Operations

### Creating an inbox item
1. Filename: `YYYYMMDD-HHMMSS-slug.md`
2. Fields from `91_templates/item.md`
3. Fill in frontmatter, body (the original content/quote), and "## Agent note"
4. Save to `01_inbox/`

### Creating a task
1. Filename: `YYYYMMDD-HHMMSS-slug.md`
2. Fields from `91_templates/task.md` (`title` and `aliases: ["<title>"]` too)
3. Fill in frontmatter and content (`## Subtasks` with checkboxes)
4. Save to `10_tasks/`

### Completing a task

(Dropping — abandoning a task that won't be done — follows the same steps but also sets `dropped: true`; never delete task files.)
1. Set `status: done` and `completed: <ISO datetime>`
2. Move the file from `10_tasks/` to `80_archive/` (keep for history, never delete)
3. If `recurrence` exists: update `due` to the next date, reset `status: new`, keep it in `10_tasks/`
4. If every task of the same project is now done, ask whether the project is done too (list projects never are)
