# Google verification: the calendar only

Gubernos' shared Google sign-in (the Desktop OAuth client in `deploy/google-client.json`) is unverified, so Google
shows "hasn't verified this app" and lets at most 100 new users in. Since 2026-11-10 that client asks for the
**calendar only** (lib/google.js): calendar scopes are *sensitive*, verified by Google for free, with no yearly
security audit. Gmail and Drive are *restricted* (a paid security assessment every year), and Contacts mostly served
mail, so they stay for people with their own Google client (docs/google.md) or `config.json` `"googleScopes"`.

Submitted from Google Cloud Console → Google Auth Platform, on the project that owns the shared client.

## 1. Before submitting (the owner)

State on 2026-11-11: **submitted, under review.** Branding verified and published; Data access lists the three calendar
scopes with the calendar.events justification; demo video https://youtu.be/4QplY03rQLU (unlisted, on the test account's
channel, recorded with the demo vault in a separate Chrome profile); the only OAuth client is the Desktop one in the
video. Google answers by email to the project's developer contact (the owner's Gmail) and in Verification centre →
View verification progress; reviewers often come back with a question first. Logo not provided (optional; adding one
later means re-verifying the branding).

- [ ] **Audience**: publishing status **In production** (in Testing, sign-ins expire after 7 days and only listed test users get in).
- [ ] **Domain**: gubernos.app verified in Google Search Console by the same Google account (Google Auth Platform → Branding links to it).
- [ ] **Branding**:
  - App name: `Gubernos`
  - User support email: `hello@gubernos.app`
  - App logo: `gubernos-site/icon-512.png` (120×120 shown; square, no Google marks)
  - Application home page: `https://gubernos.app`
  - Privacy policy: `https://gubernos.app/privacy.html`
  - Authorized domains: `gubernos.app`
  - Developer contact: `hello@gubernos.app`
- [ ] **Data access**: exactly these three scopes, nothing else (remove Gmail, Contacts and Drive if listed there):
  `https://www.googleapis.com/auth/calendar.events`, `https://www.googleapis.com/auth/calendar.freebusy`,
  `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
- [ ] **Privacy policy** updated (section 3 below) and live before submitting: the reviewer compares it with the scopes.
- [ ] **Limited Use**: the owner decides whether the policy states compliance (section 4).
- [ ] **Demo video** uploaded to YouTube as *unlisted* (section 5).

## 2. Scope justifications (paste into Data access)

**calendar.events** — Gubernos is a personal planner that runs on the user's own computer. Its "Plan the day"
screen reads the user's events for today to see their meetings, and when the user applies a plan it creates
time-block events for the tasks they chose (and deletes a block when the user removes it in the app). Event data
stays on the user's computer and their own phone; it is not sent to our servers.

**calendar.freebusy** — Plan the day computes how much free time the user has today across the calendars they
selected, to suggest how many tasks fit. Only busy/free intervals are read.

**calendar.calendarlist.readonly** — Settings → Calendar lists the user's calendars so they can tick which ones count
for meetings and free time, and which one receives the time blocks. Read-only.

Why not narrower: `calendar.events` is the narrowest scope that both reads events and creates the user's time blocks;
`calendar.readonly` cannot create them, and `calendar.events.owned`-style scopes don't cover reading shared calendars
the user subscribes to.

## 3. Privacy policy: what the Google section must say (gubernos-site/privacy.html#google)

- Signing in with Google gives Gubernos **calendar access only**: events (read, and create/delete the time blocks the
  user applies), free/busy, and the list of calendars. Gmail, Contacts and Drive are not requested with Gubernos'
  sign-in; someone who sets up their own Google client can add them, under their own client.
- Where the data goes: between the user's computer and Google directly; kept on that computer (the sign-in in
  `~/.config/gubernos`); shown on the user's iPhone over their phone connection (Cloudflare Tunnel or Tailscale, as the
  phone section says). **Event titles and times are not sent to the AI model**: Plan the day gives the model only the
  number of free hours today. (Keep this true: lib/planner.js. The morning brief, lib/brief.js, does give the model today's
  events; it is on only on the developer's own install, and turning it on for others changes this sentence first.)
- No selling, no advertising, no training of AI models on Google data; no human reads it, except in a bug report the
  user sends with screenshots ticked.
- How to remove access: Settings → Your Mac → Google → Disconnect, or myaccount.google.com/permissions.
- Remove the line "Google hasn't verified Gubernos yet… at most 100 people" once verified.

## 4. Limited Use statement (decided 2026-11-10: state it)

Google asks apps with sensitive scopes to follow the Google API Services User Data Policy, including the Limited Use
requirements, and most verified apps state it in the policy:

> Gubernos's use and transfer to any other app of information received from Google APIs will adhere to the
> [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including
> the Limited Use requirements.

With the calendar only and no event data going to the model, Gubernos meets it as built today. The open question was
Gmail and Drive text going to the user's AI provider (which, depending on the user's settings, may train on prompts);
those scopes are no longer part of the shared client.

## 5. Demo video (2–3 minutes, unlisted on YouTube, English, screen recording of the Mac)

1. The browser address bar on `http://127.0.0.1:4747` (Gubernos running on the user's own Mac). Settings → Your Mac →
   Google → **Sign in with Google**.
2. The Google consent screen: show the **app name Gubernos** and the OAuth client id in the URL bar (zoom in), and the
   three calendar permissions; Continue.
3. Back in Gubernos: "Connected: Calendar". Settings → Calendar: the calendar list (calendarlist.readonly), ticking
   one calendar for meetings and choosing the one for time blocks.
4. **Plan the day**: today's meetings from Google Calendar and the free hours (events + freebusy).
5. Apply a plan with two tasks → open Google Calendar in another tab: the two new time-block events (events write).
   Remove one block in Gubernos → it disappears from Google Calendar.
6. Settings → Google → **Disconnect**: access revoked.

Use a demo Google account with a few made-up meetings, never real data.

## 6. After it is verified

- privacy.html: drop the "hasn't verified / 100 people" line (section 3).
- The app: the "Google warns that it hasn't verified Gubernos" hint in Settings (public/app.js `googleNote`).
