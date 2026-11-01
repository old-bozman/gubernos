// The weekly roll (vault 50_reviews/CLAUDE.md step 11): the check-ins up to `through` → 50_reviews/habit-stats.csv, then the
// daily files' `## Habits` sections → 80_archive/habits/<week>.md (only stats stay in 50_reviews; plans and reflections stay).
//   node scripts/roll-habit-stats.mjs [--through YYYY-MM-DD] [--dry]
// --through: default the last day of the last complete week (Settings → week starts on). Run it after the weekly review.
import { rollStats } from '../lib/habits.js';
import { weekStartDate } from '../lib/model.js';
import { localDate } from '../lib/vault.js';

const args = process.argv.slice(2);
const at = args.indexOf('--through');
const through = at >= 0 ? args[at + 1] : (() => { const d = weekStartDate(new Date()); d.setDate(d.getDate() - 1); return localDate(d); })();
const r = rollStats({ through, dry: args.includes('--dry') });
for (const x of r.report) console.log(`${x.slug.padEnd(20)} ${x.from} → ${x.through} · +${x.done} done · streak ${x.streak}`);
console.log(JSON.stringify({ through: r.through, habits: r.habits, archived: r.archived }));
