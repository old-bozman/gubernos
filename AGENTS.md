# Working on Gubernos (for any coding agent)

> **Here to install Gubernos for someone, not to change its code?** Follow [SETUP.md](SETUP.md) → "For the agent".

Single developer + agents; other people install it from `SETUP.md`, so keep personal values in config / `profile.md`. Keep it simple: vanilla JS, no build step, no framework, one runtime dependency
(`yaml`). Don't add dependencies, abstractions or test frameworks without a concrete need.

## Map

| File | What |
|---|---|
| `server.js` | HTTP server: tiny router, JSON API, SSE (`/api/events`), static files, vault watcher |
| `lib/config.js` | Who and where: `~/.config/gubernos/config.json` (vault, port, publicUrl, obsidian) + the vault's `profile.md` (name → log id, language, categories, workday, focus time, assistant). Nothing personal is hardcoded — read it from here |
| `lib/review.js` | Weekly review: the week's numbers and lists; notes saved to `50_reviews/` |
| `local/` (boot.js, shims/), `scripts/build-local.mjs` | iOS offline mode: the same `app.js` + `lib/core-routes.js` run in the page over the vault in memory (shims for node:fs / path / child_process, `yaml` browser build via an import map); every change refreshes the files changed elsewhere first, then writes straight to the phone's iCloud copy (coordinated writes and moves in the shell); a change the shell couldn't write waits in /data/outbox.json and goes to the Mac when it is back (gubernos-ios Gubernos/Outbox.swift). Bundled by the gubernos-ios repo; test in a browser with `build-local.mjs OUT --mock <vault copy>` |
| `lib/feedback.js`, `scripts/feedback-view.mjs` | Bug reports / ideas from the app → a task + `data/feedback.jsonl`; render a report's screen snapshot |
| `lib/vault.js` | Read/write vault markdown (tasks, projects, goals, inbox items, checklist templates in `91_templates/checklists/`). All frontmatter edits go through here |
| `lib/runner.js` | "▶ Run": starts the model's CLI on a task (`llm.agentRun`), streams events, finalizes `agent_state` |
| `lib/llm.js` | The model behind the app, provider-neutral: Claude Code, Codex or Gemini CLI (settings `provider`, Settings → Agents → Model). `ask({system, prompt, schema})` one-shot structured, `chatTurn` read-only resumable chat, `agentRun` a task run; gubernos-tools plugged into each. Codex needs strict schemas (`strict()` / `unnull()`); Gemini gets the schema in the prompt |
| `lib/voice.js` | Whisper workers (quick/full processes), `interpret()` = utterance → task drafts or a command |
| `lib/stt.py` | Whisper worker (MLX), one process per model, JSON lines over stdin/stdout |
| `lib/dates.js` | Date spec → local date. The model never computes dates |
| `lib/chat.js` | "Ask" chat: read-only `llm.chatTurn` over the vault with screen context, resumable sessions, structured actions |
| `lib/attachments.js` | Uploaded files → vault `40_reference/attachments/YYYY-MM/`, linked from the task/project `## Attachments`; served back read-only |
| `lib/pomodoros.js` | Finished pomodoros → vault `50_reviews/pomodoros.csv`, stats |
| `lib/daily.js` | The day's file `50_reviews/daily/YYYY-MM-DD.md` (vault CLAUDE.md → "Daily file"): several writers, so every write changes one section (`writeSection`/`update`) and keeps the rest. `## Plan` (#1, the morning plan, blocks, Added later, the evening `Plan:` line), `## Habits` parsing; plan vs actual: `noteTask` (task hooks in core-routes), `closeDay`, `pace`, `oneStreak`, `carryOvers` |
| `lib/oura.js` | Oura API v2 (read only; token in `~/.config/gubernos/oura.json` or `OURA_TOKEN`; `GUBERNOS_OURA_API` for a stub) → `applyAuto` for habits with `auto: oura:<metric>`; hourly from the notifier, `POST /api/oura/sync` now |
| `lib/habits.js` | Habits + AM/PM protocols (vault `05_model/habits/`, `protocols/`): check-ins into the day's `## Habits`, history (week, streak with never-miss-twice, rate), the workday between the protocols (`workday()`, used by the planner), `dayView` for the Protocol screen (view key `day`, `#/day` or `#/protocol`), editing (`updateHabit`: title, links, target…, a `## Log` line per change) and order (`arrange`: drag between blocks; Day's order in `protocols/day.md`). Off with Settings → `habits: false`; history before the daily files as stats in vault `50_reviews/habit-stats.csv` (`readStats`; streaks, totals and the last 28 days continue from it), filled by `scripts/import-habit-stats.mjs <Habit Tracker export.csv> [--through DATE] [--dry]`; rolled forward weekly by `scripts/roll-habit-stats.mjs [--through DATE]` (`rollStats`: the week's check-ins → the rows, their `## Habits` sections → vault `80_archive/habits/`) |
| `lib/assist.js` | Model helpers (`llm.ask`): break down, why this one, semantic search |
| `lib/google.js` | Google OAuth (Calendar + Gmail scopes, one token), `gfetch()` |
| `lib/gcal.js` | Google Calendar: free slots, events (create/move/delete/list) |
| `lib/contacts.js`, `lib/drive.js` | Google Contacts (People API) search; Drive search + read as text. Read-only, for gubernos-tools |
| `lib/gmail.js` | Gmail: search, thread as plain text; draft/send (app only, after the confirmation card) |
| `tools/gubernos-tools.js` | Stdio MCP server (no SDK) with READ-ONLY integration tools for agents: `gmail_search`, `gmail_thread`, `calendar_events`, `contacts_search`, `drive_search`, `drive_read`. Plugged into Ask/task chat and Run with Claude via `mcpArgs()` |
| `tools/calendar/` | The Mac calendar helper (EventKit, Swift) behind `lib/maccal.js`. Ships built: `gubernos-calendar` (universal, ad-hoc signed) + `.src` stamp, so users need no compiler. After changing `main.swift` or `Info.plist` run `scripts/build-calendar.sh` and commit the binary and stamp |
| `lib/model.js` | Personal model (vault `05_model/`): areas, containers a task can live in, goal details, decisions (read / record per the vault's Decision queue / park), `focus.md` (quarter, this week's wins). Writes only what the vault's AGENTS.md agrees on; weeks (`isoWeek`, `weekStartDate`) follow Settings → `weekStart` (monday | sunday): the wins week, the weekly review, pomodoros and habits this week |
| `lib/planner.js` | Day planner: free time today from the calendar (the workday between the AM and PM protocols, else profile.md's 9–19, − meetings − lunch; "Focus time" is free), the agent's draft (minutes, must-today, where to move), cached per day in `data/plan-cache.json`; capacity from the real pace (lib/daily.js), carry-overs |
| `lib/pair.js` | Pairing: requests from other devices (Tailscale serve) need the Mac's token (Bearer header, or the `gubernos_token` cookie from `/pair?t=`) once `required`; the Mac itself (127.0.0.1, no proxy headers) always gets in. `~/.config/gubernos/pair.json`; Settings → Pair a device shows the QR (`gubernos://pair?url=…&token=…`) |
| `lib/push.js` | Web Push without deps: VAPID JWT (ES256) + RFC 8291 encryption; subscriptions in `data/push-subs.json` |
| `lib/notify.js` | Notifier: reminders, morning digest, AM/PM protocol starts, agent review/blocked transitions (`plan()` is pure — test it with a fixed clock); closes yesterday's plan in the morning if the evening didn't |
| `public/sw.js` | Service worker: shows pushes, tap → open the task. No offline cache on purpose |
| `lib/cron.js` | Next date for a cron `recurrence` |
| `public/app.js` | The whole UI: state `S`, views, drawer, quick add, voice capture, modes (focus/inbox/review), palette, search |
| `public/parse.js` | Quick-add syntax parser (also used by the UI only) |
| `public/app.css` | Styles; light/dark via CSS variables; mobile rules in `@media (max-width: 800px)` |
| `kit/vault/` | The starter vault for new owners (CLAUDE.md, AGENTS.md, profile.md, templates, views, `40_reference/system/`, skills `onboarding` and `process-inbox`). `VAULT_ROOT/` in it = the system folder inside its Obsidian vault, filled in at install |
| `scripts/setup.sh`, `scripts/kit.mjs`, `scripts/update.sh`, `SETUP.md` | Install from scratch (driven by the owner's agent: Claude Code, Codex or Gemini CLI; `setup.sh model` picks the app's model), update; `deploy/*.template` = launchd plists |

Canon rules live in the **vault**: `CLAUDE.md` (schemas), `AGENTS.md` (agent protocol). If you change what the app
writes into task files, update those two as well.

## Run, restart, logs

- Dev: `GUBERNOS_VAULT=<copy> PORT=4748 node server.js`
- Deployed: launchd `com.<user>.gubernos` → `scripts/setup.sh restart` after server changes.
  Static files are served with `no-cache`, so UI-only changes just need a page reload.
- `server.log`; voice/client diagnostics are `[voice]` lines (the phone posts them via `/api/log`).

## Testing changes

- **Never test writes against the real vault.** Quickest: `scripts/test-server.sh start [port]` (a fresh copy in a temp dir, its own
  data dir, no notifier; prints the URL and the copy's path) and `scripts/test-server.sh stop [port]`. By hand: copy it: `cp -R "<vault>" ~/dev/.gubernos-testvault` and run a second
  server with `GUBERNOS_VAULT=~/dev/.gubernos-testvault PORT=4748`. It shares `data/` (push subscriptions!) unless you also set
  `GUBERNOS_DATA_DIR=<tmp>`; without it the server starts no notifier, so it can't push the owner's phone. Don't put the copy under `~/.claude` — headless
  `claude -p` refuses to write there. Delete the copy afterwards.
- UI checks: Playwright (`playwright-core`) driving the installed Google Chrome, at 1280px and at 390px with
  `isMobile/hasTouch`. Voice: Chrome's `--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=clip.wav%noloop`
  with clips made by `say` + `ffmpeg` (note: the fake mic replays the file from the start on every getUserMedia).
- Google: point `GUBERNOS_GCAL_API` / `GUBERNOS_GMAIL_API` / `GUBERNOS_GOOGLE_TOKEN_URL` / `GUBERNOS_GOOGLE_DIR` at a local stub (fake token with all scopes). Never send a real email in a test.
- Anything touching Google or the real vault is an outward action — ask the owner first.
- Install: run `scripts/setup.sh install --vault <tmp> --no-launchd` with `HOME`/`GUBERNOS_CONFIG_DIR` pointed at a temp dir, then start a server on another port.

## Feedback from the app (bug reports and ideas)

The owner reports from any screen (menu → Report, ⌘K, voice "баг: …"). Each report = a task in project
`gubernos-feedback` (labels `feedback` + `bug|idea`) and a JSON line in `data/feedback.jsonl` (`taskId`, `kind`, `text`,
`context`, `files`, `errors`). On the developer's own install a bug is queued for the dev agent at once (see Dev session);
an idea, and any report elsewhere, waits (`status: wait`, `assigned: someone`). To see the screen: `node scripts/feedback-view.mjs
data/feedback/<id>.html` (renders the snapshot with the live app.css at the owner's viewport and scroll; screenshots are
`data/feedback/<id>-N.jpg`). Handle it, then hand it back for review on the task: append an `## Agent log` line
(`POST /api/tasks/<id>/log {author:"claude", text}`) and `PATCH /api/tasks/<id> {assigned:"agent", agent_state:"review", status:"new"}` —
the owner gets the "Agent finished" push and accepts or sends back. A question back = the same, with `agent_state: blocked`.
Reports from other people's installs arrive as GitHub issues (`gh issue list -R <repo> --label feedback`); answer with a
comment (it reaches their task, marked blocked) and close the issue when fixed (their task goes to review). Their
snapshot: the gist linked in the issue (`--filename <id>-share.html`), rendered with `scripts/feedback-view.mjs`.

## Dev session (the dev agent's queue)

On the developer's own install (no `feedbackRepo` in config.json) tasks can be assigned to the agent `dev`: the
developer's Claude Code session in this repo, with this file, memory and the conversation as context. Nothing is started
for it: ▶ Queue (or a bug report) sets `assigned: agent, agent: dev, agent_state: queued`, and the session takes the queue.

- A Claude Code session working on this repo keeps `node scripts/dev-queue.mjs` running in the background: it waits for
  queued dev tasks, prints them (`id | title [labels]`, oldest first) and exits; it also marks the session alive in
  `data/dev-session.json`. Take the tasks, then start it again. `--now` prints the queue without waiting.
- Per task: `PATCH /api/tasks/<id> {agent_state:"running"}`; read the task (`GET /api/tasks/<id>`; a bug's snapshot as
  above); do it — test on a vault copy, commit and push, restart the service, rebuild the iPhone app when public/, local/
  or lib/ changed; then hand it back as above (log line + `agent_state: review`, or `blocked` with the question). A
  product choice the task doesn't settle → blocked with the question, before building.
- The owner's ongoing conversation comes first: take the queue between turns, not in the middle of their request.

## Gotchas (learned the hard way)

- **Two writers of one file through iCloud lose data.** 2026-10-12: the Mac slept through the morning, the phone (offline) saved the AM check-ins into today's daily file, then the half-woken Mac wrote Health values over its own old copy and iCloud kept the Mac's version. Now offline the phone never writes `50_reviews/daily/` (those changes go to the Mac's queue, which merges them), writes other files only when it has their latest version (gubernos-ios VaultStore.write: iCloud status current, not changed since the page read it), skips Health sync, and mirrors the Mac's settings into its own copy while online.

- **iOS audio**: never create an `AudioContext` before `getUserMedia` (iOS then records silence → 0-byte clips).
  Release the mic stream after each recording; reset everything after an empty clip. Hold time counts from the
  moment recording really started (Safari's permission prompt can swallow a "hold").
- **iOS focus**: after tapping a button, focus stays in a textarea — anything that "skips re-render while typing"
  must still re-render when the task's state changes (see `dr.dataset.core` in `renderDrawer`).
- **iCloud + fs.watch**: reading a file updates xattrs, which fs.watch reports as a change → reload loop. The server
  only broadcasts when `.md` names/sizes/mtimes change; own writes call `changed(true)`.
- **iCloud placeholders**: a file written on another Mac (e.g. by an assistant there) can arrive "dataless"; the launchd-started
  server then gets `errno -11` (EDEADLK) on read instead of a download. `readText` in `lib/vault.js` asks
  `brctl download` and retries; lists skip such a file until it's there (`safeMap`) so one file can't 500 the app.
- **mlx_whisper** caches one model and reloads on switch — `stt.py` patches that; and quick/full run as separate
  processes so a command never waits behind the big model.
- **Whisper small** hears command words fine but mangles names → fast path only for commands; search queries and
  dictation use the big model.
- **Grace periods**: completing / dropping / archiving an inbox item / accepting a review are deferred 5 s with
  Undo and flushed on `pagehide` via `keepalive` fetch. Keep new destructive actions on the same pattern.

- **Integrations rule**: agents READ freely (gubernos-tools); anything outward (send mail, create events, message people)
  is returned as a proposed action and executed by the app only after the owner taps (email card, time-block confirm).
  Never put a send/create tool into gubernos-tools. New read integrations = one more entry in `TOOLS`.
- **Google scopes**: adding one needs a single re-connect (`/api/gcal/connect` on the Mac); `gfetch` returns a clear
  409 until then, so Calendar keeps working while Gmail waits.

- **Push on iOS** works only from the home-screen app and only after a tap (permission prompt needs a user gesture).
  Test the protocol against a local endpoint that decrypts (see git history of `lib/push.js`), not Apple's.

- **Personal model files are shared with the assistant** (it may write them from another Mac through iCloud): re-read right before writing,
  touch only the sections the app owns (focus.md → Week / Previous week; a decision being recorded), and mirror any new
  format in the vault's CLAUDE.md / AGENTS.md.

## Conventions

- Match the surrounding code: small functions, comments only for the non-obvious "why".
- Greppable anchors for future agents: `// AICODE-NOTE:`, `// AICODE-TODO:`, `// AICODE-QUESTION:`.
- UI copy is English; keep it short.
- Commit small, descriptive messages; one feature per commit.
- Licenses: code MIT (`LICENSE`), the method in `kit/vault/` CC BY 4.0 (`kit/LICENSE.md`). A new bundled or vendored
  dependency → a row in `THIRD_PARTY_NOTICES.md` and its license text in `public/licenses.txt` (shown in Settings → About).
