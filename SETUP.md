# Setting up Gubernos on your Mac

**The short way: let your AI agent do all of it.** Open your agent on the Mac (below, if you have none yet) and paste:

```
Install Gubernos for me: read https://raw.githubusercontent.com/old-bozman/gubernos/main/SETUP.md and do the part "For the agent".
```

That's the whole instruction: the agent fetches the app, installs it, sets up the folder and the phone connection, and
onboards you. You answer its questions and do what only you can: sign in to Tailscale (for the phone), click Allow in a
few macOS dialogs, scan the pairing code and tap on your phone when it asks.

**You (the person):** you need a Mac and **one** AI model on your own plan — its command-line agent installed and signed in:

| You have | Install | Sign in |
|---|---|---|
| **Claude** Pro or Max | `curl -fsSL https://claude.ai/install.sh \| bash` | `claude` |
| **ChatGPT** Plus or Pro | `npm install -g @openai/codex` | `codex login` |
| a **Google** account (free tier) | `npm install -g @google/gemini-cli` | an API key from https://aistudio.google.com/apikey → `GEMINI_API_KEY=<key>` in `~/.gemini/.env`, then `gemini` once → Use Gemini API key (Login with Google no longer works for Gemini CLI) |

```
curl -fsSL https://raw.githubusercontent.com/old-bozman/gubernos/main/install.sh | bash
cd ~/gubernos
claude        # or: codex · gemini
```

The first line gets Node (when the Mac has none) and the app into `~/gubernos`, without sudo, Homebrew or Apple's Command
Line Tools (the app comes as a download; `scripts/update.sh` updates it). A clone works too, for developers: `git clone
https://github.com/old-bozman/gubernos.git ~/gubernos`.

Then say: **"run SETUP.md"**. The agent walks you through the rest (about 20 minutes, plus onboarding).

---

## For the agent: how to run this setup

You (Claude Code, Codex or Gemini CLI) are installing Gubernos for the person in front of you and then onboarding them. Rules:
- Talk in the language they write in. One step at a time; say what a step does before running it, and show its result in a line or two.
- Run `scripts/setup.sh` steps; every step is safe to repeat. The vault always goes to iCloud (`--local` exists only for development and tests — never use it for a real install). Never overwrite or delete files in an existing vault (`kit.mjs` only adds missing files).
- Ask before installing software (brew, Tailscale, Python packages). Never ask for or store passwords or API secrets; files with credentials stay in `~/.config/gubernos/`.
- The repo's `AGENTS.md` describes the app's code; the vault's `CLAUDE.md` / `AGENTS.md` describe the system.

### 0. Get the app (when you came from the prompt, not from inside the repo)

If you aren't in a Gubernos checkout (no `scripts/setup.sh` here): look for `~/gubernos`; if it's missing, tell the person
what it does and run `curl -fsSL https://raw.githubusercontent.com/old-bozman/gubernos/main/install.sh | bash` (Node
when the Mac has none, the app into `~/gubernos`; no sudo, no Homebrew, no Command Line Tools). Run it right away: don't
probe with `git`, `python3` or `make` first — on a clean Mac each is a stub that opens Apple's Command Line Tools dialog
(which asks for ~19 GB free), and Gubernos doesn't need them. Then work in `~/gubernos` and read this
file from there (it may be newer than the copy you fetched).

The iPhone app comes from TestFlight: https://testflight.apple.com/join/rBUGmgJG — give them the link when you reach the
phone step (they install TestFlight first, then open the link on the iPhone → Accept → Install).

### 1. Check the Mac

Run `scripts/setup.sh check`. Every "Required" line must be ✓:
- node missing or older than 20 → run `install.sh` again (step 0): it puts Node in `~/.gubernos/node`. No Homebrew needed.
The "Model" lines show which AI CLIs are here and signed in: at least one must be ✓ (if none is, help them install and sign in to the one their plan covers — the table above). Note the optional lines; they decide which later steps to offer.

### 2. Ask the person (one message)

1. **Name** to use, and the **language** for task titles and documents (default: the language they write to you in).
2. **Where the files live.** Always in iCloud — it is the backup, it brings the files to the iPhone (Obsidian) and to other Macs (an assistant running there). `setup.sh` refuses other places. Check that iCloud Drive is on (`check` shows it). The choices:
   - **A. Obsidian, new vault** (they use or want Obsidian, incl. on the iPhone): `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Gubernos` → options `--obsidian-vault Gubernos`. Needs the Obsidian iCloud folder (`check` shows it); if missing, they open Obsidian on the iPhone or Mac once and create any vault in iCloud, or pick C.
   - **B. Inside an Obsidian vault they already have**: `<that vault>/Gubernos` → `--obsidian-vault "<vault name>" --obsidian-path Gubernos`.
   - **C. No Obsidian**: `~/Library/Mobile Documents/com~apple~CloudDocs/Gubernos` (iCloud Drive). They can add Obsidian later.
   - **D. An existing vault** made from this kit, in iCloud: its path (nothing is overwritten).
3. **Which model** the app should use, when more than one is ✓ (default: the one running this setup). It reads their inbox and voice notes, answers in the app's chat and runs agents on tasks — on their own plan. They can switch later in Settings → Agents → Model.
4. Is this Mac **always on** (a desktop, or a laptop that stays plugged in)? Then `--awake` keeps it from sleeping on power, so the phone app and notifications work all day. A laptop they carry around works too; the app is simply unavailable while it sleeps.

### 3. Install

```
scripts/setup.sh install --vault "<path>" --name "<Name>" --language "<Language>" --model <claude|codex|gemini> [--obsidian-vault … --obsidian-path …] [--awake]
```

It installs dependencies, creates the vault from `kit/vault` (folders, `CLAUDE.md`, `AGENTS.md`, `profile.md`, templates, views, `40_reference/system/`), writes `~/.config/gubernos/config.json`, and starts the app in the background (launchd, restarts on crash and at login). Port 4747 is the default; `--port` if it's taken.

Then tell them:
- **Keep the folder downloaded**: Finder → iCloud Drive (or Obsidian) → right-click the system folder → **Keep Downloaded**. Otherwise macOS may offload files and the app can't read them.
- **Open the app**: `open http://127.0.0.1:4747`. For a separate app window: Safari → File → **Add to Dock**.

### 4. Optional extras — offer each, do what they want

- **Bug reports to the developer**: `install` sets this up when the repo isn't theirs (it says so) — reports from the app's Report button also open a GitHub issue in the repo, and answers come back to their task. It needs `gh` logged in (`gh auth login`); if `check` shows it missing, install with `brew install gh`.
- **Phone** (the Gubernos iPhone app, from TestFlight / the App Store; needs Tailscale on the Mac and the iPhone, logged in with the same account: https://tailscale.com/download — on the iPhone turn on VPN On Demand): `scripts/setup.sh phone` sets up HTTPS for the phone and requires pairing. The first time Tailscale may show a link to enable HTTPS for their tailnet: they open it and approve. Then pairing: on the Mac, the app → Settings → Connections → **Pair a device** → Show code; they scan it with the iPhone camera → Open in Gubernos. If they made their system on the iPhone first (Start a new system), the vault in step 2 is that folder (choice D). The Mac must be awake for agents, chat and calendar on the phone.
- **Keep the Mac awake**: if this Mac should serve the phone all day, `scripts/setup.sh awake on` — a login item running `caffeinate -s`: no sleep while on power (on battery it sleeps as usual; a laptop with its lid closed still sleeps). `awake off` undoes it, `awake status` checks. Same as `--awake` at install.
- **Voice** (Apple Silicon): `scripts/setup.sh voice` — the mic button in the app, transcribed locally.
- **Obsidian** (option A or C with Obsidian installed): `scripts/setup.sh obsidian` installs the Dataview and Templater plugins into the vault; then in Obsidian: **Open folder as vault** → the system folder → trust the plugins when asked. (For option B their vault already has its own plugin setup — leave it.)
- **Calendar** (Plan the day sees their meetings and puts time blocks in): `scripts/setup.sh calendar` — macOS shows a dialog "Gubernos Calendar would like full access to your calendars": they click **Allow**. It reads every account added in the Calendar app (iCloud, Google, Exchange…); if their work or Google calendar isn't there yet: Calendar → Settings → Accounts → add it. Which calendars count and where blocks go: the app → Settings → Calendar / Calendars. No Google Cloud setup needed.
- **Google for agents** (Gmail, Contacts, Drive; or Google Calendar directly instead of the Mac's): walk them through `docs/google.md` (~15–20 minutes in Google Cloud). Only if they want agents to read their mail or documents. Ask first whether they have Google Workspace — then the Internal route (A) is the one: it never expires. Otherwise Testing (B) with a reconnect every 7 days. They can do it later.
- **Another model as a second agent**: any other CLI from the table above, installed and signed in, can take tasks too (Settings → Agents: Codex, Gemini, Claude).
- **A chat assistant** they already run (a bot that can read and write files on this Mac): set `assistant: <Name>` in `profile.md`, and point the bot at the vault's `AGENTS.md`. Tasks with `agent: <name>` are then left for it.

### 5. Onboarding

Read `<vault>/.claude/skills/onboarding/SKILL.md` and follow it right here, using paths inside the vault (or, later, they can open their agent in the vault folder and say "run the onboarding skill" — Claude Code also has it as `/onboarding`). It interviews them (about them, areas, what's on their plate including an import from their old app, commitments, wants, decisions, focus) and ends with a short tour of the daily and weekly loop. It can be split over several sessions; progress is kept in `40_reference/system/onboarding.md`.

### 6. Finish

Summarise in a few lines: where the vault is, the app URL (and phone URL), what's set up and what's left for later, and two habits: **every morning** Plan the day (the push opens it), **every week** the Weekly review screen.
For daily work in the files they can run their agent (`claude`, `codex` or `gemini`) inside the vault folder: `CLAUDE.md` and `AGENTS.md` there tell any agent how the system works; "process my inbox" (the `process-inbox` skill; `/process-inbox` in Claude Code) clears the inbox.

---

## Updating

`scripts/update.sh` pulls the latest version, reinstalls dependencies and restarts the app. If it reports that the **vault kit changed**, bring the vault up to date with the agent ("update my vault from the kit"):
- for each changed file under `kit/vault/`: if the vault's copy is unchanged from the old kit version (`git show <old>:kit/vault/<file>` in a git checkout; `.kit-previous/<file>` in an install without git), replace it with the new one (replace `VAULT_ROOT/` with the vault's Obsidian sub-path, or nothing);
- if the person changed it, merge: keep their changes, add the kit's, and show the diff before writing;
- set `kit_version` in `profile.md` to the version in `kit/vault/profile.md`.

## Troubleshooting

- **The app doesn't open**: `scripts/setup.sh status`; the log is `server.log` in this folder; restart with `scripts/setup.sh restart`.
- **"Resource deadlock avoided" / errno -11 / files missing**: iCloud offloaded them — Keep Downloaded on the system folder (step 3).
- **Agents don't run, the chat doesn't answer**: the model's CLI must be signed in — `scripts/setup.sh check` shows it under "Model" (`claude`, `codex login`, or for Gemini an API key in `~/.gemini/.env`). Which one the app uses: Settings → Agents → Model, or `scripts/setup.sh model <claude|codex|gemini>`.
- **No notifications on the iPhone**: only from the home-screen app (iOS 16.4+), with Notifications on in the app's Settings, and the Mac awake.
- **Port in use**: `scripts/setup.sh install … --port 4748` (same vault; nothing is overwritten).
