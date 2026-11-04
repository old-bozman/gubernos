// A daily copy of the vault's Markdown files, made by the server itself (no git, no tar: nothing to install, on any OS):
// ~/.gubernos/backups/YYYY-MM-DD/<the vault's .md files, same folders>. Kept: the last 14 days, and the newest copy of
// each of the 8 weeks before. A plain folder, so a person (or their agent) restores a file by copying it back.
// Attachments aren't copied (big, and they don't change); Time Machine covers them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VAULT } from './config.js';
import { localDate } from './vault.js';

export const DIR = process.env.GUBERNOS_BACKUP_DIR || path.join(os.homedir(), '.gubernos', 'backups');
const DAYS = 14, WEEKS = 8;

function walk(dir, rel, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const r = rel ? path.join(rel, e.name) : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), r, out); else if (e.name.endsWith('.md')) out.push(r);
  }
}

// today's copy, unless there is one; returns {made, files, skipped}
export function backupToday({ root = VAULT, dir = DIR, today = localDate() } = {}) {
  const dest = path.join(dir, today);
  if (fs.existsSync(dest)) return { made: false };
  const tmp = `${dest}.partial`;
  fs.rmSync(tmp, { recursive: true, force: true });
  const files = [];
  walk(root, '', files);
  let skipped = 0;
  for (const r of files) {
    try { fs.mkdirSync(path.dirname(path.join(tmp, r)), { recursive: true }); fs.writeFileSync(path.join(tmp, r), fs.readFileSync(path.join(root, r))); } catch { skipped++; } // an iCloud placeholder: in tomorrow's copy
  }
  fs.renameSync(tmp, dest);
  prune(dir);
  return { made: true, files: files.length - skipped, skipped };
}

// ISO-ish week key (the Monday) of a YYYY-MM-DD
const weekOf = (d) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };

export function prune(dir = DIR) {
  let days;
  try { days = fs.readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort().reverse(); } catch { return []; }
  const keep = new Set(days.slice(0, DAYS)), weeks = new Set(days.slice(0, DAYS).map(weekOf));
  let older = 0;
  for (const d of days.slice(DAYS)) { // newest first: the first copy seen of an older week is its newest
    if (older < WEEKS && !weeks.has(weekOf(d))) { weeks.add(weekOf(d)); keep.add(d); older++; }
  }
  const removed = days.filter((d) => !keep.has(d));
  for (const d of removed) fs.rmSync(path.join(dir, d), { recursive: true, force: true });
  return removed;
}

// on start, then hourly: today's copy once the day has one
export function start() {
  const run = () => { try { const r = backupToday(); if (r.made) console.log(`[backup] ${r.files} files → ${path.join(DIR, localDate())}${r.skipped ? ` (${r.skipped} unreadable, next time)` : ''}`); } catch (e) { console.error('[backup]', e.message); } };
  setTimeout(run, 60 * 1000);
  setInterval(run, 60 * 60 * 1000);
}
