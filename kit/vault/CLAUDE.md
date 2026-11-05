# Claude Instructions for Gubernos

This is a personal system (tasks, projects, goals, habits and the model of a life) in plain markdown files. You have full read/write access.
The vault is a folder on the Mac (`~/Gubernos` by default); the phone gets a copy from the Mac and its changes go through the Mac. Some people keep it in iCloud (iCloud Drive or Obsidian's iCloud folder): then files written on another device may arrive a little later, and a file can be offloaded until it is read. The app keeps a daily copy of the .md files in `~/.gubernos/backups/YYYY-MM-DD/` (14 days, 8 weeks): restore a file from there.
Who it belongs to, their language, life categories and working hours: `profile.md` (read it first).
The owner works in Gubernos (a web app over these files, installed from the gubernos repo); agents work the files directly.
Agent behaviours (capture, processing the inbox, running tasks, decisions, the personal model): `AGENTS.md`. Before doing any of these, read its section there; Claude Code doesn't load `AGENTS.md` on its own.

## Structure

```
/
  profile.md      # the owner: name, language, categories, workday, assistant
  /01_inbox       # Raw incoming items (mail, chat, meeting actions, quick notes)
  /05_model       # Personal model (see "Personal Model"): responsibilities/, commitments/, wants/, decisions/, issues/, people/, habits/, protocols/, focus.md
  /10_tasks       # Individual actionable tasks
  /20_projects    # Active projects only (status: active). Done → /80_archive/projects/.
  /30_goals       # Active goals only (status: active). Done → /80_archive/goals/.
  /40_reference   # Support material. Rule: 1 file for a target → keep at root; ≥2 files for the same project or goal → group into /40_reference/<project-slug>/ or /40_reference/<goal-slug>/. Cross-cutting refs stay at root. How the system works: /40_reference/system/.
  /50_reviews     # Weekly reviews (one file per week)
  /80_archive     # Archive. Flat root = processed inbox items and done tasks. /projects/ = done projects. /goals/ = done goals. /model/ = closed model files.
  /00_views       # Dataview queries (for Obsidian; optional)
  /91_templates   # Templates for new items (Templater, for Obsidian; agents copy their fields)
```

## Language

Task titles and documents are written in the language set in `profile.md` (`language`), whatever language the owner captures in; keep original-language quotes only as source material. Chat replies follow the language the owner writes in.

## Item Schema

Inbox items — raw captures from integrations or quick manual notes. Not tasks yet.

```yaml
---
type: item
source: mail | telegram | meeting | manual | agent
status: inbox | processed | trash
date: YYYY-MM-DD
sender: "sender name or address" | null
suggestion: task | reference | note | trash | null
---
```

- `suggestion` — agent's pre-classification; the owner can override
- `suggestion: note` — a thought or idea for the future that is not a task yet. It stays in `/01_inbox/` with `status: inbox` until it is turned into a task, a project or a model entity in `05_model/` (or trashed); then it is processed and archived as usual.
- `source: telegram` covers any chat (Telegram, Slack, WhatsApp…) an assistant captures from; record the actual channel in `sender` or `## Agent note`.
- Items live in `/01_inbox/`, named `YYYYMMDD-HHMMSS-slug.md`
- After processing: create task/reference if needed, set `status: processed`, move file to `/80_archive/`. Do not delete.

## Task Schema

```yaml
---
type: task
status: new | done | wait
priority: urgent | planned | someday
assigned: me | agent | someone
project: "[[project-name]]" | null   # nearest container: a project, or a commitment / want / decision / issue in 05_model
due: YYYY-MM-DD | null               # the day the owner plans to do it (not a deadline)
deadline: YYYY-MM-DD | null          # a hard boundary
reminder: YYYY-MM-DDTHH:MM | null
recurrence: "cron pattern" | "every N days|weeks|months|years" | null   # cron when cron can say it; the interval form for "every 2 weeks" etc.
labels: [work, plan, research, reference]
source: manual | email | agent | decision | vault | import   # decision = the next action of a decision (body links [[the-decision]]); vault = pulled from another vault (scripts/vault_bridge.py); import = from a previous task app at onboarding
vault_ref: "<vault-folder>#<id>" | null   # source: vault only
agent_state: queued | running | review | blocked | null   # only when assigned: agent (see AGENTS.md)
agent: claude | codex | <assistant> | null   # which agent takes it (assigned: agent); <assistant> = profile.md assistant in lowercase; null = any, the owner starts it (with the app's model)
completed: ISO datetime | null       # set when status → done
dropped: true | null                 # abandoned, not done (status is done so it archives)
checklist: true | null               # a list to tick off (shopping, packing): the ## Subtasks are its items
---
```

Task bodies may contain a `## Time blocks` section written by Gubernos: lines like `- ⏱ 2026-09-25 10:00–10:50 · label <!-- gcal:EVENT_ID -->` link calendar events (the Mac's Calendar or Google Calendar, Gubernos → Settings → Calendar). Keep the `gcal:` markers intact; remove a block through the app so the event is deleted too.
A `## Attachments` section lists files added from the app (`- ![[20260926-receipt.png]]`); the files live in `40_reference/attachments/YYYY-MM/`.
A `## Chat` section holds the owner's conversation with the app's agent about the task (`- YYYY-MM-DD HH:MM · <owner id>|claude · text`; the owner id is their first name in lowercase); append-only.
A checklist task (`checklist: true`) keeps its items in `## Subtasks`; the app lists open items first, takes a pasted list (numbered or bulleted lines → items) and, when it is completed with items left, can move those into a new checklist. Checklist templates live in `91_templates/checklists/<slug>.md` (`type: checklist-template`, `title`, the items as `- [ ]` lines); the owner saves one from a checklist in the app and starts new lists from it (Add task → ☑ List).
A `## Agent log` section holds agents' reports and the owner's feedback (see AGENTS.md → "Agent Task Execution").
A `## Mail` section links Gmail threads the task depends on or mail sent from it (`- ✉ [Subject](https://mail.google.com/mail/u/0/#all/THREAD) · sent to X · YYYY-MM-DD <!-- gmail:THREAD -->`).

## Project Schema

```yaml
---
type: project
status: active | done
goal: "[[goal-name]]" | null
serves: ["[[model-entity]]"] | []   # upward links to 05_model (responsibility, commitment, want, issue); a goal stays in `goal:`
category: <one of profile.md categories> | null
due: YYYY-MM-DD | null
deadline: YYYY-MM-DD | null
vault: "~/path/to/vault" | null     # another vault for this context; its alex-tasks.md-style file feeds tasks here (40_reference/system/vault-bridge.md)
vault_tasks: filename | null        # only if not the default file name
---
```

Project body: a `## Outcome` section (what done looks like).

## Goal Schema

```yaml
---
type: goal
status: active | done
serves: ["[[responsibility]]"] | []
horizon: year | 3-5 years | 5-10 years | YYYY-MM-DD | null
---
```

Goal body: a `## Success condition` section (what makes it done).

## Personal Model (05_model)

The layer above projects: what the owner is responsible for, committed to, wants, has to decide, and who matters. Vocabulary and how to tell the types apart: `40_reference/system/ontology.md`. Agent rules: AGENTS.md → "Personal model".

```
05_model/
  focus.md            # one living file: Focus by horizon
  responsibilities/   # areas, never done
  commitments/        # obligations the owner must ensure
  wants/              # wishes; promoted to a Goal by moving to 30_goals/
  decisions/          # open and parked decisions (the queue)
  issues/             # problems with an unclear resolution (only when needed)
  people/             # family, friends, then people who show up in the work
  habits/             # repeated behaviour the owner installs (or quits), checked daily in Gubernos (optional: Settings → Habits)
  protocols/          # ordered sets of habits in a time window: am, pm (they frame the day)
```

Common to every model file:

```yaml
type: responsibility | commitment | want | decision | issue | person | habit | protocol
provenance: stated | inferred       # inferred = a candidate until the owner confirms
```

Per type (frontmatter besides the common fields):

```yaml
# responsibility
status: active
category: <one of profile.md categories>

# commitment
status: active | done | dropped
serves: ["[[responsibility]]"]
to: "[[person]]" | "organization" | null   # who it is owed to
deadline: YYYY-MM-DD | null
recurrence: "plain text, e.g. monthly on the 1st" | null
attention_at: YYYY-MM-DD | null     # when to start thinking about it

# want
status: latent | active | realized | abandoned
serves: ["[[responsibility]]"]
horizon: text | null
review_at: YYYY-MM-DD | null        # when to reconsider

# decision
status: open | parked | decided | dropped   # dropped = closed without a choice: not a decision, or it became a task / project / goal
about: ["[[anything]]"]             # what the choice concerns
owner: me | assistant | "[[person]]"
decide_by: YYYY-MM-DD | null
review_at: YYYY-MM-DD | null        # for parked decisions
reversible: true | false | null

# issue
status: open | resolved
serves: ["[[...]]"]
attention_at: YYYY-MM-DD | null

# person
relationship: text                  # self, spouse, son, mother, friend, colleague…
birthday: MM-DD | YYYY-MM-DD | null

# habit
status: active | paused | retired
kind: build | quit                  # quit = a habit to stop (kept / slipped)
protocol: "[[am]]" | "[[pm]]" | null   # the protocol it belongs to; null = any time of day ("Day")
serves: ["[[responsibility]]"]      # the area
supports: ["[[goal-want-or-project]]"] | []   # why: what it moves
target: number | null               # what counts as done that day (10000 steps, 1500 ml); null = done / not done
unit: text | null                   # steps, min, ml, Cal…
minimum: text | null                # the "make it easy" version for a bad day
cue: text | null                    # if-then trigger: "after coffee → …"
obstacle: text | null               # WOOP (Gabriele Oettingen, woopmylife.org): what gets in the way…
plan: text | null                   # …and what to do then
keystone: true | null               # the one habit that matters most right now (one at a time)
days: [mon, tue, wed, thu, fri] | null   # schedule: the days it's due (null = every day)
per_week: N | null                  # instead of days: N times a week, any days
checkin: reflection | next-one | by-reflection | null   # null = the Protocol screen; else Daily reflection (next-one = by choosing tomorrow's #1; by-reflection = by saving it)
auto: "health:steps" | "health:wake<=06:30" | "oura:bedtime<=22:00" | "app:tasks" | null   # filled in automatically (Apple Health on the iPhone, Oura on the Mac, app = Gubernos itself: focus sprint minutes, tasks closed that day); nap = minutes of daytime sleep

# protocol
window: { start: "HH:MM", end: "HH:MM" }   # e.g. am 06:30–09:00, pm 19:00–22:00; between them is the workday
```

- A habit body: `## Why` (benefits), `## Log` (dated notes: changes, what was learned; never the daily check-ins). A protocol body: its habits in order, one `- [[habit]]` per line. `protocols/day.md` (`window: null`) only keeps the order of the habits without a protocol.
- Habits are not tasks: never create recurring tasks for them. Daily check-ins live in the daily file (see "Daily file"); after each weekly review the app's roll moves them to `80_archive/habits/<week>.md` and keeps totals in `50_reviews/habit-stats.csv`.

- Bodies follow the templates in `91_templates/` (decision: Question · Options · Criteria · Missing info · Recommendation · Default if not decided · Decision; person: summary · State · Open threads · See also · `---` · Timeline, append-only).
- `focus.md` has `type: focus` and sections `## Quarter (YYYY-Qn)`, `## Week (YYYY-Www, D Mon – D Mon)` and, once a week has rolled over, `## Previous week (…)`.
  - Quarter: a few bullets `- [[link]] · why now`. Set at onboarding and revisited at the end of a quarter; Gubernos shows it read-only.
  - Week = **this week's wins**: up to 3 lines `- [ ] result by Sunday · [[link]]`, ordered — the first is WIN #1; `- [x]` when achieved. A result, not an activity; the link (project, decision or goal) is optional.
  - The owner sets and checks wins in Gubernos (Wins screen: tabs This week / Next week). When wins are set for a new week, the app moves the old Week section to `## Previous week (…)`, replacing the older one. The app writes only the Week / Previous week / Next week sections.
  - `## Next week (YYYY-Www, …)`: next week's wins planned ahead (same line format, unchecked), usually at the weekly review. When that week comes it is "this week": the app shows it so and renames it to `## Week (…)` on the first change. Agents reading this week's wins take Week, or Next week when its week is the current one; agents never write over this week's Week.
  - A weekly review note may hold a wider `## Focus Next Week` (by area); the Wins screen offers its lines as suggestions for the 3 wins.
- `serves` and `about` are always YAML lists of wikilinks.
- Responsibilities hold no tasks directly. An area's single actions go to its **list project** (a pseudo-project in `20_projects/` that `serves` the area, outcome "No end: …"), created when the first one appears (e.g. `health-errands`, `home-maintenance`). When 3+ tasks share one outcome, spin out a real project.
- Closed model files (decided or dropped decisions, realized/abandoned wants, done/dropped commitments, resolved issues) move to `80_archive/model/`. A decided decision first gets a dated line in `## Decisions` of each `about` target: `- YYYY-MM-DD · choice · reason · [[decision-slug]]`.

## Daily file (My Day)

One plain-markdown file per day, `50_reviews/daily/YYYY-MM-DD.md`, written mostly by Gubernos: the day's plan, the habit check-ins, the plan-vs-actual line and the reflection. Each writer changes only its own sections and keeps the rest as is.

```
# Daily · Sat, 10 Oct 2026

## Plan
<!-- set 2026-10-10T08:55 (Gubernos) -->      # when the morning plan was fixed (Plan the day → Apply)
- #1: <result> · [[task-or-win-or-goal]]   # "- [x] #1: …" once done; may be chosen the evening before
- [ ] [[task-id]] · 45 min                   # the commitment for the day
- Blocks: deep work 09:30–11:00 <!-- gcal:ID --> · deep love 18:00–19:00 <!-- gcal:ID -->
- Added later: [[task-id]] · [[task-id]]    # taken on after the plan was set

Plan: 4/6 · #1 ✓ · 2 moved                  # written in the evening

## Habits
### AM
- [x] [[sun-greeting]] · 15 min
- [x] [[cold-plunge]] · minimum
### Day
- [x] [[10000-steps]] · 12831 steps
- [x] [[sugar-free]] · kept                 # a quit habit: "· kept" or "- [ ] … · slipped"
- [ ] [[read]] · skipped                    # skipped on purpose: neither done nor missed
### PM
- [ ] [[sleep-at-2200]]

## Effort / ## Success / ## Progress   (or ## What went well / ## What needs work / ## What to improve tomorrow)
```

- `## Plan` is fixed in the morning; the evening line compares it with what happened. A day is won when #1 is done.
- A habit with a `target` counts only when the value reaches it; days off a habit's schedule and skipped days count neither way.
- The reflection (Daily reflection screen) keeps its format marker `<!-- format: esp|journal … -->`; below the answers, `## Gratitude` holds up to three numbered lines: what the owner is grateful for today, who and what (`1. who or what · because …`), left out when empty. The Weekly review shows the week's days and habits.

## Weekly Reviews

The **Weekly review** screen in Gubernos walks the week (look back, inbox to zero, overdue, waiting, agent work, projects without a next action, decisions, the next two weeks, someday, next week's wins) and saves the owner's notes as a `## Review (Gubernos)` section in `50_reviews/{monday}_to_{sunday}.md` (plain markdown, no frontmatter). Agents may add their own sections to the same file; never rewrite the app's section.

## File Naming

Tasks/Items: `YYYYMMDD-HHMMSS-slug.md` (e.g., `20260301-143022-buy-running-shoes.md`)
Projects/Goals: `slug.md` (e.g., `run-5k.md`, `health.md`)
Model files: `slug.md` in the type's subfolder of `05_model/` (e.g., `05_model/people/maria.md`)
Slugs of projects, goals and model files must be unique across the vault (wikilinks resolve by name).
Reviews: `{week_start}_to_{week_end}.md` (e.g., `2026-09-28_to_2026-10-04.md`)

## Rules

1. Always use the templates' fields when creating new items
2. Link tasks to their nearest container via `project: "[[name]]"`: a project, or a commitment / want / decision / issue. Responsibilities hold no tasks: single actions of an area go to its list project
3. Link projects to goals via `goal: "[[goal-name]]"`, and to other model entities via `serves:`
4. Subtasks are checkboxes in the task body, not separate files
5. When completing a recurring task, calculate next `due` from the `recurrence` (cron: next matching date after max(due, today); `every N weeks` etc.: max(due, today) + N) and reset status to `new`. The owner says repeats in words ("every monday", "every 2 weeks"); store them in these two forms — Gubernos converts words itself
6. Tasks with `assigned: agent` can be worked on autonomously (AGENTS.md → "Agent Task Execution")
7. When a project's `status` flips to `done`, move the file to `/80_archive/projects/`. Same for goals → `/80_archive/goals/`. Closed model files → `/80_archive/model/`. Wikilinks resolve by name so backlinks survive the move
8. Never delete files: archive them

## Priorities

- `urgent` - Do ASAP
- `planned` - Scheduled/planned work
- `someday` - Maybe later, no commitment

## Statuses

- `new` - Ready to work on
- `done` - Completed
- `wait` - Blocked/waiting on something

## Labels

- `work` - Work context
- `plan` - Needs planning first
- `research` - Needs research first
- `reference` - Reference material attached

## Categories

Life areas for projects and responsibilities, listed in `profile.md` (`categories`). The defaults:

- `energy` — health, sport, recovery
- `work` — career, professional projects
- `love` — relationships, family
- `home` — household, kids, maintenance
- `finance` — money, investments

Each project has one. Tasks inherit category through their `project` link; tasks without a project are uncategorized.
