---
type: reference
---

# Ontology: the vocabulary of the personal model

The model lives in `05_model/`: schemas in `CLAUDE.md` → "Personal Model", agent rules in `AGENTS.md` → "Personal model". Agents use these words when reasoning and talking with the owner, and log misfits in the gap log at the end.

Why: plain GTD has only Goal → Project → Task, so areas, obligations, wishes and decisions get filed as projects and tasks. Naming them lets an agent tell what matters, why, and what needs a choice.

## The six concepts

| Concept | Definition | Ends? | Examples |
|---|---|---|---|
| **Responsibility** | An ongoing area the owner is accountable for. A finer version of the categories in `profile.md`. | never | Family, Health, Home, Finances, Career |
| **Commitment** | Something the owner is obliged to ensure: from a promise, contract, law, money, or a decision already taken. Ongoing or finite; may recur. | finite ones do | mortgage payments, tax return, car inspection, kids' insurance |
| **Want → Goal** | One lifeline. A Want is something the owner would like to happen (latent / active / realized / abandoned). It becomes a Goal once it has a success condition and a horizon, and the owner commits to it. | Goals do | a dog, learn a language, run a marathon, a new role |
| **Issue** | A state of the world that needs attention and whose resolution is not yet clear. | resolved | the roof leaks and nobody knows why yet |
| **Decision** | A choice among options that changes what happens next. Has an owner, options, a decide-by date; once taken, the choice and the reason. "Not now" with a review date is also a decision. | decided / parked | dog yes/no, which insurance, change jobs |
| **Person** | A human with lasting relevance: relationship, key dates, interests, shared commitments. Current state on top, timeline below. | n/a | partner, kids, parents, close friends |

Not entities, but part of the vocabulary:
- **Focus**: a short list of pointers, by horizon (quarter / week / today), to whatever deserves more attention now. Not a priority and not a goal. Lives in `05_model/focus.md`; the week's version is the 3 wins.
- **Project / Task**: the execution layer. A project should be able to answer "why" by pointing up to a Goal, Commitment, Issue or Responsibility.

## Telling them apart

Ask in this order:
1. Is it a choice between options that the owner has to make? → **Decision**. A task titled "decide… / choose…" is a Decision in disguise.
2. Is it never done, a standing area? → **Responsibility**.
3. Is the owner obliged (promise, contract, law, money, a decision already taken)? → **Commitment**.
4. Is something wrong or at risk, with no clear fix yet? → **Issue**. If the fix is clear, it is just a task.
5. Would the owner like it, without having committed? → **Want** (latent if nothing is needed now).
6. Is it committed, with a success condition and a horizon? → **Goal**.
7. Is it a finite body of work with several steps? → **Project**. One step → **Task**.

When unsure, pick the lighter one and say so. "I need…" is not a type: it can be a Commitment, an Issue, a Goal, a constraint or a plain task. Most things the owner says still become tasks. Do not turn facts into work: "Maria's birthday is on X" stays a fact about a Person until it is time to prepare.

## Time words

- **deadline**: when something must be done or true.
- **event date**: when something happens (a birthday, a trip).
- **attention date**: when it becomes useful to start thinking about it; earlier than the deadline or event by preparation, delivery, dependencies and a buffer.
- **review date**: when to reconsider something parked (a latent Want, a "not now" Decision).
- **horizon**: today / week / quarter / year / 5–10 years.
- **recurrence**: for recurring commitments and events.

A time trigger hands the situation back to an agent to reason about. It never carries a ready-made task.

## Provenance

Everything is either **stated** (the owner said it) or **inferred** (an agent concluded it). Inferred things that change priorities (Focus, a Commitment, Want → Goal) stay candidates until the owner confirms.

## Mapping to plain GTD

| GTD | In this vocabulary |
|---|---|
| categories in `profile.md` | coarse Responsibilities |
| `20_projects/` | mostly Projects; some are really Responsibilities, Commitments or Wants |
| `30_goals/` | Goals |
| `priority: someday` tasks, `suggestion: note` ideas | latent Wants |
| `status: wait` + `assigned: someone` | Waiting: an attribute, not a type |
| tasks "decide… / choose…" | Decisions |
| `## Decisions` in a project | the log of decisions taken |
| `01_inbox/` | observations (mail, chat, meeting, agent) |
| Google Calendar | event dates and clock-pinned commitments |

## Not in the vocabulary yet

Deferred until the gap log demands them: Routine / habit, Asset, Event as a separate file, Constraint (text on the subject), Policy, a separate Observation layer (the inbox is it), numeric confidence.

## Rule for adding a type

A new first-class type only when:
1. the existing concepts distort the real-world meaning;
2. it has its own lifecycle;
3. agents must behave differently for it;
4. it changes attention, planning, decisions or execution;

and the gap log holds at least two real cases. Otherwise use an attribute, a label or a link.

## How agents use it

- Reason in these words. Name the concept to the owner only when it helps ("this looks like a decision, not a task").
- Store them in `05_model/` following `AGENTS.md` → "Personal model" (what an agent applies itself and what it proposes).
- When a real case cannot be represented naturally, append it to the gap log.

## Gap log

<!-- AI-NOTE: append-only. Format: - YYYY-MM-DD · <agent> · <what could not be represented> · <nearest concept> · <why it did not fit> -->
