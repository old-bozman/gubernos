# Getting started with Gubernos

**Gubernos** (Gubern OS, from Latin *gubernare*, to steer) is a personal operating system: tasks, projects, goals, habits and your day, with agents that take part of the work off your hands. Everything stays yours: plain Markdown files on your Mac (or in your iCloud, if you like), your Mac as the "server", agents on your own Claude subscription. No third-party server, no one else's database.

**Before you install: you need an AI subscription.** Claude with Claude Code (Pro or higher), or any ChatGPT subscription. Gubernos runs on it: the first interview, the chat and the agents all need it. Don't have one? Get it first: [Claude plans](https://claude.com/pricing) · [ChatGPT plans](https://chatgpt.com/pricing).

Two steps: the Mac, then the iPhone.

**The easiest way (no Terminal):** download **[Gubernos.dmg](https://github.com/old-bozman/gubernos/releases/latest/download/Gubernos.dmg)** (macOS 13 or later), open it and double-click
**Gubernos**; macOS asks whether to open an app downloaded from the Internet: **Open**. A page in your browser asks your
name, where your files live and your AI model (it gets it for you, you sign in), sets everything up and hands over to a
10-minute interview that fills your system. Then go to [2. iPhone](#2-iphone-5-minutes). The rest of this part is the
same setup done by your AI agent or by hand, for those who prefer it.

**Or skip the reading:** on the Mac, open your AI agent (Claude Code or Codex) and paste
`Install Gubernos for me: read https://raw.githubusercontent.com/old-bozman/gubernos/main/SETUP.md and do the part "For the agent".` — it does the Mac part for you and tells you when to tap on the phone.

## 1. Mac (about 30 minutes, mostly your agent working)

**You need:** a Mac (ideally one that is usually on) and an **AI subscription** — whichever you already have:

| You have | Its agent for the Terminal | Install | Sign in |
|---|---|---|---|
| **Claude** with Claude Code (Pro or higher) | Claude Code | `curl -fsSL https://claude.ai/install.sh \| bash` | `~/.local/bin/claude` |
| **ChatGPT**, any subscription | Codex | `npm install -g @openai/codex` | `codex login` |

That model reads your inbox and voice notes, answers in the app's chat and runs agents on tasks. You can switch later (Settings → Your Mac → Model), or install a second one as another agent.

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
   - ends with a short interview, about 10 minutes: you talk, and what matters goes straight into your system. After it, bring your tasks from Todoist, Things, Reminders or any app's export: Settings → General → Import tasks.

On the Mac the app is at http://127.0.0.1:4747 (Safari → File → Add to Dock opens it in its own window).

**Agents** are ready right away, on your own plan. A task assigned to "agent" starts with ▶ Run on the task card; the result arrives as a push on the phone (your Mac sends it through relay.gubernos.app, which signs it for Apple; it carries the notification text only).

## 2. iPhone (5 minutes)

Install **TestFlight** from the App Store, open [testflight.apple.com/join/rBUGmgJG](https://testflight.apple.com/join/rBUGmgJG) on the iPhone and tap **Accept** → **Install**. Then connect it to the Mac. Your agent does this with you if you said you have an iPhone; you can also do it later: Gubernos on the Mac → ☰ → **Settings** → **Your Mac** → **iPhone and other devices** → **Connect your iPhone**. That screen shows two codes and a ✓ when the phone is in.

1. In the app on the Mac: Settings → Your Mac → iPhone and other devices → **Connect your iPhone** → **Set up the address** (or tell your agent **"connect my phone"**: it opens that screen). One quick check by Cloudflare appears over the app, and for most people it passes by itself. Your Mac gets an address like `https://m-3f2a….gubernos.dev` the phone reaches from anywhere: Cloudflare's small `cloudflared` program runs in the background on the Mac. Nothing to sign in to, nothing on the phone. The traffic passes through Cloudflare, on the developer's account, and HTTPS ends there, so Cloudflare could see it. We don't store it; Cloudflare may keep request data, such as IP addresses and page addresses, under its own policy.
2. Point the **iPhone camera** at the code on the Connect your iPhone screen → Open in Gubernos. The app remembers the Mac and connects: agents, chat and the calendar appear.

Only devices with the code get in: everyone else gets nothing, and an address that keeps trying wrong codes is turned away. Lost a phone? On the Mac, Settings → Your Mac → iPhone and other devices → **New code**: every old device is unpaired. Want HTTPS to end on your Mac instead of at Cloudflare? `scripts/setup.sh phone --tailscale` uses Tailscale Funnel (a Tailscale account, its installer and your Mac password) and deletes the Cloudflare address. Rather not have the Mac on the internet at all? `scripts/setup.sh phone --private` keeps it inside your Tailscale network; then the iPhone needs Tailscale too (same account, VPN On Demand on).

The phone keeps a copy of your files from the Mac: when the Mac is asleep or away it still shows everything, and the changes you make go to the Mac once it's back. Agents, chat and the calendar need the Mac on.

## Android

There's no Android app yet, but Gubernos works in Chrome as an installed web app, with notifications. You need the Mac's phone address (step 1 above: "connect my phone", or Connect your iPhone on the Mac, which sets it up).

1. On the computer running Gubernos: Settings → Your Mac → iPhone and other devices → **Android or a browser** (or **Show code** once it has an address).
2. Point the phone's camera at the code marked **Android** and open it in **Chrome**: it pairs the phone and opens Gubernos. (No camera handy: **Copy link** and send it to the phone.)
3. Chrome menu **⋮** → **Install app** (or Add to Home screen): it gets its own icon and window.
4. In Gubernos: Settings → This device → Notifications **On**.

Compared with the iPhone app it has no offline copy, widgets, Health or phone-side reminders: reminders come as pushes from the Mac, so the Mac needs to be on and awake: **Keep this computer awake on power** is right under the codes (on by default from the setup page).

**No Mac?** The iPhone app also works on its own over a folder in iCloud Drive (first screen → Or use the phone on its own): tasks, habits, reminders, widgets, the watch, without agents, chat or the calendar.

## Linux, or Windows (in WSL)

Gubernos also runs on Linux, and on Windows inside WSL (Windows' own Linux).

**Windows:** open PowerShell (Start → type PowerShell) and paste:

```
irm https://gubernos.app/install.ps1 | iex
```

It installs WSL with Ubuntu if they aren't there (Windows asks for an administrator's OK; then restart, choose a Linux user name and password in the Ubuntu window, and run the same line again), then does the Linux install below inside Ubuntu.

**Linux** (or by hand inside WSL), in a terminal:

```
curl -fsSL https://raw.githubusercontent.com/old-bozman/gubernos/main/install.sh | bash -s -- --wizard
```

It gets Node and the app into `~/.gubernos` (no sudo), then opens the same setup page in your browser (on WSL, the Windows one; on a machine without a screen it prints the link). Without `--wizard` it hands over to your AI agent instead, as on the Mac. Gubernos then runs as a background service of your user (systemd), also after a restart. You need `curl`, `tar` and `rsync` (Debian / Ubuntu: `sudo apt install rsync` if it's missing); on WSL, systemd on, which new Ubuntu installs have (else `systemd=true` under `[boot]` in `/etc/wsl.conf`).

On Windows, Linux stops when its last window closes and doesn't start with Windows; so the setup also puts a small hidden starter (`Gubernos.vbs`) in your Windows Startup folder: Gubernos starts when you log in to Windows and keeps running with no window open. Delete that file to stop it.

Voice: ask your agent "set up voice", or run `~/.gubernos/app/scripts/setup.sh voice`: Whisper, on the computer itself (faster-whisper; on an NVIDIA graphics card, also in WSL, it's quicker). On the processor a talk takes about as long to read as it took to say.

Signing in to Claude or ChatGPT happens on the setup page, as on the Mac. When no browser opens by itself (WSL, or a machine without a screen), the page shows the sign-in link: ChatGPT gives a one-time code to enter there; Claude's page shows a code at the end, which you paste back on the setup page. Any browser on any device will do.

What's different from the Mac: the calendar comes from Google (Settings → Your Mac → Calendar). Keeping it awake while plugged in works too (the box on the setup page, or `scripts/setup.sh awake on`); on Ubuntu it needs one admin step, which the setup prints. Other devices connect the same way (Settings → Your Mac → iPhone and other devices: the iPhone app, or Android and any browser).

## Keep the Mac awake

The setup page offers it, ticked by default, and it can be switched any time in Settings → Your Mac → iPhone and other devices → **Keep this computer awake on power**. Or tell your agent **"keep my Mac awake"**: that's `scripts/setup.sh awake on` (`caffeinate -s` as a login item: on power the Mac doesn't sleep, the screen still turns off as usual; on battery it sleeps as always). A laptop with the lid closed still sleeps: keep the lid open or use an external display.

- Check: `scripts/setup.sh awake status`
- Back to normal sleep: `scripts/setup.sh awake off`

## Report a bug or an idea

From any screen: menu ☰ → **Report bug / idea**, or by voice: "bug: …", "app idea: …". It goes to the app's developer, not public (no account needed): your text, the screen name, the device and errors. It's kept in the developer's private GitHub repository, and their AI coding agent (Claude) reads it to fix the problem. Screenshots (yours, and a snapshot of the screen) go along too, which helps the most; they show what's on the screen (tasks, notes, health numbers), so untick **Send screenshots** to send only the text. A voice report ("bug: …") opens the form first, so you see what goes out. The answer comes back to the report's task (Gubernos feedback): a question → **Reply**; done → **Works now** or **Still wrong**.

In TestFlight you can also take a screenshot → Share Beta Feedback.

---

The method is inspired by David Allen's Getting Things Done® and Gabriele Oettingen's WOOP; Gubernos is not affiliated with the David Allen Company.
