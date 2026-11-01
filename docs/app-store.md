# App Store Connect: what to fill in

Everything App Store Connect asks for the Gubernos app (bundle `app.gubernos`), ready to paste. The pages it links to live in
`site/` (published at https://gubernos.app, see "The site" at the end).

## App information

| Field | Value |
|---|---|
| Name | Gubernos |
| Subtitle (30) | Your personal OS, with agents |
| Category | Productivity (secondary: Health & Fitness) |
| Privacy Policy URL | https://gubernos.app/privacy.html |
| Support URL | https://gubernos.app/support.html |
| Marketing URL | https://gubernos.app |
| Copyright | 2026 Alexander Safonov |
| Age rating | 4+ (no objectionable content; answer "None" everywhere; no unrestricted web access: links open in Safari) |
| Encryption | `ITSAppUsesNonExemptEncryption = NO` is in Info.plist (HTTPS only): no question per build |
| Content rights | No third-party content |

**Promotional text (170)**
One working model of your life, run in daily, weekly and quarterly loops. Plain files in your own iCloud, AI agents on your own Mac. No account, no server of ours.

**Description**
Gubernos is a personal operating system: one working model of your life, steered day by day, with AI agents that take part of the work off your hands.

The model: the areas you are responsible for, your goals, promises, wishes and open decisions, the projects that move them, and today at the centre. Every task links out to why it matters.

Life loops: each morning you plan the day against your calendar and pick the one result that makes it a win; habits frame the morning and the evening; at night you look back and choose tomorrow's #1. Days roll into the week (three wins and a weekly review), weeks into the quarter (focus, goals, decisions).

Everything stays yours. Your system is a folder of plain Markdown files in your own iCloud: open it in Files, in Obsidian or in any editor. There is no account and no server of ours, and nothing about you is collected.

On the iPhone and Apple Watch:
• Capture in a second: type, dictate, share a page from any app, or speak to your watch
• Today, Upcoming, projects and an inbox that gets you to zero
• Reminders that ring from the phone, even offline
• Habits and morning/evening protocols, ticked off from Apple Health where they can be
• Widgets, Control Center buttons, Siri and Shortcuts ("Add to Gubernos")
• Works without a network, from your iCloud folder

With Gubernos for Mac (free, open source) you also get:
• AI agents on your own Claude, ChatGPT or Gemini plan: research, drafts and follow-ups that come back for your review
• An inbox agent that says what each capture is
• Plan the day around your calendar, with the one thing that matters most first
• A chat about your tasks, and a weekly review

Gubernos is inspired by David Allen's Getting Things Done® and Gabriele Oettingen's WOOP. It is not affiliated with the David Allen Company.

**Keywords (100)**
tasks,to-do,habits,planner,productivity,agents,AI,markdown,obsidian,icloud,weekly review,focus,inbox

## App Privacy ("nutrition label")

Answer **Data Not Collected**. Why it holds: the developer has no server; the app sends data only to the user's own Mac (an
address they enter, over their Tailscale) and Apple's iCloud and APNs; Apple Health values are written into the user's own files.
Bug reports become GitHub issues posted by the user from their own Mac with their own GitHub account (optional, user-initiated,
from the Mac app, not the iOS app). TestFlight crash logs are Apple's and don't count. Matches `PrivacyInfo.xcprivacy` (no collected data types, no tracking).

## TestFlight

**Beta App Description**
Gubernos is a personal operating system over plain Markdown files in your own iCloud: tasks, projects, habits and your day. The iPhone app works on its own; with Gubernos for Mac you also get AI agents, an inbox agent, a chat and calendar planning.

**Feedback email:** hello@gubernos.app

**What to Test** (per build)
Start a new system (or pick your existing folder), add a few tasks by typing and by voice, set a reminder, check off a habit, try the widgets and the watch. If you have a Mac with Gubernos: pair the phone (Settings → Connections → Pair a device) and hand a task to an agent.

## Beta App Review / App Review notes

Sign-in: **not required** (no account exists).

> Gubernos needs no account and no server of ours. To try it without a Mac:
> 1. Launch → "Start a new system" → in the file picker, iCloud Drive → New Folder → choose it. An empty starter system (folders, templates) is created there.
> 2. Today → + Add task (or the mic button) → e.g. "Call the dentist tomorrow 10:00" → a task with a reminder.
> 3. The Protocol screen → + New habit (e.g. "10,000 steps", from Apple Health: permission asked then) → tap it to check it off.
> 4. Widgets: "Add to Gubernos", "Habits", "Protocol". Siri: "Add to Gubernos".
>
> Agents, the chat and calendar planning need the companion Mac app (free, open source: github.com/old-bozman/gubernos), which runs on the user's own Mac; the iPhone connects to it over the user's private Tailscale network. Without it these screens say "needs your Mac" — that's expected, not an error.
>
> HealthKit: read steps, active energy, water, daylight, mindful minutes, workouts, sleep (to tick off the user's habits); write mindful minutes from the app's meditation timer. Nothing leaves the user's devices and iCloud folder.

Contact for review: Alexander Safonov, hello@gubernos.app (and a phone number in App Store Connect).

## Before Beta App Review: check on a real iPhone and the watch

Not yet verified on devices (only the simulator or not at all). Tick them on the TestFlight build:

- [ ] First launch on a phone that never had the app: Start a new system → the starter kit appears; then pick an existing folder instead
- [ ] Pairing by QR: Mac → Settings → Connections → Pair a device → camera → Open in Gubernos → the full app
- [ ] Offline: flight mode → add a task, check a habit → back online → both reach the Mac
- [ ] Reminders ring with the phone locked; notification buttons (Done, Snooze) work, also on the watch
- [ ] Habit check-ins (local notifications) and the alarm at the end of a watch timer
- [ ] Share → Gubernos from Safari, with a note
- [ ] Widgets after the rename: re-add Add / Habits / Protocol, tap through
- [ ] Watch: voice note → inbox; Protocol complication
- [ ] WOOP sheet: no zoom on focus
- [ ] Ask: ▶ Do it with no task starts a new agent task; voice "Mic is starting…"; the sprint ring in the header
- [ ] Plan the day: drag a task onto a free window; lunch Move / Skip today

## The site

`site/` holds `index.html`, `privacy.html`, `support.html` (plain HTML, no scripts) and `CNAME` = gubernos.app. `scripts/publish-site.sh` pushes it
to the `gh-pages` branch. GitHub Pages serves it once the repository is public (a free plan needs a public repo): Settings →
Pages → Deploy from a branch → `gh-pages`, `/ (root)`. DNS at the registrar (Namecheap → Domain →
Advanced DNS), replacing the parking records:

| Type | Host | Value |
|---|---|---|
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |
| CNAME | www | old-bozman.github.io. |

Then Settings → Pages → Custom domain `gubernos.app` → Enforce HTTPS. Email `hello@gubernos.app`: Namecheap → Domain → Redirect
Email → forward to your own address.
