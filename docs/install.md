# Getting started with Gubernos

**Gubernos** (Gubern OS, from Latin *gubernare*, to steer) is a personal operating system: tasks, projects, goals, habits and your day, with agents that take part of the work off your hands. Everything stays yours: plain Markdown files in your iCloud, your Mac as the "server", agents on your own Claude subscription. No third-party server, no one else's database.

Two steps. First the iPhone alone, 5 minutes. Then the Mac, when you want agents.

**Or skip the reading:** on the Mac, open your AI agent (Claude Code, Codex or Gemini CLI) and paste
`Install Gubernos for me: read https://raw.githubusercontent.com/old-bozman/gubernos/main/SETUP.md and do the part "For the agent".` — it does the Mac part for you and tells you when to tap on the phone.

## 1. iPhone (5 minutes)

1. Install **TestFlight** from the App Store, open [testflight.apple.com/join/rBUGmgJG](https://testflight.apple.com/join/rBUGmgJG) on the iPhone and tap **Accept** → **Install**.
2. Open Gubernos → **Start a new system** → in the file picker: iCloud Drive → New Folder, e.g. `Gubernos` → choose it. If you use Obsidian, you can create the folder inside Obsidian's iCloud folder, and the files show up in Obsidian too.
3. Allow notifications (reminders and the morning plan come from the phone itself) and, if you want habits from Apple Health, Health access.

This already works: tasks, Inbox, projects, habits and protocols, reminders, voice capture (recognised on the iPhone), widgets, the Apple Watch. Agents, the chat with an agent, the calendar in Plan the day and inbox triage need the Mac: that's step 2.

## 2. Mac: agents, chat, voice, calendar (about 30 minutes)

**You need:** a Mac (ideally one that is usually on) and **one** AI model on your own plan — whichever you already have:

| You have | Its agent for the Terminal | Install | Sign in |
|---|---|---|---|
| **Claude** Pro or Max | Claude Code | `curl -fsSL https://claude.ai/install.sh \| bash` | `~/.local/bin/claude` |
| **ChatGPT** Plus or Pro | Codex | `npm install -g @openai/codex` | `codex login` |
| a **Google** account (free tier) | Gemini CLI | `npm install -g @google/gemini-cli` | an API key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → put `GEMINI_API_KEY=<key>` in `~/.gemini/.env`, then `gemini` once → **Use Gemini API key** |

That model reads your inbox and voice notes, answers in the app's chat and runs agents on tasks. You can switch later (Settings → Agents → Model), or install a second one as another agent.

1. **Get the app.** Open Terminal and paste:
   ```
   curl -fsSL https://raw.githubusercontent.com/old-bozman/gubernos/main/install.sh | bash
   ```
   It gets what's needed without asking for your password (Node if the Mac has none) and puts the app in `~/gubernos`. Nothing else to install from Apple.
2. **Install your model's agent** from the table above (the Install command, then the Sign in one), then open it in the app's folder:
   ```
   cd ~/gubernos && claude        # or: codex · gemini
   ```
3. **Say "run SETUP.md".** The agent takes it from there:
   - checks the Mac and installs what's missing (asking first);
   - asks your name and language and **which folder to use: pick the one you created on the iPhone** ("an existing folder in iCloud"), so the phone and the Mac work on the same files;
   - starts Gubernos on the Mac as a background service;
   - connects your calendar (the ones in the Calendar app: one **Allow** in a macOS dialog), and optionally voice (Whisper), Obsidian and Google for agents (Gmail, Drive; see [google.md](google.md));
   - ends with an interview: who you are, what matters, what's in progress. You can bring an export from Todoist, Things or Reminders.

On the Mac the app is at http://127.0.0.1:4747 (Safari → File → Add to Dock opens it in its own window).

**Agents** are ready right away, on your own plan. A task assigned to "agent" starts with ▶ Run on the task card; the result arrives as a push on the phone.

## 3. Pair the iPhone with the Mac (3 minutes)

The phone reaches your Mac through **Tailscale**, a private network of your own devices.

1. Install **Tailscale** on the Mac and the iPhone (https://tailscale.com/download, "Tailscale" in the App Store) and sign in to both with **the same account**. On the iPhone, turn on **VPN On Demand** in Tailscale's settings so the connection doesn't drop.
2. Tell your agent in Terminal: **"connect my phone"** (that's `scripts/setup.sh phone`). If Tailscale shows a login.tailscale.com link, open it and allow HTTPS.
3. On the Mac open Gubernos → ☰ → **Settings** → **Connections** → **Pair a device** → **Show code**.
4. Point the **iPhone camera** at the code → Open in Gubernos. The app remembers the Mac's address and connects: agents, chat and the calendar appear.

The code lets in only your devices: without it the Mac doesn't answer even inside your Tailscale network. Lost a phone? On the Mac, same place, **New code**: every old device is unpaired.

It works while the Mac is on and awake. Without the Mac the phone keeps working on its own and sends its changes once the Mac is back.

## Keep the Mac awake

If the Mac sits at home on power, tell your agent **"keep my Mac awake"**: that's `scripts/setup.sh awake on` (`caffeinate -s` as a login item: on power the Mac doesn't sleep, the screen still turns off as usual; on battery it sleeps as always). A laptop with the lid closed still sleeps: keep the lid open or use an external display.

- Check: `scripts/setup.sh awake status`
- Back to normal sleep: `scripts/setup.sh awake off`

## Report a bug or an idea

From any screen: menu ☰ → **Report bug / idea**, or by voice: "bug: …", "app idea: …". The report becomes a **public** GitHub issue in the app's repository, under your GitHub account, so leave out private details. It holds your text, the screen name, the device and errors. Screenshots (yours, and a snapshot of the screen) go along too, which helps the most: they show your tasks, and anyone with the link can open them, so untick **Publish screenshots** to send only the text. A voice report opens the form first, so you see what goes out. The answer comes back as a push.

In TestFlight you can also take a screenshot → Share Beta Feedback.

---

The method is inspired by David Allen's Getting Things Done® and Gabriele Oettingen's WOOP; Gubernos is not affiliated with the David Allen Company.
