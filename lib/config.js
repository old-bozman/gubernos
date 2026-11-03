// Where and who. Two sources, both written by scripts/setup.sh:
// - machine settings in ~/.config/gubernos/config.json: { vault, port, publicUrl, obsidian: { vault, path } }
// - the owner's profile in <vault>/profile.md frontmatter: name, language, categories, workday, assistant (re-read when it changes)
// Env vars override the machine settings (tests point GUBERNOS_VAULT at a copy).
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export const CONFIG_DIR = process.env.GUBERNOS_CONFIG_DIR || process.env.GUBERNOS_GOOGLE_DIR || path.join(process.env.HOME, '.config', 'gubernos');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const machine = (() => { try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; } })();

export const VAULT = process.env.GUBERNOS_VAULT || machine.vault || '';
if (!VAULT) {
  console.error(`No vault configured. Run scripts/setup.sh (it writes ${CONFIG_FILE}) or set GUBERNOS_VAULT.`);
  process.exit(1);
}
// the product name (Gubern OS: a system to steer your life) — also public/index.html, manifest.webmanifest, sw.js and gubernos-ios APP_NAME
export const APP_NAME = 'Gubernos';
export const PORT = Number(process.env.PORT || machine.port || 4747);
// Tailscale (serve / funnel, scripts/setup.sh phone) forwards to this second port: whatever arrives here comes from another
// device, never "the Mac itself" (lib/pair.js isLocal), whatever its Host or X-Forwarded-For says
export const PROXY_PORT = Number(process.env.GUBERNOS_PROXY_PORT || machine.proxyPort || PORT + 1);
// the phone's address (Tailscale), used in calendar-event links and as the push contact; null = local only
export const PUBLIC_URL = process.env.GUBERNOS_PUBLIC_URL ?? machine.publicUrl ?? null;
// Where bug reports from this install also go: the relay (relay/worker.js) that opens a private issue for the app's
// developer — no GitHub account needed. setup.sh sets it on every install but the developer's own ("devAgent": true);
// null = reports stay local. An older install's "feedbackRepo" (the gh days) means the relay too.
// Extra tools for agent runs, added to the default allowlist (e.g. ["Bash"] so a run can open an .xlsx with python);
// config.json "agentTools" or GUBERNOS_CLAUDE_TOOLS="Bash,…" — kept across reinstalls, unlike env in the launchd plist.
export const AGENT_TOOLS = (process.env.GUBERNOS_CLAUDE_TOOLS ? process.env.GUBERNOS_CLAUDE_TOOLS.split(',') : machine.agentTools || []).map((s) => String(s).trim()).filter(Boolean);
// Which Google access to ask for (config.json "googleScopes"): any of calendar, gmail, contacts, drive; default all.
// Leaving out gmail/drive (restricted scopes) makes publishing a personal OAuth client easier (docs/google.md).
export const GOOGLE_SCOPES = Array.isArray(machine.googleScopes) && machine.googleScopes.length ? machine.googleScopes : ['calendar', 'gmail', 'contacts', 'drive'];
export const FEEDBACK_RELAY = process.env.GUBERNOS_FEEDBACK_RELAY ?? machine.feedbackRelay ?? (machine.feedbackRepo ? 'https://relay.gubernos.app' : null);
// Apple Push without the app owner's key (only the developer's Mac has apns.p8): the same relay signs and sends it
// (lib/apns.js → relay/worker.js /push). config.json "pushRelay" (URL or null) overrides.
export const PUSH_RELAY = process.env.GUBERNOS_PUSH_RELAY ?? (machine.pushRelay !== undefined ? machine.pushRelay : FEEDBACK_RELAY);
// The app's developer's own install (no FEEDBACK_RELAY): tasks can go to the dev agent — the developer's Claude Code session in
// the app's repo, which takes its queue (AGENTS.md → Dev session); bug reports go there by themselves. config.json
// "devAgent": false turns it off.
export const DEV_AGENT = !FEEDBACK_RELAY && machine.devAgent !== false;
// The developer's side of the relay: the private repo whose issues (reports from other installs) become dev tasks
// (lib/feedback-inbox.js); config.json "feedbackInbox": "owner/repo", only with DEV_AGENT.
export const FEEDBACK_INBOX = process.env.GUBERNOS_FEEDBACK_INBOX ?? machine.feedbackInbox ?? null;
// Obsidian vault name + the folder of this system inside it ("" when the system folder is the vault itself); null = no Obsidian links
export const OBSIDIAN = machine.obsidian?.vault ? { vault: machine.obsidian.vault, path: machine.obsidian.path || '' } : null;

const DEFAULTS = {
  name: 'Me', language: 'English',
  categories: ['energy', 'work', 'love', 'home', 'finance'],
  workday: { start: '09:00', end: '19:00', lunch: 60 }, // lunch: minutes, the first free slot starting 12:00–13:00
  focus_time: 'focus time', // calendar events with this in the title are working time, not meetings
  assistant: null, // a chat assistant that picks up its own agent tasks (e.g. "Cosy"); null = none
};
export const PROFILE = path.join(VAULT, 'profile.md');
let cache = { mtime: -1, value: null };

// The owner's profile; `id` is the author token in logs ("- 2026-10-01 10:00 · alex · …").
export function profile() {
  let mtime = 0;
  try { mtime = fs.statSync(PROFILE).mtimeMs; } catch { /* no profile: defaults */ }
  if (cache.mtime === mtime && cache.value) return cache.value;
  let fm = {};
  if (mtime) {
    try {
      const m = fs.readFileSync(PROFILE, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
      fm = (m && YAML.parse(m[1])) || {};
    } catch (e) { console.warn('profile.md:', e.message); }
  }
  const name = String(fm.name || DEFAULTS.name).trim();
  const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  const cats = Array.isArray(fm.categories) && fm.categories.length ? fm.categories.map((c) => slug(c)).filter(Boolean) : DEFAULTS.categories;
  const value = {
    name, id: slug(fm.id || name.split(/\s+/)[0]) || 'me',
    language: String(fm.language || DEFAULTS.language),
    categories: cats,
    workday: { ...DEFAULTS.workday, ...(fm.workday || {}) },
    focusTime: String(fm.focus_time || DEFAULTS.focus_time),
    assistant: fm.assistant ? { id: slug(fm.assistant), name: String(fm.assistant) } : null,
    // days off work (a vacation): [{from, to, why}], dates inclusive; no `to` = until further notice
    offWork: (Array.isArray(fm.off_work) ? fm.off_work : []).map((x) => ({ from: day(x?.from), to: day(x?.to) || '9999-12-31', why: x?.why ? String(x.why) : null }))
      .filter((x) => x.from && x.from <= x.to).sort((a, b) => a.from.localeCompare(b.from)),
  };
  cache = { mtime, value };
  return value;
}

// a YAML date (a string, or a Date when the parser took it as one) → YYYY-MM-DD
const day = (v) => { const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').trim(); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; };
// the off-work period a day falls in, or null
export const offWorkOn = (d) => profile().offWork.find((x) => x.from <= d && d <= x.to) || null;

export const minutesOf = (hm) => { const [h, m] = String(hm).split(':').map(Number); return h * 60 + (m || 0); };
// What the app's client needs (sent in /api/state).
export const clientConfig = () => {
  const p = profile();
  return { name: p.name, id: p.id, categories: p.categories, assistant: p.assistant, obsidian: OBSIDIAN, workday: p.workday, feedbackRemote: !!FEEDBACK_RELAY, dev: DEV_AGENT };
};
