---
name: onboarding
description: First-time setup of the owner's vault through an interview — who they are, their areas, people, commitments, wants, decisions, focus — plus importing tasks from a previous app (Apple Reminders, Things 3 and Todoist directly; TickTick, Google Tasks, Notion, a text list from an export). Use after installation, or when the owner says "onboarding", "set up my system", "import my tasks", "let's fill the model".
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# Onboarding

You are setting up a new owner's system with them. The goal of one session (45–90 minutes, can be split): the vault knows who they are and what matters, their open work is in it, and they know the daily and weekly loop.

Before the first question, read: `profile.md`, `CLAUDE.md` (schemas), `AGENTS.md` → "Personal model", `40_reference/system/ontology.md` (the six concepts and how to tell them apart), `40_reference/system/how-it-works.md`.

## How to run it

- **Resumable.** Keep progress in `40_reference/system/onboarding.md` (create it from the checklist below on first run; tick steps as they finish, note what was skipped). On a later run, read it and continue where it stopped.
- **Talk like a chief of staff, not a form.** At most 3–5 questions per message. Propose, then ask ("Sounds like three areas: Family, Health, Work — anything missing?"). Accept short answers.
- **Nothing is created until the owner confirms.** Gather, show a short proposal (a table or a list), write after "yes". For long lists use a seeding sheet (below).
- **Lightest vehicle** (ontology): most things are tasks; areas hold no tasks (single actions go to the area's list project); a "decide…" is a decision; a wish without commitment is a want; facts stay facts.
- **Write in `profile.md` → `language`** (ask in step 1). Talk in the language the owner writes in.
- Use the templates' fields (`91_templates/`); filenames and slugs per `CLAUDE.md` → "File Naming"; slugs unique across the vault; `provenance: stated` for what they said, `inferred` for your guesses (and say so).
- Never delete anything. Never send, book or buy.
- Gubernos (`http://127.0.0.1:4747`, or the phone URL from setup) picks up the files as you write them; point the owner to the screen that shows what you just created.

## Checklist (copy into 40_reference/system/onboarding.md)

```markdown
# Onboarding

- [ ] 1. About you → profile.md, people
- [ ] 2. Areas → responsibilities, categories
- [ ] 3. What's on your plate → import + brain dump → projects, tasks
- [ ] 4. Commitments
- [ ] 5. Wants and goals
- [ ] 6. Decisions
- [ ] 7. One habit to start
- [ ] 8. Focus: the quarter and this week's 3 wins
- [ ] 9. Tour of the loop
```

## 1. About you

Ask: the name to use; the language for tasks and documents; where they live (country matters for taxes, holidays, documents); household and close people (partner, kids, parents, close friends — names, relationship, birthdays if they know them); what they do for work; working hours and lunch (for Plan the day); what they want from this system and what failed before.

Write:
- `profile.md` frontmatter: `name`, `language`, `workday`; the "About me" section: a short paragraph of the rest.
- `05_model/people/<slug>.md` for the owner (`relationship: self`) and each close person (template `91_templates/person.md`: summary line, `## State`, `## Open threads`, `---`, `## Timeline` with `- YYYY-MM-DD · onboarding · …`).
- Restart is not needed: the app re-reads `profile.md`.

## 2. Areas (responsibilities)

From step 1, propose 4–7 areas that never end (Family, Health, Home, Finances, Career…), each with a category from `profile.md` → `categories`. If their life doesn't fit the five default categories, change the list in `profile.md` now (lowercase words) — the app follows it.
Write `05_model/responsibilities/<slug>.md` (template `responsibility.md`) with one line on what "well kept" means.

## 3. What's on your plate (import + brain dump)

Ask whether they have a previous system. Ways to get its contents:
- **Apple Reminders, Things 3, Todoist**: the app's importer, `node <app>/scripts/import-tasks.mjs reminders | things | todoist` (`<app>` = the Gubernos folder, `~/.gubernos/app` by default). Read only. Reminders and Things: macOS asks once (Allow / OK). Todoist: the script asks for the API token (Todoist → Settings → Integrations → Developer); they paste it into the script's prompt in their terminal, or you run it with `TODOIST_TOKEN=…` only if they hand you the token themselves. It saves one JSON (`data/import/…`): lists (inbox, list, project with its area, area, someday) with their items (title, notes, due / time, deadline, priority, tags, `recurrence` already in the vault's form, subtasks, section). Things gives no checklists or repeat rules; Reminders no subtasks or tags.
- **TickTick / Microsoft To Do / Google Tasks / OmniFocus**: their CSV / JSON export (Google Tasks: Google Takeout with only Tasks).
- **Todoist without a token**: Settings → Backups, or a project's "Export as CSV"; or paste.
- **Notion / Trello / a notes file**: export as CSV / markdown, or paste.
- **Nothing**: a brain dump — "everything on your mind, one per line, any order", in a few rounds by area.

Then, for anything longer than ~15 items, write a **seeding sheet** `40_reference/system/seeding-sheet.md` the owner marks in a text editor or the chat:

```markdown
| # | Item | Proposal | Why | Call |
|---|---|---|---|---|
| 1 | Renovate kitchen (12 tasks) | project, serves Home | multi-step, has an end | |
| 2 | Pay rent monthly | commitment "Rent", serves Home, monthly | an obligation, not a project | |
| 3 | Decide on a new car | decision, about Home/Finances | a choice before any work | |
| 4 | Buy printer ink | task in the list project home-errands | one action | |
```

Call: ✅ yes · ✏️ change (say how) · ❌ skip · 💤 someday. Group the sheet by area; propose, for each old project, what it really is (project / list project / commitment / want / decision) and, for tasks, import / someday / skip (skip anything done, stale or duplicate; say why).
Create only the confirmed rows: projects (`20_projects/`, with `## Outcome`, `serves` the area, `category`), list projects for single actions (outcome "No end: …"), tasks (`10_tasks/`, `source: import`, subtasks as `## Subtasks` checkboxes, keep due dates and deadlines that are still meaningful, `priority: someday` for 💤). Recurring items: `recurrence` in the forms from `CLAUDE.md` (cron or `every N weeks`).
Report counts and point to the app (Inbox, Today, Upcoming, the projects in the menu).

## 4. Commitments

Obligations they must ensure. Prompt with common ones and let them pick: rent or mortgage; income tax return; insurances (health, home, car, travel); car inspection and road tax; utility and municipal taxes; subscriptions; kids' school, activities, health check-ups; passport / ID / visa / driving licence expiry; recurring payments to family; work contracts or invoicing.
For each: `deadline` (or the next occurrence), `recurrence` in plain text, and `attention_at` = when to start thinking (deadline minus preparation and a buffer). Write `05_model/commitments/<slug>.md` (template `commitment.md`, `serves` the area, `to` if owed to someone). Existing tasks that belong to it get `project: "[[commitment]]"`.

## 5. Wants and goals

"What would you like to happen this year or the next few — even if you haven't committed?" Each becomes a **want** (`latent` / `active`, `review_at` if parked). Only when there is a success condition and a horizon, and they commit, propose a **goal** (`30_goals/`, `## Success condition`, `horizon`), with the projects that serve it (`goal:` on the project).

## 6. Decisions

"Any choices hanging over you?" — and the "decide / choose / should I…" items found in step 3. Each becomes `05_model/decisions/<slug>.md` (template `decision.md`): the question as the title, `about` links, `decide_by` if there is a real date. Fill Options / Criteria / Missing info / Recommendation now if the owner wants (AGENTS.md → "Decision queue" → Prepare), or leave them for the assistant. They appear in the app's Decisions screen.

## 7. One habit to start

One habit, not a routine. Ask: **"What's one thing you could start doing today that would improve your life the most?"** If they hesitate, offer two or three ideas from what they said earlier (sleep, movement, a phone-free morning, time with someone), and let them pick.
- Make it small enough for a bad day: the habit (`# Title`, e.g. "Walk 20 minutes") and its **minimum** (`minimum: "5 minutes around the block"`).
- A **cue**: when or after what ("after lunch → walk"). A **why** in one or two lines (`## Why`). Link the area (`serves`) and, if it moves one, the goal or want (`supports`).
- Write `05_model/habits/<slug>.md` from `91_templates/habit.md`: `protocol: null` (it shows in the Day block), `keystone: true`, `provenance: stated`. A habit to stop (sugar, late screens) is `kind: quit`: kept or slipped each day.
- Don't create protocols. Say in one line that once they have two or three habits for the morning or the evening, they can group them into a **protocol**: a routine done in order (the app's Protocol screen).
- Point them to the Protocol screen: they tick it there each day; on a bad day the minimum counts as done.

## 8. Focus

- **Quarter**: 1–3 lines "what deserves more attention this quarter", linked to an area, goal, project or decision. Write under `## Quarter (YYYY-Qn)` in `05_model/focus.md` as `- [[link]] · why now`.
- **This week's wins**: up to 3 results by Sunday, #1 matters most. Write them in `focus.md` as `## Week (YYYY-Www, D Mon – D Mon)` with `- [ ] result · [[link]]` (format in `CLAUDE.md`), or let the owner type them on the app's Wins screen.

## 9. Tour of the loop

Explain in a few lines, pointing at the app:
- **Capture**: the + button or the mic; quick add understands dates ("tomorrow", "every monday"), `#project`, `p1`, `@agent`.
- **Every morning**: the push "Plan your day" opens Plan the day — what fits today's free time, what goes to agents, what moves. Turn notifications on in Settings (on the iPhone, from the home-screen app).
- **Agents**: give a task to an agent (`@agent`, or ▶ Do it in a task's chat); review what comes back (accept / send back).
- **Decisions** and **Coming up** surface what needs a choice or preparation.
- **Every week** (e.g. Sunday): the Weekly review screen, then next week's 3 wins.
Finish with a summary: what was created (counts by type), what was skipped and is noted in `onboarding.md`, and the one thing to do tomorrow morning.
