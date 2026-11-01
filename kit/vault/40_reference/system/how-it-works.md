---
type: reference
---

# How this system works

Your tasks, projects and goals in plain markdown, a web app to work in, and AI agents that do part of the work. This page is the idea behind it; the rules are in `CLAUDE.md` (schemas) and `AGENTS.md` (agent behaviour), the vocabulary in [[ontology]].

## Roles

- **You** — the CEO. You set direction (goals, outcomes) and make the calls: decisions, anything sent, booked or bought.
- **Your assistant** — your Chief of Staff (any agent: Claude Code in this vault, the app's chat, or your own chat bot named in `profile.md`). It turns intent into the right vehicle, prepares decisions, watches time, reports back. It never sets strategy and never acts outward without your yes.
- **Executors** — agents that work one task each (Claude Code, Codex, …), started from the app. They hand the work back for your review.
- **Canon** — these files. The only source of truth. Everything valuable ends up here.

```
you (CEO)  →  assistant (Chief of Staff)  →  executor agents  →  task work
  direction,      runs operations,               specialist
  decisions       prepares decisions, owns time   execution
```

## Outcomes, not tasks

You say *why* and *what you want*, not *how*. The assistant picks the **lightest sufficient vehicle**:

- noise → trash;
- a fact → a reference note, or a line on a person;
- one action → a task (in its project or list project);
- several steps → a project with an outcome;
- a big durable result → a goal (rare);
- something you'd like but haven't committed to → a want;
- a choice between options → a decision;
- something pinned to the clock → a calendar event — always **proposed**, you confirm.

Most things are still tasks. Facts are not work: "Maria's birthday is on 12 May" stays a fact until it is time to prepare.

## Canon vs surfaces

Conversations happen on surfaces — the app's chat, a Claude Code session, a chat bot. Surfaces are **ephemeral**; canon is permanent. Two movements connect them:

- **Hydrate** — starting work loads context from canon (the task, its project, the model above it, references), not from old chat history.
- **Checkpoint** — when a topic closes, what matters is written back: the task's `## Agent log`, the project's state and `## Decisions`, new tasks, reference notes. After that the chat can be lost.

Context is layered and inherited: you (`profile.md`, the model) → area → project → task. A fact is stored once, at the right level.

## The loop

**Capture** anything: quick add or voice in the app, a note in the Inbox, a message to your assistant.

**Daily** (app):
- the morning push opens **Plan the day**: what fits today's free time (calendar minus meetings and lunch), what goes to agents, what moves;
- agents work their tasks and hand them back for **review** (accept, send back, or close);
- the evening push offers to move what is left.

**Weekly** (app → Weekly review): look back, inbox to zero, overdue, waiting, agent work, projects without a next action, decisions, the next two weeks, someday, then **3 wins** for the next week (results by Sunday, #1 matters most).

**Quarterly**: a few focus lines in `05_model/focus.md` → Quarter.

## The personal model

Above projects sits what you are responsible for, committed to, want, have to decide, and who matters (`05_model/`). It answers "why does this task exist?" (task → project → goal / commitment → responsibility) and brings things back in time: a commitment's attention date, a parked decision's review date, a birthday. The app shows these in Plan the day ("Coming up"), Decisions and Wins.

## Example

Intent: *"Refinance the mortgage before rates rise."*

| Step | What happens |
|---|---|
| Capture | You say it in the app's chat or quick add. |
| Vehicle | Not one action — an initiative → a **project** under the commitment `mortgage`, category finance. |
| Hydrate | The assistant reads the commitment, finance references, related decisions. |
| Act | `20_projects/refinance-mortgage.md` with an outcome; first task "get two lender quotes" handed to an agent. |
| Work | The agent researches and writes a comparison note; you review it. A choice appears → a **decision** "which lender" with options and a recommendation. |
| Checkpoint | You decide in the app; the decision is recorded in the project's `## Decisions`, the next action becomes a task. |
