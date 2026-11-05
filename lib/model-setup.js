// Getting an AI model with no Terminal: its CLI if it isn't on this Mac, then its sign-in in the browser. The first-run page
// (scripts/first-run.mjs) and the interview screen (lib/onboarding.js) both do this; no dependencies, the first of them runs early.
import os from 'node:os';
import path from 'node:path';

export const MODEL_SETUP = {
  claude: { name: 'Claude', plan: 'a Claude plan, Pro or higher', install: ['/bin/sh', ['-c', 'curl -fsSL https://claude.ai/install.sh | bash']], login: ['claude', ['auth', 'login']] },
  codex: { name: 'ChatGPT', plan: 'a ChatGPT plan, Plus or higher', install: ['npm', ['install', '-g', '@openai/codex']], login: ['codex', ['login']] },
};
// a Mac that has never had these on PATH, and the launchd service's short one: the installers put them here
export const setupPath = (p) => [path.dirname(process.execPath), path.join(os.homedir(), '.local/bin'), path.join(os.homedir(), '.gubernos/node/bin'), p].join(':');
export const signInFailed = (m) => `Didn’t finish signing in to ${m.name}. Try again when you’re ready.`;
export const getFailed = (m) => `Couldn’t get ${m.name}. Check the internet connection and try again.`;
