# Setting up Gubernos on your Mac

**The short way: let your AI agent do all of it.** Open your agent on the Mac (below, if you have none yet) and paste:

```
Install Gubernos for me: read https://raw.githubusercontent.com/old-bozman/gubernos/main/SETUP.md and do the part "For the agent".
```

That's the whole instruction: the agent fetches the app, installs it, sets up the folder and the phone connection, and
onboards you. You answer its questions and do what only you can: sign in to Tailscale (for the phone), click Allow in a
few macOS dialogs, scan the pairing code and tap on your phone when it asks.

**You (the person):** you need a Mac and **an AI subscription**: Claude with Claude Code (Pro or higher), or any ChatGPT subscription. Don't have one? Get it first: [Claude plans](https://claude.com/pricing) · [ChatGPT plans](https://chatgpt.com/pricing). Then install its command-line agent and sign in:

| You have | Install | Sign in |
|---|---|---|
| **Claude** with Claude Code (Pro or higher) | `curl -fsSL https://claude.ai/install.sh \| bash` | `~/.local/bin/claude` (on a new Mac `claude` alone isn't found until Gubernos' installer adds that folder to your PATH) |
| **ChatGPT**, any subscription | `npm install -g @openai/codex` | `codex login` |

```
curl -fsSL https://raw.githubusercontent.com/old-bozman/gubernos/main/install.sh | bash
cd ~/.gubernos/app
claude        # or: codex
```

The first line gets Node (when the Mac has none) and the app into `~/.gubernos/app`, without sudo, Homebrew or Apple's Command
Line Tools (the app comes as a download; `scripts/update.sh` updates it). A clone works too, for developers: `git clone
https://github.com/old-bozman/gubernos.git ~/.gubernos/app`.

Then say: **"run SETUP.md"**. The agent walks you through the rest (about 20 minutes, plus onboarding).

---

## For the agent: how to run this setup

You (Claude Code or Codex) are installing Gubernos for the person in front of you and then onboarding them. Rules:
- Talk in the language they write in. One step at a time; say what a step does before running it, and show its result in a line or two.
- Questions they must answer (step 2, and any yes/no before installing software): if your agent has a tool for asking with choices to pick from (Claude Code: `AskUserQuestion`; use the equivalent in Codex if it has one), ask through it, one question per item, the recommended choice first. Without such a tool, ask in one message: a numbered list, each with its choices as letters and the default marked, so they can answer "1 Sam, 2 C, 3 default". Say which questions are required and wait for those answers; don't guess them.
- Run `scripts/setup.sh` steps; every step is safe to repeat. The vault goes where the person chose in step 2 (default `~/Gubernos`). Never overwrite or delete files in an existing vault (`kit.mjs` only adds missing files).
- Ask before installing software (brew, Tailscale, Python packages). Never ask for or store passwords or API secrets; files with credentials stay in `~/.config/gubernos/`.
- The repo's `AGENTS.md` describes the app's code; the vault's `CLAUDE.md` / `AGENTS.md` describe the system.

### 0. Get the app (when you came from the prompt, not from inside the repo)

If you aren't in a Gubernos checkout (no `scripts/setup.sh` here): look for `~/.gubernos/app` (`~/gubernos` on an older install); if it's missing, tell the person
what it does and run `curl -fsSL https://raw.githubusercontent.com/old-bozman/gubernos/main/install.sh | bash` (Node
when the Mac has none, the app into `~/.gubernos/app`; no sudo, no Homebrew, no Command Line Tools). Run it right away: don't
probe with `git`, `python3` or `make` first — on a clean Mac each is a stub that opens Apple's Command Line Tools dialog
(which asks for ~19 GB free), and Gubernos doesn't need them. Then work in `~/.gubernos/app` and read this
file from there (it may be newer than the copy you fetched).

The iPhone app comes from TestFlight; step 3b walks them through it.

### 1. Check the Mac

Run `scripts/setup.sh check`. Every "Required" line must be ✓:
- node missing or older than 20 → run `install.sh` again (step 0): it puts Node in `~/.gubernos/node`. No Homebrew needed.
The "Model" lines show which AI CLIs are here and signed in: at least one must be ✓ (if none is, help them install and sign in to the one their plan covers — the table above; with no such subscription, say so and stop until they have one). Note the optional lines; they decide which later steps to offer.

### 2. Ask the person (all six are required; ask them together)

1. **Name** to use, and the **language** for task titles and documents (default: the language they write to you in).
2. **Where the files live.** A folder of plain Markdown files. Recommend A unless they want the files on other devices themselves. The iPhone app doesn't need iCloud: it gets its copy from this Mac. The app keeps a daily copy of the files in `~/.gubernos/backups/` (14 days and 8 weeks).
   - **A. On this Mac** (default): `~/Gubernos`.
   - **B. In iCloud Drive**, to open the files on other devices too: `~/Library/Mobile Documents/com~apple~CloudDocs/Gubernos`.
   - **C. In Obsidian**, new vault (they use or want Obsidian, incl. on the iPhone): `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Gubernos` → options `--obsidian-vault Gubernos` (needs the Obsidian iCloud folder: `check` shows it); inside a vault they already have: `<that vault>/Gubernos` → `--obsidian-vault "<vault name>" --obsidian-path Gubernos`.
   - **D. An existing vault** made from this kit: its path (nothing is overwritten).
3. **Which model** the app should use, when more than one is ✓ (default: the one running this setup). It reads their inbox and voice notes, answers in the app's chat and runs agents on tasks — on their own plan. They can switch later in Settings → Your Mac → Model.
4. Is this Mac **always on** (a desktop, or a laptop that stays plugged in)? Then `--awake` keeps it from sleeping on power, so the phone app and notifications work all day. A laptop they carry around works too; the app is simply unavailable while it sleeps.
5. **Voice**: which language will they speak to the app (the mic button)? Default: the language from question 1. One language that this Mac's own speech model knows (English, German, French, Spanish, Italian, Japanese, Korean, Chinese and more; `tools/voice/gubernos-voice locales` lists them; macOS 26+) works right away, nothing to install. **Russian**, **several languages mixed**, or a **strong accent** they want heard well: recommend Whisper (`scripts/setup.sh voice` in step 4, a ~1.6 GB download on first use, Apple Silicon); it is much better there. Pass `--voice-language <locale>` (`en-US`, `ru-RU`, …) or `mixed`.
6. **iPhone**: do they have one? Then they get the Gubernos iPhone app and connect it to this Mac in step 3b (about 10 minutes: Tailscale on this Mac, two codes to scan). Without an iPhone, skip 3b; the app works in a browser too.

### 3. Install

```
scripts/setup.sh install --vault "<path>" --name "<Name>" --language "<Language>" --model <claude|codex> --voice-language <en-US|ru-RU|…|mixed> [--obsidian-vault … --obsidian-path …] [--awake]
```

It installs dependencies, creates the vault from `kit/vault` (folders, `CLAUDE.md`, `AGENTS.md`, `profile.md`, templates, views, `40_reference/system/`), writes `~/.config/gubernos/config.json`, and starts the app in the background (launchd, restarts on crash and at login). Port 4747 is the default; `--port` if it's taken.

Then tell them:
- Only for a folder in iCloud (B, C): **keep it downloaded**: Finder → iCloud Drive (or Obsidian) → right-click the system folder → **Keep Downloaded**. Otherwise macOS may offload files and the app can't read them.
- **Open the app**: `open http://127.0.0.1:4747`. For a separate app window: Safari → File → **Add to Dock**.

### 3b. iPhone (when they have one)

Lead them through it; don't stop at a link. Open the guide on the Mac: `open "http://127.0.0.1:<port>/#/phone"` — it shows both codes and turns to ✓ when the phone has connected.
1. **The app**: they scan code 1 with the iPhone's Camera (TestFlight from the App Store if asked, then Accept → Install) and open Gubernos once (allow notifications).
2. **An address for this Mac.** Say what happens, then run `scripts/setup.sh phone`: it downloads Cloudflare's `cloudflared` (checks it is signed by Cloudflare Inc.) into `~/.gubernos/bin`, gets this Mac an `https://m-….gubernos.dev` address from relay.gubernos.app and keeps the tunnel running in the background. Nothing to install by hand, no password, no account. Only paired devices get in (lib/pair.js; repeated wrong codes are turned away). Say plainly: the traffic goes through Cloudflare, on the developer's account, and HTTPS ends there (Cloudflare could see it). We don't store it; Cloudflare may keep request data, such as IP addresses and page addresses, under its own policy. Someone who wants HTTPS to end on this Mac: `scripts/setup.sh phone --tailscale` (Tailscale Funnel: its installer, their Mac password, a Tailscale account; the script waits for each step), or `--private` to keep the Mac off the internet (Tailscale on the iPhone too, same account, VPN On Demand on).
4. **Connect**: the guide's code 2 appears; they scan it with the Camera → Open in Gubernos. Wait for ✓ on the guide (or `curl -s 127.0.0.1:<port>/api/pair` shows `seenAt`), then ask them to check that the phone shows their tasks.
5. Tell them: the Mac has to be awake for agents, chat and voice on the phone (offer `--awake` / `scripts/setup.sh awake on` if they didn't choose it).

### 4. Optional extras — offer each, do what they want

- **Bug reports to the developer**: nothing to do — `install` turns it on (it says so). Reports from the app's Report button go to the developer privately through relay.gubernos.app (no GitHub account), and answers come back to their task.
- **Pushes to the iPhone app** go through the same relay (tell them): Apple accepts pushes only signed with the app developer's key, so this Mac sends the alert (its title and text: a task, the agent's last message) to relay.gubernos.app, which signs it and passes it to Apple; nothing is stored there. Off: Settings → Your Mac → Pushes through the relay (then no pushes from the Mac; reminders and check-ins the phone schedules itself still ring).
- **Phone later**: if they skipped 3b, it can be done any time the same way (Settings → Your Mac → iPhone and other devices → Connect your iPhone).
- **Keep the Mac awake**: if this Mac should serve the phone all day, `scripts/setup.sh awake on` — a login item running `caffeinate -s`: no sleep while on power (on battery it sleeps as usual; a laptop with its lid closed still sleeps). `awake off` undoes it, `awake status` checks. Same as `--awake` at install.
- **Voice**: with one language the Mac's own model knows, the mic already works (install said so). Whisper (`scripts/setup.sh voice`, Apple Silicon): needed for Russian or mixed languages, better with accents; no Homebrew or Command Line Tools (it gets its own Python via `uv`), models ~1.6 GB on first use. Language later: the app → Settings → Voice.
- **Obsidian** (option A or C with Obsidian installed): `scripts/setup.sh obsidian` installs the Dataview and Templater plugins into the vault; then in Obsidian: **Open folder as vault** → the system folder → trust the plugins when asked. (For option B their vault already has its own plugin setup — leave it.)
- **Calendar** (Plan the day sees their meetings and puts time blocks in): `scripts/setup.sh calendar` — macOS shows a dialog "Gubernos Calendar would like full access to your calendars": they click **Allow**. It reads every account added in the Calendar app (iCloud, Google, Exchange…); if their work or Google calendar isn't there yet: Calendar → Settings → Accounts → add it. Which calendars count and where blocks go: the app → Settings → Your Mac → Calendar / Calendars. No Google Cloud setup needed.
- **Google for agents** (Gmail, Contacts, Drive; or Google Calendar directly instead of the Mac's): walk them through `docs/google.md` (~15–20 minutes in Google Cloud). Only if they want agents to read their mail or documents. Ask first whether they have Google Workspace — then the Internal route (A) is the one: it never expires. Otherwise Testing (B) with a reconnect every 7 days. They can do it later.
- **Tasks from another app** (Apple Reminders, Things 3 or Todoist): ask which app they used. The import itself happens after the interview (step 5 here), with `node scripts/import-tasks.mjs reminders | things | todoist`: it only reads the other app (Reminders and Things: macOS asks once, they click **OK** / **Allow**; Todoist: they paste the API token from Todoist → Settings → Integrations → Developer when the script asks, never into the chat). They choose what comes over on a sheet; nothing is created before that. Other apps (TickTick, Google Tasks, OmniFocus…): their export file, read by the onboarding.
- **Another model as a second agent**: any other CLI from the table above, installed and signed in, can take tasks too (Settings → Your Mac → Agents: Codex, Claude).
- **A chat assistant** they already run (a bot that can read and write files on this Mac): set `assistant: <Name>` in `profile.md`, and point the bot at the vault's `AGENTS.md`. Tasks with `agent: <name>` are then left for it.

### 5. Onboarding

Read `<vault>/.claude/skills/onboarding/SKILL.md` and follow it right here, using paths inside the vault (or, later, they can open their agent in the vault folder and say "run the onboarding skill", and Claude Code also has it as `/onboarding`). It's a short interview, 15–20 minutes at most: they talk, it files what matters straight away, without asking them to confirm. If they have tasks in another app, do the import after it (the skill's last section).

### 6. Finish

Summarise in a few lines: where the vault is, the app URL (and phone URL), what's set up and what's left for later, and two habits: **every morning** Plan the day (the push opens it), **every week** the Weekly review screen.
For daily work in the files they can run their agent (`claude` or `codex`) inside the vault folder: `CLAUDE.md` and `AGENTS.md` there tell any agent how the system works; "process my inbox" (the `process-inbox` skill; `/process-inbox` in Claude Code) clears the inbox.

---

## Updating

`scripts/update.sh` pulls the latest version, reinstalls dependencies and restarts the app. If it reports that the **vault kit changed**, bring the vault up to date with the agent ("update my vault from the kit"):
- for each changed file under `kit/vault/`: if the vault's copy is unchanged from the old kit version (`git show <old>:kit/vault/<file>` in a git checkout; `.kit-previous/<file>` in an install without git), replace it with the new one (replace `VAULT_ROOT/` with the vault's Obsidian sub-path, or nothing);
- if the person changed it, merge: keep their changes, add the kit's, and show the diff before writing;
- set `kit_version` in `profile.md` to the version in `kit/vault/profile.md`.

### When the update says the folder also holds the person's files

Installs made while the app's folder was `~/gubernos` and the default vault `~/Gubernos` have both in one folder, because macOS ignores case in folder names. `install.sh` refuses to update these, since replacing the app's files there would delete the vault. Move the app out, in this order:

1. `rm ~/gubernos/.gubernos-version`, then run `install.sh` again (the first line of this file's install command). The app lands in `~/.gubernos/app`.
2. `mv ~/gubernos/data ~/.gubernos/app/data`, then from `~/.gubernos/app`: `scripts/setup.sh install --vault ~/Gubernos --name "<their name>"`. The service now runs from the new folder; the vault's files aren't touched.
3. In `~/Gubernos`, replace `CLAUDE.md`, `AGENTS.md` and `README.md` with the ones in `~/.gubernos/app/kit/vault/`: the ones there now are the app's.
4. Show the person what's left of the app in `~/Gubernos` (`lib`, `public`, `scripts`, `node_modules`, `deploy`, `docs`, `kit`, `local`, `relay`, `tests`, `tools`, `server.js`, `server.log`, `package.json`, `package-lock.json`, `install.sh`, `SETUP.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md`) and remove it once they say yes.

## Troubleshooting

- **The app doesn't open**: `scripts/setup.sh status`; the log is `server.log` in this folder; restart with `scripts/setup.sh restart`.
- **"Resource deadlock avoided" / errno -11 / files missing**: a folder in iCloud whose files iCloud offloaded — Keep Downloaded on the system folder (step 3).
- **Agents don't run, the chat doesn't answer**: the model's CLI must be signed in — `scripts/setup.sh check` shows it under "Model" (`claude` or `codex login`). Which one the app uses: Settings → Your Mac → Model, or `scripts/setup.sh model <claude|codex>`.
- **No notifications on the iPhone**: only from the home-screen app (iOS 16.4+), with Notifications on in the app's Settings, and the Mac awake.
- **Port in use**: `scripts/setup.sh install … --port 4748` (same vault; nothing is overwritten).
