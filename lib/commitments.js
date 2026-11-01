// The weekly commit ritual's history (Wins screen → hold to commit): which weeks were committed, with which wins,
// and how many of them got checked. App data (data/commitments.json), not canon — the wins themselves live in
// 05_model/focus.md. Gives the streak (weeks committed in a row) and the wins achieved so far.
import fs from 'node:fs';
import path from 'node:path';
import { now } from './clock.js';

const DATA = process.env.GUBERNOS_DATA_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data');
const FILE = path.join(DATA, 'commitments.json');
const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } };

// iso "2026-W41"; items [{text, done}]; commit: this save is the ritual itself (else only the checkmarks are updated)
export function record(iso, items, { commit = false } = {}) {
  if (!iso) return;
  const all = read();
  const prev = all[iso];
  if (!commit && !prev) return;
  all[iso] = { committedAt: commit ? now().toISOString() : prev.committedAt, items: items.map((x) => ({ text: x.text, done: !!x.done })) };
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(all, null, 1));
}

// streak: committed weeks in a row ending at `iso`; achieved: checked wins over all committed weeks
export function stats(iso) {
  const all = read();
  const weekBefore = (w) => {
    const [y, n] = w.split('-W').map(Number);
    if (n > 1) return `${y}-W${String(n - 1).padStart(2, '0')}`;
    const dec28 = new Date(Date.UTC(y - 1, 11, 28)); // the last ISO week of the previous year contains 28 Dec
    const t = new Date(dec28); t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    return `${y - 1}-W${String(Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7)).padStart(2, '0')}`;
  };
  let streak = 0;
  for (let w = iso; w && all[w]?.committedAt; w = weekBefore(w)) streak++;
  const achieved = Object.values(all).reduce((n, x) => n + (x.items || []).filter((i) => i.done).length, 0);
  return { streak, achieved, weeks: Object.values(all).filter((x) => x.committedAt).length };
}
