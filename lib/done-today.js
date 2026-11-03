// Tasks closed today, for the habits that take them (auto: app:tasks — "Close 3 tasks"): a recurring task rolls forward
// instead of keeping `completed`, so the count is kept here, data/tasks-done.json {date: [task ids]}, the last week only.
// A reopened task leaves the list (a check-in already written keeps its value: auto values only grow during a day).
import fs from 'node:fs';
import path from 'node:path';
import { localDate } from './vault.js';
import * as H from './habits.js';

const DATA = process.env.GUBERNOS_DATA_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data');
const FILE = path.join(DATA, 'tasks-done.json');
const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } };

export function count(date = localDate()) { return (read()[date] || []).length; }

export function noteDone(id, done = true) {
  const date = localDate(), all = read(), ids = new Set(all[date] || []);
  if (done) ids.add(id); else ids.delete(id);
  all[date] = [...ids];
  for (const d of Object.keys(all).sort().slice(0, -7)) delete all[d];
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(all)); } catch (e) { console.warn('[tasks-done]', e.message); }
  if (done) try { H.applyAuto({ date, source: 'app', values: { tasks: ids.size } }); } catch (e) { console.warn('[tasks-done] habit:', e.message); }
  return ids.size;
}
