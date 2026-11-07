// Getting an AI model with no Terminal: its CLI if it isn't on this Mac, then its sign-in in the browser. The first-run page
// (scripts/first-run.mjs) and the interview screen (lib/onboarding.js) both do this; no dependencies, the first of them runs early.
import os from 'node:os';
import path from 'node:path';

export const MODEL_SETUP = {
  claude: { name: 'Claude', plan: 'a Claude plan with Claude Code (Pro or higher)', install: ['/bin/sh', ['-c', 'curl -fsSL https://claude.ai/install.sh | bash']], login: ['claude', ['auth', 'login']] },
  codex: { name: 'ChatGPT', plan: 'any ChatGPT subscription', install: ['npm', ['install', '-g', '@openai/codex']], login: ['codex', ['login']] },
};
// a Mac that has never had these on PATH, and the launchd service's short one: the installers put them here
export const setupPath = (p) => [path.dirname(process.execPath), path.join(os.homedir(), '.local/bin'), path.join(os.homedir(), '.gubernos/node/bin'), p].join(':');
export const signInFailed = (m) => `Didn’t finish signing in to ${m.name}. Try again when you’re ready.`;
export const getFailed = (m) => `Couldn’t get ${m.name}. Check the internet connection and try again.`;

// Where the sign-in happens. On a Mac the CLI opens the browser on this Mac. Elsewhere (Linux, Windows in WSL, a machine
// with no screen) there may be no browser here: ChatGPT then signs in with a one-time code (--device-auth), and the page
// shows what the CLI prints, so any browser on any device will do. Claude prints a link, and after the sign-in its page
// shows a code, which the person pastes back on our page; it reaches the CLI's input (it asks "Paste code here").
export const loginCommand = (id, platform = process.platform) => (id === 'codex' && platform !== 'darwin' ? ['codex', ['login', '--device-auth']] : MODEL_SETUP[id].login);
// → {url, code?, paste} from what the CLI printed so far, or null before it printed its link
export function loginPrompt(text) {
  const t = String(text || '').replace(/\x1b\[[0-9;]*m/g, '');
  const url = t.match(/https:\/\/[^\s"'<>]+/)?.[0];
  if (!url) return null;
  return { url, code: t.replace(/https:\/\/\S+/g, '').match(/\b([A-Z0-9]{4}-[A-Z0-9]{4,6})\b/)?.[1] || null, paste: /paste code/i.test(t) };
}
