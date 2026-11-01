#!/usr/bin/env node
// The dev session's queue (AGENTS.md → Dev session): waits until a task is queued for the dev agent
// (assigned: agent, agent: dev, agent_state: queued), prints them oldest first and exits — run it in the background and
// take the tasks when it ends. While it waits it marks the session alive in data/dev-session.json.
//   node scripts/dev-queue.mjs          wait for the queue
//   node scripts/dev-queue.mjs --now    print what's queued now (maybe nothing) and exit
import fs from 'node:fs';
import path from 'node:path';
import { PORT } from '../lib/config.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BEAT = path.join(ROOT, 'data', 'dev-session.json');
const once = process.argv.includes('--now');

async function queued() {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/state`);
  if (!r.ok) throw new Error(`state ${r.status}`);
  const { tasks } = await r.json();
  return tasks.filter((t) => t.assigned === 'agent' && t.agent === 'dev' && t.agent_state === 'queued' && t.status !== 'done')
    .sort((a, b) => a.id.localeCompare(b.id));
}

for (;;) {
  try { fs.writeFileSync(BEAT, JSON.stringify({ at: new Date().toISOString(), pid: process.pid })); } catch { /* data/ missing */ }
  let q = [];
  try { q = await queued(); } catch (e) { if (once) { console.error(e.message); process.exit(1); } }
  if (q.length || once) {
    for (const t of q) console.log(`${t.id} | ${t.title}${(t.labels || []).length ? ` [${t.labels.join(', ')}]` : ''}`);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 20_000));
}
