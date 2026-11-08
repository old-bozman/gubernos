#!/usr/bin/env node
// What the model cost, from data/costs.jsonl (lib/llm.js logCost): per job and per day, and a month at this pace.
// Claude's price is what the same tokens cost on the API, so this is the bill on an API key.
//   node scripts/costs.mjs [days=30]
import fs from 'node:fs';
import path from 'node:path';

const DATA = process.env.GUBERNOS_DATA_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data');
const days = Number(process.argv[2]) || 30, since = Date.now() - days * 864e5;
let rows = [];
try { rows = fs.readFileSync(path.join(DATA, 'costs.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => Date.parse(r.at) >= since); } catch { /* none yet */ }
if (!rows.length) { console.log('No model calls logged yet.'); process.exit(0); }
const $ = (n) => `$${n.toFixed(2)}`, sum = (xs) => xs.reduce((n, r) => n + (r.cost || 0), 0);
const by = (key) => Object.entries(rows.reduce((m, r) => ((m[key(r)] ||= []).push(r), m), {}));
const span = Math.max(1, (Date.now() - Math.min(...rows.map((r) => Date.parse(r.at)))) / 864e5);
console.log(`Last ${Math.round(span * 10) / 10} days: ${rows.length} calls, ${$(sum(rows))}; a month at this pace ≈ ${$(sum(rows) / span * 30)}${rows.some((r) => r.cost == null) ? ` (${rows.filter((r) => r.cost == null).length} calls without a price: Codex)` : ''}\n`);
console.log('By job:');
for (const [k, rs] of by((r) => `${r.job} · ${r.model}`).sort((a, b) => sum(b[1]) - sum(a[1]))) console.log(`  ${k.padEnd(28)} ${String(rs.length).padStart(5)} calls  ${$(sum(rs)).padStart(9)}`);
console.log('\nBy day:');
for (const [k, rs] of by((r) => r.at.slice(0, 10)).sort()) console.log(`  ${k}  ${String(rs.length).padStart(5)} calls  ${$(sum(rs)).padStart(9)}`);
