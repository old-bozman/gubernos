# Getting started with Gubernos

**Gubernos** (Gubern OS, from Latin *gubernare*, to steer) is a personal operating system: tasks, projects, goals, habits and your day, with agents that take part of the work off your hands. Everything stays yours: plain Markdown files on your Mac (or in your iCloud, if you like), your Mac as the "server", agents on your own Claude subscription. No third-party server, no one else's database.

**Before you install: you need a paid AI subscription.** Gubernos runs on your own plan: Claude (Pro or higher) or ChatGPT (Plus or higher). The first interview, the chat and the agents all need it, and free plans aren't supported. Don't have one? Get it first: [Claude plans](https://claude.com/pricing) · [ChatGPT plans](https://chatgpt.com/pricing).

Two steps: the Mac, then the iPhone.

**The easiest way (no Terminal):** download **[Gubernos.dmg](https://github.com/old-bozman/gubernos/releases/latest/download/Gubernos.dmg)** (macOS 13 or later), open it and double-click
**Gubernos**; macOS asks whether to open an app downloaded from the Internet: **Open**. A page in your browser asks your
name, where your files live and your AI model (it gets it for you, you sign in), sets everything up and hands over to a
15–20 minute interview that fills your system. Then go to [2. iPhone](#2-iphone-5-minutes). The rest of this part is the
same setup done by your AI agent or by hand, for those who prefer it.

**Or skip the reading:** on the Mac, open your AI agent (Claude Code or Codex) and paste
`Install Gubernos for me: read https://raw.githubusercontent.com/old-bozman/gubernos/main/SETUP.md and do the part "For the agent".` — it does the Mac part for you and tells you when to tap on the phone.

## 1. Mac (about 30 minutes, mostly your agent working)

**You need:** a Mac (ideally one that is usually on) and a **paid AI plan** — whichever you already have:

| You have | Its agent for the Terminal | Install | Sign in |
|---|---|---|---|
| **Claude** Pro or higher | Claude Code | `curl -fsSL https://claude.ai/install.sh \| bash` | `~/.local/bin/claude` |
| **ChatGPT** Plus or higher | Codex | `npm install -g @openai/codex` | `codex login` |

That model reads your inbox and voice notes, answers in the app's chat and runs agents on tasks. You can switch later (Settings → Agents → Model), or install a second one as another agent.

1. **Get the app.** Open Terminal and paste:
   ```
   curl -fsSL https://raw.githubusercontent.com/old-bozman/gubernos/main/install.sh | bash
   ```
   It gets what's needed without asking for your password (Node if the Mac has none) and puts the app in `~/.gubernos/app`. Nothing else to install from Apple.
2. **Install your model's agent** from the table above (the Install command, then the Sign in one), then open it in the app's folder:
   ```
   cd ~/.gubernos/app && claude        # or: codex
   ```
3. **Say "run SETUP.md".** The agent takes it from there:
   - checks the Mac and installs what's missing (asking first);
   - asks your name and language and **where your files live**: a folder on the Mac (`~/Gubernos`, the default), or in iCloud Drive / Obsidian if you want the files on other devices too. The app keeps a daily copy of them in `~/.gubernos/backups/` (the last 14 days and 8 weeks);
   - starts Gubernos on the Mac as a background service;
   - connects your calendar (the ones in the Calendar app: one **Allow** in a macOS dialog), and optionally voice (Whisper), Obsidian and Google for agents (Gmail, Drive; see [google.md](google.md));
   - ends with a short interview, 15–20 minutes: you talk, and what matters goes straight into your system. After it you can bring an export from Todoist, Things or Reminders.

On the Mac the app is at http://127.0.0.1:4747 (Safari → File → Add to Dock opens it in its own window).

**Agents** are ready right away, on your own plan. A task assigned to "agent" starts with ▶ Run on the task card; the result arrives as a push on the phone (your Mac sends it through relay.gubernos.app, which signs it for Apple; it carries the notification text only).

## 2. iPhone (5 minutes)

Install **TestFlight** from the App Store, open [testflight.apple.com/join/rBUGmgJG](https://testflight.apple.com/join/rBUGmgJG) on the iPhone and tap **Accept** → **Install**. Then connect it to the Mac. Your agent does this with you if you said you have an iPhone; you can also do it later: Gubernos on the Mac → ☰ → **Settings** → **Connections** → **Connect your iPhone**. That screen shows two codes and a ✓ when the phone is in.

1. Tell your agent: **"connect my phone"** (that's `scripts/setup.sh phone`). Your Mac gets an address like `https://m-3f2a….gubernos.dev` the phone reaches from anywhere: Cloudflare's small `cloudflared` program runs in the background on the Mac. Nothing to sign in to, nothing on the phone. The traffic passes through Cloudflare, on the developer's account, and HTTPS ends there, so Cloudflare could see it. We don't store it; Cloudflare may keep request data, such as IP addresses and page addresses, under its own policy.
2. Point the **iPhone camera** at the code on the Connect your iPhone screen → Open in Gubernos. The app remembers the Mac and connects: agents, chat and the calendar appear.

Only devices with the code get in: everyone else gets nothing, and an address that keeps trying wrong codes is turned away. Lost a phone? On the Mac, Settings → Connections → **New code**: every old device is unpaired. Want HTTPS to end on your Mac instead of at Cloudflare? `scripts/setup.sh phone --tailscale` uses Tailscale Funnel (a Tailscale account, its installer and your Mac password) and deletes the Cloudflare address. Rather not have the Mac on the internet at all? `scripts/setup.sh phone --private` keeps it inside your Tailscale network; then the iPhone needs Tailscale too (same account, VPN On Demand on).

The phone keeps a copy of your files from the Mac: when the Mac is asleep or away it still shows everything, and the changes you make go to the Mac once it's back. Agents, chat and the calendar need the Mac on.

**No Mac?** The iPhone app also works on its own over a folder in iCloud Drive (first screen → Or use the phone on its own): tasks, habits, reminders, widgets, the watch, without agents, chat or the calendar.

## Keep the Mac awake

If the Mac sits at home on power, tell your agent **"keep my Mac awake"**: that's `scripts/setup.sh awake on` (`caffeinate -s` as a login item: on power the Mac doesn't sleep, the screen still turns off as usual; on battery it sleeps as always). A laptop with the lid closed still sleeps: keep the lid open or use an external display.

- Check: `scripts/setup.sh awake status`
- Back to normal sleep: `scripts/setup.sh awake off`

## Report a bug or an idea

From any screen: menu ☰ → **Report bug / idea**, or by voice: "bug: …", "app idea: …". It goes to the app's developer, not public (no account needed): your text, the screen name, the device and errors. It's kept in the developer's private GitHub repository, and their AI coding agent (Claude) reads it to fix the problem. Screenshots (yours, and a snapshot of the screen) go along too, which helps the most; they show what's on the screen (tasks, notes, health numbers), so untick **Send screenshots** to send only the text. A voice report ("bug: …") opens the form first, so you see what goes out. The answer comes back to the report's task (Gubernos feedback): a question → **Reply**; done → **Works now** or **Still wrong**.

In TestFlight you can also take a screenshot → Share Beta Feedback.

---

The method is inspired by David Allen's Getting Things Done® and Gabriele Oettingen's WOOP; Gubernos is not affiliated with the David Allen Company.
