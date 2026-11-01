---
type: reference
---

# Vault bridge (optional)

For people with other vaults or repos per context (a startup, a job, a side project). Their tasks reach this system without duplicating their backlogs.

## Principle

Each vault stays the source of truth for its own context. This system is the layer of attention and priority. They are joined by one narrow interface: **what is waiting for you yourself**. Only the urgent part of it becomes a task here; the rest stays in the vault.

## The pieces

1. **Project ↔ vault.** A project in `20_projects/` gets `vault: "~/path/to/vault"` (and `vault_tasks:` only if the file is not `<you>-tasks.md`, where `<you>` is your first name in lowercase from `profile.md`). One vault, one project.
2. **`<you>-tasks.md` in the vault root.** Only your own actions, in Obsidian Tasks format, in four sections: `## Now`, `## Next`, `## Waiting`, `## Done`. The vault's agents maintain it (prompt below).
3. **The collector**, `scripts/vault_bridge.py`. Dry run by default, `--write` applies. Run it every morning (by hand, from your assistant, or a launchd job).
   - **Urgent** = open, not in Waiting/Done, and in `## Now`, or `📅` within 2 days, or overdue.
   - Each urgent line becomes one task here: `source: vault`, `vault_ref: <vault-folder>#<id>`, `priority: urgent`, `due` from `📅`, `project` = the linked project. Created once; matched by `🆔` afterwards.
   - **Done wins both ways.** A task here marked done closes the vault line (`[x]`, `✅ date`, moved to `## Done`); a line closed in the vault closes the task here.
   - Nothing else syncs after creation: you can reschedule or re-word the task here freely.
   - A line without `🆔` is skipped and reported. A task here whose line disappeared is reported, not closed.
   - The last line `SUMMARY: N new urgent (project N), M closed` is meant for a morning brief.

## Linked vaults

| Project | Vault | Prefix | Since |
|---|---|---|---|

## Prompt for the vault (paste into its CLAUDE.md / AGENTS.md; change the name and the prefix)

```markdown
## My tasks (maria-tasks.md)

`maria-tasks.md` at the vault root is the only place for actions that Maria herself must do: decide, reply, sign, pay, attend, review, prepare. Her home system reads it every morning and pulls urgent items into her day plan.

What goes in:
- Only her own actions. Not your agent work, not notes, not other people's tasks (those go under Waiting only if she is blocked on them).
- One line per action, verb first, understandable without opening the vault. Link context with [[wikilinks]]. No secrets or confidential figures in the line itself.

Format (Obsidian Tasks):
`- [ ] <action> [[link]] 📅 YYYY-MM-DD 🆔 <prefix>-NNN`
- Prefix for this vault: `ab`. Take the next free number. Never change or reuse an existing id.
- 📅 only when there is a real date.

Sections:
- `## Now`: urgent, she should act within ~2 days.
- `## Next`: her next actions, not urgent yet.
- `## Waiting`: she is blocked on someone else.
- `## Done`: when done, mark `[x]`, append `✅ YYYY-MM-DD`, move here.

When you capture a meeting or update the vault's own backlog and it produces an action for her, also add it here. Keep this file short: promote, demote, close. Lines may be closed from her side (her own system); respect that and do not reopen them.
```

## Not covered (on purpose)

- Decisions ("decide whether…") are not tasks: life-level ones live in `05_model/decisions/`; a vault's own decisions stay in the vault.
- People: only those who matter to your life go to `05_model/people/`.
- Confidential content stays in the vault; this system gets one line and a link.
