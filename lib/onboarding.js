// The first interview, in the app itself (#/onboard), mostly by voice, so a new person needs no Terminal: the vault's onboarding skill
// (.claude/skills/onboarding/SKILL.md) as the model's instructions, turn by turn, one resumed session.
// Unlike the app's chat this agent may write, inside the vault only (lib/llm.js chatTurn write): it creates the owner's
// areas, people and goals as they confirm them. No shell, no web. Its progress is also in the vault
// (40_reference/system/onboarding.md, the skill keeps it), so a lost session just continues from there.
import fs from 'node:fs';
import path from 'node:path';
import { VAULT } from './config.js';
import { chatTurn, current, ready } from './llm.js';
import { httpError } from './vault.js';

const DATA = process.env.GUBERNOS_DATA_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data');
const FILE = path.join(DATA, 'onboarding.json');
const SKILL = path.join(VAULT, '.claude/skills/onboarding/SKILL.md');
const SCHEMA = { type: 'object', properties: { reply: { type: 'string' }, finished: { type: 'boolean' } }, required: ['reply', 'finished'], additionalProperties: false };
const HERE = 'You run inside the Gubernos app\'s interview screen, and the owner is mostly talking into a mic, so expect loose, rambling, mistranscribed speech and pick out what matters. The screen already told them to set aside 15–20 minutes and asked its opening question. Your reply is shown as a chat message in Markdown. You can read and write files in the vault (the current folder), nothing else. Set finished to true when the four topics are covered or the owner says to stop.';

const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { session: null, turns: [], finished: false }; } };
const save = (s) => { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(s, null, 1)); return s; };
const view = (s) => ({ turns: s.turns, finished: !!s.finished, model: ready(current()) ? current() : null }); // null: none connected yet

export const state = () => view(load());

let busy = false;
export async function turn(message) {
  if (busy) throw httpError(409, 'still answering');
  const s = load();
  const text = String(message || '').trim();
  if (!text) throw httpError(400, 'message required');
  if (!ready(current())) throw httpError(409, 'No model connected yet: Settings → Agents → Model');
  if (!fs.existsSync(SKILL)) throw httpError(409, 'this vault has no onboarding skill');
  busy = true;
  try {
    const d = await chatTurn({ system: `${fs.readFileSync(SKILL, 'utf8')}\n\n${HERE}`, prompt: text, schema: SCHEMA, session: s.session, deep: true, cwd: VAULT, write: true });
    s.session = d.session;
    s.turns.push({ from: 'you', text }, { from: 'agent', text: d.output.reply });
    s.finished = !!d.output.finished;
    return view(save(s));
  } catch (e) {
    console.error('[onboarding]', String(e.message).slice(0, 300));
    throw httpError(502, 'The model couldn’t answer. Your words are still in the box: try sending them again.'); // a failed turn isn't kept: the page gives the text back
  } finally { busy = false; }
}
