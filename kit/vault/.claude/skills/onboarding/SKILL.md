---
name: onboarding
description: First-time setup of the owner's vault through a short interview, mostly by voice — they talk, you file what matters straight away. Also imports tasks from a previous app (Apple Reminders, Things 3 and Todoist directly; TickTick, Google Tasks, Notion, a text list from an export). Use after installation, or when the owner says "onboarding", "set up my system", "import my tasks", "let's fill the model".
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# Onboarding

A mini interview: 10 minutes of the owner's time, 15–20 at the very most. They talk, as much as they like, in any order. You pick out what matters and put it straight into their system. It's a conversation with someone who listens, not a questionnaire. It doesn't have to be complete: whatever is missing can be added later, and anything wrong can be corrected later.

Before you start, read only: `profile.md`, `CLAUDE.md` (schemas), `40_reference/system/ontology.md` (how to tell the concepts apart).

## The rules

- **Nothing to confirm.** Never ask "shall I create…", never show a proposal, a table or a seeding sheet. What they said goes into the vault right after each answer. Say once that anything can be changed later.
- **Don't interrogate.** One open question at a time, in a sentence or two, never a numbered list. Don't ask for details you can leave empty. If you can't tell what something is, make your best guess, mark it `provenance: inferred`, and move on. No follow-up about dates, outcomes or reasons: an empty field is fine.
- **React like a person.** After each answer: one or two warm lines on what you heard, what stood out, in plain words, and how many things you added. No file names, no slugs, no schema words like "provenance" or "commitment". Then the next question.
- **At most four questions in the whole interview**, one per topic below. If they already covered a topic, don't ask it. If they say "enough" or "skip", go on or finish.
- **Be quick.** Write the files in one go; don't re-read what you just wrote.
- Talk in the language they use. Files go in `profile.md` → `language`. Speech comes through dictation: read for meaning, fix names and obvious transcription errors.
- Lightest vehicle (ontology): most things are tasks; areas hold no tasks (single actions go to the area's list project); a "decide…" is a decision; a wish without commitment is a want; facts stay facts.
- Use the templates' fields (`91_templates/`); filenames and slugs per `CLAUDE.md` → "File Naming"; slugs unique across the vault; `provenance: stated` for what they said.
- Never delete anything. Never send, book or buy.
- Keep a few lines of progress in `40_reference/system/onboarding.md` (which topics are done), so a later run continues rather than starts over.

## The opening

In the app the screen has already said this and asked the first question, so their first message is the answer: go straight to filing it. In a terminal, say it yourself: "Set aside 15–20 minutes somewhere you can talk. Tell me whatever comes to mind, in any order; I'll pick out what matters and put it straight into your system."

## The four topics

Everything they say goes where it belongs, whichever question it came after.

1. **You and your people.** "Tell me about yourself: where you live, what you do, who's in your life, and what you'd like this to help with."
   - `profile.md`: `name`, `language`, `workday` if they mention it; a short "About me" paragraph.
   - `05_model/people/<slug>.md` for the owner (`relationship: self`) and each close person (template `person.md`, Timeline line `- YYYY-MM-DD · onboarding · …`).
   - 4–7 areas (`05_model/responsibilities/<slug>.md`, template `responsibility.md`) inferred from all this, each with a category from `profile.md` → `categories` and one line on what "well kept" means. Don't ask about them; tell them what you made.
2. **What's on your mind.** "What's on your plate right now? Projects, things to do, dates you can't miss, bills, anything that nags at you."
   - Multi-step work with an end → project (`20_projects/`, `## Outcome`, `serves` the area, `category`). One action → task (`10_tasks/`) in the area's list project (outcome "No end: …"), with any due date they said.
   - An obligation (rent, taxes, insurance, a contract, a renewal) → commitment (`05_model/commitments/`, template `commitment.md`: `deadline` and `recurrence` if said, `attention_at` a sensible time before the deadline).
   - "Should I…", "I have to decide…" → decision (`05_model/decisions/`, template `decision.md`: the question as the title, `about`, `decide_by` only if there's a real date).
3. **What you want.** "What would you like to happen this year or the next few, even if you haven't committed? And is there any choice you keep putting off?"
   - A want (`05_model/wants/`, `latent` or `active`). A goal (`30_goals/`, `## Success condition`, `horizon`) only when they named a result and a date.
4. **This week.** "What would make this week a win? And what's one small thing you could start doing every day?"
   - Up to 3 wins in `05_model/focus.md`, `## Week (YYYY-Www, D Mon – D Mon)`, `- [ ] result · [[link]]` (format in `CLAUDE.md`), the most important first. A `## Quarter (YYYY-Qn)` line only if they said what matters this quarter.
   - One habit (`05_model/habits/<slug>.md`, template `habit.md`): `protocol: null`, `keystone: true`, a `minimum` small enough for a bad day (your guess is fine), `serves` the area, the cue and why if they said them.

## The ending

In four or five lines: what's in the system now (counts, in plain words); where to see it (Today, the project list, Decisions, Wins); the two habits, **every morning** Plan the day and **every week** the Weekly review; that they can capture anything with the + button or the mic, and add or change anything later. If they mentioned another task app, say they can bring it in later by asking their agent to import their tasks.

## Importing tasks from another app (when asked, in a terminal; not during the interview)

`<app>` = the Gubernos folder, `~/.gubernos/app` by default.

- **Apple Reminders, Things 3, Todoist**: the app's importer, `node <app>/scripts/import-tasks.mjs reminders | things | todoist` (`<app>` = the Gubernos folder, `~/.gubernos/app` by default). Read only. Reminders and Things: macOS asks once (Allow / OK). Todoist: the script asks for the API token (Todoist → Settings → Integrations → Developer); they paste it into the script's prompt in their terminal, or you run it with `TODOIST_TOKEN=…` only if they hand you the token themselves. It saves one JSON (`data/import/…`): lists (inbox, list, project with its area, area, someday) with their items (title, notes, due / time, deadline, priority, tags, `recurrence` already in the vault's form, subtasks, section). Things gives no checklists or repeat rules; Reminders no subtasks or tags.
- **TickTick / Microsoft To Do / Google Tasks / OmniFocus**: their CSV / JSON export (Google Tasks: Google Takeout with only Tasks).
- **Todoist without a token**: Settings → Backups, or a project's "Export as CSV"; or paste.
- **Notion / Trello / a notes file**: export as CSV / markdown, or paste.

Create tasks with `source: import`, recurring ones with `recurrence` in the forms from `CLAUDE.md`. Skip anything done, stale or duplicate. For a long list, propose by area what's a project, a list project, a commitment, a want, a decision or a task, and let them mark it before you write.
