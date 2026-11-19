# App Store Connect: what to fill in

The Mac can fill most of it through the App Store Connect API: the team key (App Manager) is in `~/.config/gubernos/asc.json`
and `~/.appstoreconnect/private_keys/`, outside the repos; `gubernos-ios/scripts/asc.mjs` reads and writes with it, and
`build.sh testflight` uploads with it.

Everything App Store Connect asks for the Gubernos app (bundle `app.gubernos`), ready to paste. The pages it links to live in
the site repository `old-bozman/gubernos-site` (published at https://gubernos.app, see "The site" at the end).

## App information

| Field | Value |
|---|---|
| Name | Gubernos |
| Subtitle (30) | Your personal OS, with agents |
| Category | Productivity (secondary: Health & Fitness) |
| Privacy Policy URL | https://gubernos.app/privacy |
| Support URL | https://gubernos.app/support |
| Marketing URL | https://gubernos.app |
| Copyright | 2026 Alexander Safonov |
| Age rating | 4+ (no objectionable content; answer "None" everywhere; no unrestricted web access: links open in Safari) |
| Encryption | `ITSAppUsesNonExemptEncryption = NO` is in Info.plist (HTTPS only): no question per build |
| Content rights | No third-party content |

**Promotional text (170)**
One working model of your life, run in daily, weekly and quarterly loops. Plain files in your own iCloud, AI on a free Gemini key or your own Mac. No account of ours.

**Description**
Gubernos is a personal operating system: one working model of your life, steered day by day, with AI that takes part of the work off your hands.

The model: the areas you are responsible for, your goals, promises, wishes and open decisions, the projects that move them, and today at the centre. Every task links out to why it matters.

Life loops: each morning you plan the day and pick the one result that makes it a win; habits frame the morning and the evening; at night you look back and choose tomorrow's #1. Days roll into the week (three wins and a weekly review), weeks into the quarter (focus, goals, decisions).

Everything stays yours. Your system is a folder of plain Markdown files in your own iCloud: open it in Files, in Obsidian or in any editor. There is no account and no server of ours, and we collect nothing about you.

On the iPhone and Apple Watch:
• Capture in a second: type, dictate, share a page from any app, or speak to your watch
• Today, Upcoming, projects and an inbox that gets you to zero
• Plan the day: your free time filled with what matters most, #1 first
• Reminders that ring from the phone, even offline
• Habits and morning/evening protocols, ticked off from Apple Health where they can be
• Widgets, Control Center buttons, Siri and Shortcuts ("Add to Gubernos")
• Works without a network, from your iCloud folder

AI, your way:
• On the iPhone, with your own API key: free from Google Gemini (no card), or Anthropic or OpenAI, paid per use. A setup talk that builds your system with you, a chat about each task, next steps, inbox suggestions, voice into tasks and time estimates. The key stays in your iPhone's Keychain and goes only to that company.
• With Gubernos for Mac (free, open source), on your Claude, ChatGPT or Gemini plan: agents that do research, drafts and follow-ups and come back for your review, your calendar in Plan the day, and a morning brief.
• Or no AI for now: tasks, projects, inbox, habits, wins, Plan the day and the daily reflection all work. Add a key any time.

Gubernos is inspired by David Allen's Getting Things Done®, Gabriele Oettingen's WOOP and Brian Johnson's Heroic. It is not affiliated with any of them.

**Keywords (100)**
tasks,to-do,habits,planner,productivity,agents,AI,markdown,obsidian,icloud,weekly review,focus,inbox

## App Privacy ("nutrition label")

Answer **Data Not Collected**. Why it holds: the developer has no server; the app sends data only to the user's own Mac (an
address they enter, served over HTTPS by Tailscale on that Mac; only devices paired with it get in) and Apple's iCloud and APNs; Apple Health values are written into the user's own files.
Bug reports become GitHub issues posted by the user from their own Mac with their own GitHub account (optional, user-initiated,
from the Mac app, not the iOS app). TestFlight crash logs are Apple's and don't count. Matches `PrivacyInfo.xcprivacy` (no collected data types, no tracking).

## TestFlight

**Beta App Description** (set through the API, last on 2026-11-19)
Gubernos is a personal operating system: one working model of your life, steered day by day. The areas you are responsible for, your goals, promises and open decisions, the projects that move them, and today at the centre, run in daily, weekly and quarterly loops.

Everything is plain Markdown files in your own iCloud: there is no account and no server of ours. The iPhone app works on its own: add your own API key (free from Google Gemini, or Anthropic or OpenAI) for the setup talk, the chat, next steps and voice, or start without AI. With Gubernos for Mac (free, open source: github.com/old-bozman/gubernos) you also get AI agents on your own Claude, ChatGPT or Gemini plan and calendar planning. More → How it works in the app shows the whole idea.

**Feedback email:** hello@gubernos.app

**What to Test** (per build)
Start on this iPhone (or pick your existing folder) and pick how it gets its AI (a free Gemini key, or none), add a few tasks by typing and by voice, set a reminder, check off a habit, try the widgets and the watch. If you have a Mac with Gubernos: pair the phone (Settings → Your Mac → iPhone and other devices → Show code) and hand a task to an agent.

## Beta App Review / App Review notes

Sign-in: **not required** (no account exists). Set through the API on 2026-11-19; Alex adds the test key (a free Gemini key on a separate Google account) at the end himself.

> Gubernos needs no account and no server of ours. To try it without a Mac:
> 1. Launch → "Start on this iPhone" → in the file picker, iCloud Drive → New Folder → choose it. A starter system (folders, templates) is created there, and the setup screen asks how Gubernos gets its AI.
> 2. AI on the phone: tap "Add your API key" (or later: Settings → This iPhone → AI API key) → paste the test key below → the app shows what goes to Google and asks permission → "Allow and save". Then the setup talk, the chat on a task (✦), next steps, inbox suggestions and voice into tasks work.
>    Or tap "Start without AI": everything else works, and the AI features say "This needs AI: add an API key in Settings → This iPhone" — that's expected, not an error.
> 3. Today → + Add task (or the mic button) → e.g. "Call the dentist tomorrow 10:00" → a task with a reminder.
> 4. The Protocol screen → + New habit (e.g. "10,000 steps", from Apple Health: permission asked then) → tap it to check it off.
> 5. Widgets: "Add to Gubernos", "Habits", "Protocol". Siri: "Add to Gubernos".
> 
> Agents, calendar planning and the morning brief need the companion Mac app (free, open source: github.com/old-bozman/gubernos), which runs on the user's own Mac; the iPhone connects to it over HTTPS (Tailscale on the user's Mac gives it the address) after pairing with a code the Mac shows; only paired devices get in.
> 
> Third-party AI (5.1.2(i)): before a key is saved, the app says which data goes to which provider, under the user's own key and that provider's terms, and asks for explicit permission. Nothing goes to us. The key stays in the iPhone's Keychain.
> 
> HealthKit: read steps, active energy, water, daylight, mindful minutes, workouts, sleep (to tick off the user's habits); write mindful minutes from the app's meditation timer. Nothing leaves the user's devices and iCloud folder.
> 
> Test key (Google Gemini, free tier): <the key>

Contact for review: Alexander Safonov, hello@gubernos.app (and a phone number in App Store Connect).

## Before Beta App Review: check on a real iPhone and the watch

Not yet verified on devices (only the simulator or not at all). Tick them on the TestFlight build:

- [ ] First launch on a phone that never had the app: Start on this iPhone → the starter kit appears; then pick an existing folder instead
- [ ] Pairing by QR: Mac → Settings → Your Mac → iPhone and other devices → Show code → camera → Open in Gubernos → the full app
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

The site is its own public repository, `old-bozman/gubernos-site` (checked out at `~/dev/gubernos-site`): `index.html`,
`privacy.html`, `support.html`, `concept.css` and `copy.js` (the Copy buttons; the only script, it sends nothing:
no tracking, no data collected). Cloudflare Pages builds its `main` branch, so a
push publishes, and serves it at gubernos.app (Cloudflare Pages → the project → Custom domains; the DNS records it asks for
go to the registrar, Namecheap, or the domain's DNS moves to Cloudflare). Its "What is a personal OS" section comes from
this repository's `public/concept.js`: `node scripts/build-concept.mjs` rewrites it there, then commit and push in the site
repo. Email `hello@gubernos.app` (later): Namecheap → Domain → Redirect Email → forward to your own address.
