// The first interview, in the app itself (#/onboard), mostly by voice, so a new person needs no Terminal: the vault's onboarding skill
// (.claude/skills/onboarding/SKILL.md) as the model's instructions, turn by turn, one resumed session.
// Unlike the app's chat this agent may write, inside the vault only (lib/llm.js chatTurn write): it creates the owner's
// areas, people and goals as they confirm them. No shell, no web. Its progress is also in the vault
// (40_reference/system/onboarding.md, the skill keeps it), so a lost session just continues from there.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { VAULT } from './config.js';
import { bin, chatTurn, current, forgetModels, installed, ready } from './llm.js';
import { MODEL_SETUP, setupPath, signInFailed, getFailed } from './model-setup.js';
import { httpError, localDate } from './vault.js';

const DATA = process.env.GUBERNOS_DATA_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data');
const FILE = path.join(DATA, 'onboarding.json');
const SKILL = path.join(VAULT, '.claude/skills/onboarding/SKILL.md');
const SCHEMA = { type: 'object', properties: { reply: { type: 'string' }, finished: { type: 'boolean' } }, required: ['reply', 'finished'], additionalProperties: false };
const HERE = 'You run inside the Gubernos app\'s interview screen, and the owner is mostly talking into a mic, so expect loose, rambling, mistranscribed speech and pick out what matters. The screen already told them to set aside about 10 minutes and asked its opening question. Your reply is shown as a chat message in Markdown. You can read and write files in the vault (the current folder), nothing else. Set finished to true only after the last question (one habit) is answered and its files are written, or if the owner says to stop altogether. A line [Now: …] at the start of a message is the current date and time, from the app; it is not part of what the owner said.';

const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { session: null, turns: [], finished: false }; } };
const save = (s) => { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(s, null, 1)); return s; };
let connecting = null; // {id, name, running, signingIn, error}: getting a model, from the screen
let signIn = null; // its sign-in process: the browser page can get lost, and it would wait for ever
const view = (s) => {
  const model = ready(current()) ? current() : null; // null: none connected yet
  return { turns: s.turns, finished: !!s.finished, model, connecting, models: model ? [] : Object.entries(MODEL_SETUP).map(([id, m]) => ({ id, name: m.name, plan: m.plan, installed: installed(id) })) };
};

export const state = () => view(load());

// nobody should need a Terminal to get a model: its CLI if it's missing, then its sign-in in the browser
export function connect(id) {
  const m = MODEL_SETUP[id];
  if (!m) throw httpError(400, 'unknown model');
  if (connecting?.running) throw httpError(409, 'one thing at a time');
  connecting = { id, name: m.name, running: true, signingIn: false, error: null };
  const env = { ...process.env, PATH: setupPath(process.env.PATH) };
  const finish = (error) => { signIn = null; connecting = { ...connecting, running: false, signingIn: false, error }; };
  const run = (cmd, args, fail, then) => {
    const c = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    c.stdout.resume(); c.stderr.resume();
    c.on('error', () => finish(fail));
    c.on('close', (code) => { forgetModels(); if (code !== 0) return finish(fail); return then ? then() : finish(null); });
    return c;
  };
  const login = () => { connecting = { ...connecting, signingIn: true }; signIn = run(bin(id) || m.login[0], m.login[1], signInFailed(m)); };
  if (bin(id)) login(); else run(...m.install, getFailed(m), login);
  return view(load());
}

// the sign-in page was closed or lost: stop waiting for it, so the button works again
export function cancelConnect() { signIn?.kill(); return view(load()); }

let busy = false;
export async function turn(message) {
  if (busy) throw httpError(409, 'still answering');
  const s = load();
  const text = String(message || '').trim();
  if (!text) throw httpError(400, 'message required');
  if (!ready(current())) throw httpError(409, 'No model connected yet: Settings → Your Mac → Model');
  if (!fs.existsSync(SKILL)) throw httpError(409, 'this vault has no onboarding skill');
  busy = true;
  try {
    const d = await chatTurn({ system: `${fs.readFileSync(SKILL, 'utf8')}\n\n${HERE}`, prompt: `[Now: ${new Date().toLocaleString('en-GB', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}, ${localDate()}]\n\n${text}`, schema: SCHEMA, session: s.session, deep: true, cwd: VAULT, write: true });
    s.session = d.session;
    s.turns.push({ from: 'you', text }, { from: 'agent', text: d.output.reply });
    s.finished = !!d.output.finished;
    return view(save(s));
  } catch (e) {
    console.error('[onboarding]', String(e.message).slice(0, 300));
    throw httpError(502, 'The model couldn’t answer. Your words are still in the box: try again. If it keeps happening, check it’s signed in: Settings → Your Mac → Model.'); // a failed turn isn't kept: the page gives the text back
  } finally { busy = false; }
}
