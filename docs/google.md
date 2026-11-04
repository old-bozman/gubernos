# Connecting Google (optional)

**You don't need this for the calendar.** Plan the day uses the calendars in your Mac's Calendar app (iCloud, Google,
Exchange… any account added there): Settings → Calendar → This Mac → Allow access. Connect Google only for what the Mac
can't give: agents reading **Gmail**, **Contacts** and **Drive**, or Google Calendar read directly (Settings → Calendar →
Google) — e.g. calendars shared into your Google account that you haven't added to the Calendar app.

What it gives: **Calendar** — Plan the day sees your meetings and free time, tasks get time blocks as calendar events; **Gmail** — agents can read mail a task depends on, the app drafts replies you send from a confirmation card; **Contacts** and **Drive** — agents can look up an address or read a document a task refers to. Agents only read; nothing is sent or created without your tap.

Several calendars: Plan the day reads the main calendar, plus the ones ticked in **Settings → Google → Calendars** (a work calendar shared into this account, a family one…). Their events marked "free" and declined invitations don't take time; time blocks are always written to the main calendar.

## Sign in with Google

On the Mac, open Gubernos → Settings → Google → **Sign in with Google**, pick your account and allow what you want. That's all.

Gubernos is in beta and Google hasn't verified it yet, so Google first shows "Google hasn't verified this app": click **Advanced → Go to Gubernos**. Until it's verified, Google lets at most 100 people sign in to it in total. The connection stays: it doesn't expire after a week.

## Your own client (optional)

Rather use your own "OAuth client" (for example an internal app in your Google Workspace: no warning, no limits)? A one-time setup in Google Cloud (15–20 minutes, free); put its JSON at `~/.config/gubernos/google_oauth_client.json` and it's used instead of Gubernos' one. The one decision is **where the Cloud project lives**, because that decides whether the connection lasts:

| | Lasts | Effort | Cost |
|---|---|---|---|
| **A. Internal app in your Google Workspace** (recommended if you have Workspace) | forever | least: no verification, no privacy policy, no domain proof, all scopes allowed | it connects **one account — your Workspace one**: agents read that account's Gmail, Drive and Contacts. Your personal Gmail/Drive/Contacts stay out of reach (personal calendars still work if you share them with the Workspace account; Drive folders too) |
| **B. External app, Testing** | **7 days** — then Google expires the connection and you reconnect | small | a weekly reconnect, forever (the app pushes "Google connection expired" when it happens) |
| **C. External app, In production** | forever | high: Google wants an app home page, a privacy-policy URL and a verified domain for these scopes | a website and a DNS record for a one-person app. Leaving out Gmail and Drive (restricted scopes) makes it easier but may still not be enough |

## 1. A Google Cloud project

1. Open https://console.cloud.google.com/ with the Google account the app should use.
2. Top bar → project picker → **New project**, name it e.g. `gubernos`.
   - **A (Internal):** set **Location** to your Workspace **organisation** — with "No organization" the Internal option never appears.
3. Create, and select the project.

## 2. Turn on the APIs

**APIs & Services → Library**, search and **Enable** each one you want: Google Calendar API · Gmail API · People API (contacts) · Google Drive API.

## 3. Branding and audience

**Google Auth Platform** (older console: **APIs & Services → OAuth consent screen**):
1. **Branding**: app name `Gubernos`, support and developer email = your own address.
2. **Audience**:
   - **A:** User type **Internal**. Done — nothing to publish, nothing expires.
   - **B / C:** User type **External**, add your own address under **Test users**.
3. **Data access → Add or remove scopes**, add the ones for the APIs you enabled:
   - `.../auth/calendar.events`, `.../auth/calendar.freebusy`, `.../auth/calendar.calendarlist.readonly`
   - `.../auth/gmail.readonly`, `.../auth/gmail.compose`
   - `.../auth/contacts.readonly`, `.../auth/contacts.other.readonly`
   - `.../auth/drive.readonly`

   If you leave some out (say Gmail and Drive, to make publishing easier), tell the app, or connecting fails with `invalid_scope` — `~/.config/gubernos/config.json`: `"googleScopes": ["calendar", "contacts"]`.

## 4. The client file — create it before publishing

1. **Clients** (older console: **Credentials → Create credentials → OAuth client ID**), type **Desktop app**, name `gubernos` → Create.
2. **Download JSON** and save it as `~/.config/gubernos/google_oauth_client.json`:
   ```
   mv ~/Downloads/client_secret_*.json ~/.config/gubernos/google_oauth_client.json
   ```
   Keep this file private; it never goes into the vault or git.

The console won't publish an app until Branding, Audience, Data access **and a client** exist — that's why the client comes first.

## 5. Publish (C only)

**Audience → Publish app → In production.** For these scopes Google then asks for an app home page, a privacy-policy URL and a verified domain (Search Console). Without them, stay on B: it works, it just needs a reconnect every 7 days.

## 6. Connect

On the Mac, open http://127.0.0.1:4747/api/gcal/connect (the port from your setup), pick the account and allow access. Untick anything you don't want: the app works with what you grant and shows "not granted — re-connect" where something is missing. To add a permission later, or after the connection expired, open the same link again.

Check: the app's Settings → Google, or `curl -s http://127.0.0.1:4747/api/gcal/status`. When Google expires or revokes the connection the app notices within a day, shows **Expired** in Settings and sends a push.

## Removing access

Settings → Google → **Disconnect**: it revokes the access at Google and deletes the token on this Mac.

By hand: https://myaccount.google.com/permissions → Gubernos (or the name you gave it) → Remove access, and delete `~/.config/gubernos/google_calendar_token.json`.
