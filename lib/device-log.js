// The iPhone app's own log (gubernos-ios Gubernos/AppLog.swift): how long it looked for the Mac and what it decided,
// page and offline loads, the page's errors — timings and states, never task contents. 2026-11-10: the app hung for
// 30 s away from the Mac and there was no way to see why without Xcode. The phone sends its last lines only when its
// owner shares them (This iPhone → Share the app's log: on by default when paired with the developer's own Mac, asked
// once elsewhere); they're kept as data/device-logs/<phone>.log and a bug report from a phone carries their tail
// (lib/feedback.js), so on someone else's install they reach the developer only with a report they send.
import fs from 'node:fs';
import path from 'node:path';
import { httpError } from './vault.js';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const DIR = path.join(process.env.GUBERNOS_DATA_DIR || path.join(ROOT, 'data'), 'device-logs');
const MAX_LINES = 500;

// {device: an id the phone keeps, lines: [text]} → the phone's whole recent log replaces what was kept
export function save({ device, lines } = {}) {
  const id = String(device || '').replace(/[^\w-]/g, '').slice(0, 40);
  if (!id || !Array.isArray(lines)) throw httpError(400, 'device and lines');
  const text = lines.slice(-MAX_LINES).map((l) => String(l).replace(/[\r\n]+/g, ' ').slice(0, 500)).join('\n');
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, `${id}.log`), `${text}\n`);
  return { ok: true, lines: Math.min(lines.length, MAX_LINES) };
}

// the last `n` lines of the phone log written most recently (within a day), [] when none was shared
export function tail(n = 40) {
  let files = [];
  try { files = fs.readdirSync(DIR).filter((f) => f.endsWith('.log')).map((f) => ({ f, t: fs.statSync(path.join(DIR, f)).mtimeMs })); } catch { return []; }
  const last = files.sort((a, b) => b.t - a.t)[0];
  if (!last || Date.now() - last.t > 864e5) return [];
  return fs.readFileSync(path.join(DIR, last.f), 'utf8').trim().split('\n').slice(-n);
}
