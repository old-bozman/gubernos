---
name: process-inbox
description: Process inbox items (01_inbox/) one by one into tasks, projects, model entities, references or trash, following the processing algorithm in AGENTS.md. Use when the owner says "process inbox", "process capture", "clear my inbox", or references an inbox item.
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Glob, Bash
---

# Process the inbox

Process the item given in $ARGUMENTS, or every item in `01_inbox/` with `status: inbox` (oldest first), following "Processing Algorithm" in `AGENTS.md`. The vault root is the current directory (where `CLAUDE.md` is).

## Step 1 — Read

- The item(s) in `01_inbox/`. Notes (`suggestion: note`) are thoughts, not tasks: ask whether it is ready to become something, otherwise leave it.
- All active projects in `20_projects/` and the model containers in `05_model/` (commitments, wants, decisions, issues). This is REQUIRED — always check where an item belongs before creating anything.

## Step 2 — Decide, per item

1. **What is it?**
2. **Actionable?** No → trash, reference (a note in `40_reference/`), note (stays), or someday task. Yes → continue.
3. **< 2 minutes?** Do it now if you can, or tell the owner.
4. **Delegate?** To an agent (`assigned: agent`, the body is the brief) or a person (`assigned: someone`, `status: wait`), else `assigned: me`.
5. **More than one step?** A project (check one doesn't already exist), else a task. A choice → a decision; an obligation → a commitment (`ontology.md`).

## Step 3 — Confirm

Before writing, show the owner one line per item: `<item> → <vehicle> · #<project> · <priority> · <due> · <owner>`. Skip questions you can infer with high confidence; ask only what you can't.

## Step 4 — Write

- Tasks: `10_tasks/YYYYMMDD-HHMMSS-slug.md` with the fields of `91_templates/task.md` (`title`, `aliases`, `status: new`, `priority`, `assigned`, `project: "[[slug]]"`, `due`, `deadline`, `reminder`, `recurrence`, `labels`, `source` = the item's source), then `# <title>`, the details, `## Subtasks` with checkboxes.
- Projects / model files: their templates in `91_templates/`.
- Titles and documents in `profile.md` → `language`.

## Step 5 — Archive the item

1. In the item: `status: processed`, `suggestion: task|reference|trash`, and under `## Agent note` what it became ("Processed → task [[…]]").
2. Move it: `mv "01_inbox/<file>.md" "80_archive/<file>.md"`. Never delete.

## Rules

- Never skip the project lookup.
- Subtasks are checkboxes in the task body, not separate files.
- Validate frontmatter values before writing (`AGENTS.md` → "Validation Rules").
