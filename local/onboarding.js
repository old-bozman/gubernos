// lib/onboarding.js on the iPhone with no Mac (scripts/build-local.mjs maps /lib/onboarding.js here): the first interview
// right on the phone, on the owner's API key (local/llm.js). The same skill as on the Mac (kit/vault/.claude/skills/onboarding,
// shipped in the bundle: the phone's copy of the vault leaves hidden folders out), one session; its progress is kept in the
// vault by the skill, so a lost session just continues. No model to sign in to here: without a key the page sends the owner
// to Settings → This iPhone.
import fs from 'node:fs';
import { chatTurn, current, hasKey } from '/lib/llm.js';
import { httpError, localDate } from '/lib/vault.js';

const FILE = '/data/onboarding.json';
const SCHEMA = { type: 'object', properties: { reply: { type: 'string' }, finished: { type: 'boolean' } }, required: ['reply', 'finished'], additionalProperties: false };
const HERE = 'You run inside the Gubernos app\'s interview screen on the owner\'s iPhone, and the owner is mostly talking into the mic, so expect loose, rambling, mistranscribed speech and pick out what matters. The screen already told them to set aside about 10 minutes and asked its opening question. Your reply is shown as a chat message in Markdown. You can read and write files in the vault (the current folder), nothing else. Set finished to true only after the last question (one habit) is answered and its files are written, or if the owner says to stop altogether. A line [Now: …] at the start of a message is the current date and time, from the app; it is not part of what the owner said.';
let skill = null;
const SKILL = async () => (skill ??= await fetch('/local/onboarding-skill.md').then((r) => (r.ok ? r.text() : null)).catch(() => null));

const load = () => { try { return JSON.parse(fs.readFileSync(FILE)); } catch { return { session: null, turns: [], finished: false }; } };
const save = (s) => { fs.writeFileSync(FILE, JSON.stringify(s)); return s; };
const view = (s) => ({ turns: s.turns, finished: !!s.finished, model: hasKey() ? current() : null, connecting: null, models: [], phone: true });
export const state = () => view(load());

let busy = false;
export async function turn(message) {
  if (busy) throw httpError(409, 'still answering');
  const s = load(), text = String(message || '').trim();
  if (!text) throw httpError(400, 'message required');
  if (!hasKey()) throw httpError(409, 'No AI key on this iPhone yet: Settings → This iPhone → AI API key');
  const system = await SKILL();
  if (!system) throw httpError(409, 'the interview isn’t in this version of the app');
  busy = true;
  try {
    const d = await chatTurn({ system: `${system}\n\n${HERE}`, prompt: `[Now: ${new Date().toLocaleString('en-GB', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}, ${localDate()}]\n\n${text}`, schema: SCHEMA, session: s.session, deep: true, write: true });
    s.session = d.session;
    s.turns.push({ from: 'you', text }, { from: 'agent', text: d.output.reply });
    s.finished = !!d.output.finished;
    return view(save(s));
  } catch (e) {
    console.error('[onboarding]', String(e.message).slice(0, 300));
    throw httpError(e.status === 503 ? 503 : 502, 'The model couldn’t answer. Your words are still in the box: try again.');
  } finally { busy = false; }
}
