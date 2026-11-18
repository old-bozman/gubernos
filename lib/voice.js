// Voice capture: audio → text on this Mac → the app's model → task drafts.
// Two engines, both local: the Mac's own speech models (tools/voice/gubernos-voice, macOS 26+, nothing to install) and
// Whisper (MLX, lib/stt.py; scripts/setup.sh voice). Whisper when it's installed: it hears Russian, mixed languages and
// accents far better (2026-11-02 comparison); otherwise the Mac's models, in the language set in Settings → Voice.
// The app sends 16 kHz mono WAV (public/app.js toWav), so neither needs ffmpeg.
// Nothing is written to the vault here; the UI shows drafts and creates tasks via /api/tasks.
import { spawn, execFile } from 'node:child_process';
import { ask } from './llm.js';
import fs from 'node:fs';
import path from 'node:path';
import { listProjects, listTasks, httpError, localDate } from './vault.js';
import { resolveDateSpec, DATE_SPEC_SCHEMA } from './dates.js';
import { parseRepeat } from '../public/recur.js';
import { parseDate } from '../public/parse.js';
import { profile } from './config.js';
import { get as settings } from './settings.js';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const TMP = path.join(ROOT, '.runs');
const PY = process.env.GUBERNOS_STT_PYTHON || path.join(ROOT, '.venv/bin/python');
const HELPER = process.env.GUBERNOS_VOICE_BIN || path.join(ROOT, 'tools/voice/gubernos-voice');
const whisperInstalled = () => fs.existsSync(PY);
// Whisper reads WAV itself; any other format (an old client) goes through ffmpeg, if there is one
const hasFfmpeg = () => ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].some((f) => fs.existsSync(f));
const NO_FFMPEG = 'This recording needs ffmpeg on the Mac: reload the app (it sends WAV now), or brew install ffmpeg';

// The language the owner speaks to the app: Settings → Voice (settings.voiceLanguage: a locale such as "en-US", or
// "mixed" — several languages, which only Whisper hears); unset → profile.md's language, else English.
const LANGS = { english: 'en-US', russian: 'ru-RU', ukrainian: 'uk-UA', dutch: 'nl-NL', german: 'de-DE', french: 'fr-FR', spanish: 'es-ES', italian: 'it-IT', portuguese: 'pt-BR', japanese: 'ja-JP', korean: 'ko-KR', chinese: 'zh-CN', hindi: 'hi-IN' };
export const voiceLanguage = () => settings().voiceLanguage || LANGS[String(profile().language || '').trim().toLowerCase()] || 'en-US';

// What the Mac's own models hear ({speech: [...], dictation: [...]}, e.g. "en_US"): asked once at start
let locales = { speech: [], dictation: [] };
if (process.platform === 'darwin' && fs.existsSync(HELPER)) {
  execFile(HELPER, ['locales'], { timeout: 30000 }, (e, out) => {
    try { const r = JSON.parse(String(out).trim().split('\n').pop()); if (!r.error) locales = r; else vlog('Mac speech models:', r.error); } catch { vlog('voice helper failed:', e?.message); }
  });
}
// "ru-RU" in ["ru_RU", …], or the same language in another region (the helper maps it: supportedLocale(equivalentTo:))
const macHears = (kind, lang) => { const l = lang.replace('-', '_'), base = l.split('_')[0]; return (locales[kind] || []).some((x) => x === l || x.split('_')[0] === base); };
// whisper | speech (the Mac's newer model) | dictation (its older one: more languages) | null = no voice
export function voiceEngine(lang = voiceLanguage()) {
  if (whisperInstalled()) return 'whisper';
  if (lang === 'mixed') return null;
  return macHears('speech', lang) ? 'speech' : macHears('dictation', lang) ? 'dictation' : null;
}
export const voiceAvailable = () => !!voiceEngine();
// canWhisper: Settings → Voice offers Turn on voice (scripts/setup.sh voice-auto) where Whisper can run: Linux, WSL, Apple Silicon
export const voiceStatus = () => ({ engine: voiceEngine(), language: voiceLanguage(), whisper: whisperInstalled(), mac: locales, canWhisper: process.platform === 'linux' || process.arch === 'arm64' });
const IDLE_MS = 15 * 60 * 1000; // AICODE-NOTE: the model holds ~1.6 GB; free it when voice isn't used.

// AICODE-NOTE: two worker processes — "quick" (whisper-small, short commands) and "full" (large-v3-turbo,
// dictation). Separate processes so a command never waits behind the big model loading or decoding.
const workers = { quick: null, full: null };
let idleTimer = null, seq = 0;
const pending = new Map();

function getWorker(kind) {
  if (workers[kind]) return workers[kind];
  const w = spawn(PY, [path.join(ROOT, 'lib/stt.py'), kind], { stdio: ['pipe', 'pipe', 'pipe'] });
  workers[kind] = w;
  let buf = '';
  w.stdout.on('data', (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try { const r = JSON.parse(line); pending.get(r.id)?.(r); pending.delete(r.id); } catch { /* ignore */ }
    }
  });
  w.stderr.on('data', () => {}); // model download progress / warnings
  w.on('error', (e) => { vlog('worker failed to start:', e.message); }); // 'exit' follows and fails the pending calls
  w.on('exit', () => {
    workers[kind] = null;
    for (const [id, cb] of pending) if (cb.kind === kind) { cb({ id, error: 'speech worker exited' }); pending.delete(id); }
  });
  return w;
}

function touchIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { for (const k of Object.keys(workers)) { workers[k]?.kill(); workers[k] = null; } }, IDLE_MS);
}

export function vlog(...a) { console.log(new Date().toISOString().slice(11, 23), '[voice]', ...a); }

const EXT = { 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mpeg': 'mp3' };

// A 0.5 s silent WAV, used to load both models into memory before the user finishes speaking.
function silentWav() {
  const n = 8000, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
let warmedAt = 0;
export function warm() {
  if (!voiceAvailable()) return { warm: false, unavailable: true };
  if (voiceEngine() !== 'whisper') return { warm: true }; // the Mac's models start in a blink
  if (workers.quick && workers.full && Date.now() - warmedAt < IDLE_MS - 60000) { touchIdle(); return { warm: true }; }
  warmedAt = Date.now();
  const wav = silentWav();
  vlog('warming models');
  // Both in parallel (separate processes): quick is ready in ~1 s, full in ~4 s.
  transcribe(wav, 'audio/wav', { quick: true }).catch(() => { warmedAt = 0; });
  transcribe(wav, 'audio/wav').catch(() => { warmedAt = 0; });
  return { warm: false };
}

export async function transcribe(buffer, contentType, { quick = false } = {}) {
  if (!buffer.length) throw httpError(400, 'empty audio');
  const engine = voiceEngine(), lang = voiceLanguage();
  if (!engine) throw httpError(503, lang === 'mixed' ? 'Several languages need Whisper on the Mac: scripts/setup.sh voice' : `No speech model for ${lang} on this Mac (macOS 26 has them): pick another language in Settings → Voice, or install Whisper (scripts/setup.sh voice)`);
  const ext = EXT[(contentType || '').split(';')[0]] || 'webm';
  if (engine === 'whisper' && ext !== 'wav' && !hasFfmpeg()) throw httpError(503, NO_FFMPEG);
  fs.mkdirSync(TMP, { recursive: true });
  const file = path.join(TMP, `voice-${Date.now()}.${ext}`);
  fs.writeFileSync(file, buffer);
  if (engine !== 'whisper') return macTranscribe(file, lang, buffer.length, contentType);
  // Vocabulary hint so project names and agent words come out right.
  // Vocabulary hint: command words for short utterances, project names for dictation.
  const prompt = quick
    ? 'Команды: найди, поиск, скип, пропусти, дальше, готово, отмени, закрой, неактуально, удали задачу, стоп, пауза, старт, в архив, удали, принять, фокус, инбокс, сегодня, завтра, на выходные, на следующую неделю. Commands: search, find, skip, done, complete, drop, undo, revert, go, ok, focus, inbox, today, tomorrow, weekend, next week, stop.'
    : `Tasks. Projects: ${listProjects().filter((p) => p.status === 'active').map((p) => p.title).join(', ')}. ${profile().assistant ? `${profile().assistant.name}, ` : ''}агент, Claude.`;
  const id = ++seq;
  const kind = quick ? 'quick' : 'full';
  const t0 = Date.now();
  try {
    const r = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(httpError(504, 'transcription timed out')); }, 120000);
      const cb = (res) => { clearTimeout(timer); resolve(res); };
      cb.kind = kind;
      pending.set(id, cb);
      // a language chosen in Settings → Voice: Whisper decodes in it (accented English stays English); not chosen (the
      // default from profile.md is only a guess) or "mixed": it detects the language itself, as before
      const set = settings().voiceLanguage, language = set && set !== 'mixed' ? set.split('-')[0] : null;
      getWorker(kind).stdin.write(JSON.stringify({ id, path: file, prompt, quick, language }) + '\n');
    });
    if (r.error) throw httpError(/ffmpeg/i.test(r.error) ? 503 : 500, /ffmpeg/i.test(r.error) ? NO_FFMPEG : `transcription failed: ${r.error}`);
    if (buffer.length > 20000 || r.text) vlog(`${kind} ${Math.round(buffer.length / 1024)}KB ${contentType} → "${r.text.slice(0, 60)}" model ${r.ms}ms total ${Date.now() - t0}ms`);
    return { text: r.text, language: r.language, ms: r.ms, quick, engine };
  } finally {
    touchIdle();
    fs.rm(file, () => {});
  }
}

// The Mac's own models: one helper run per recording (they load in a blink). Hints: the active projects' names and the
// assistant's, so they come out right. The first use of a language may wait while macOS downloads its model.
function macTranscribe(file, lang, size, contentType) {
  const words = [...listProjects().filter((p) => p.status === 'active').map((p) => p.title), profile().assistant?.name, 'Claude']
    .filter(Boolean).map((w) => String(w).replace(/,/g, ' ')).slice(0, 60).join(',') || '-';
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    execFile(HELPER, ['transcribe', lang, words, file], { timeout: 600000 }, (e, out) => {
      fs.rm(file, () => {});
      let r;
      try { r = JSON.parse(String(out).trim().split('\n').pop()); } catch { return reject(httpError(500, `transcription failed: ${e?.message || out}`)); }
      if (r.error) return reject(httpError(500, `transcription failed: ${r.error}`));
      vlog(`${r.engine} ${lang} ${Math.round(size / 1024)}KB ${contentType} → "${r.text.slice(0, 60)}" ${r.ms}ms total ${Date.now() - t0}ms`);
      resolve({ text: r.text, language: lang, ms: r.ms, quick: false, engine: r.engine });
    });
  });
}

// the utterance → tasks or a command: lib/voice-parse.js (the iPhone app runs it too, with no Mac)
export { interpret, SCHEMA, COMMANDS } from './voice-parse.js';
