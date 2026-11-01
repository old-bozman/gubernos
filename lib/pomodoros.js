// Finished pomodoros, one CSV line each, in the vault next to the weekly reviews (so the review can count them).
import fs from 'node:fs';
import path from 'node:path';
import { VAULT, localDate, listTasks, httpError } from './vault.js';
import { weekStartDate } from './model.js';

const FILE = path.join(VAULT, '50_reviews', 'pomodoros.csv');
const HEADER = 'date,start,end,minutes,task_id,task,project';

const csv = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

function rows() {
  if (!fs.existsSync(FILE)) return [];
  return fs.readFileSync(FILE, 'utf8').split('\n').slice(1).filter(Boolean).map((line) => {
    const cells = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { cells.push(cur); cur = ''; } else cur += ch;
    }
    cells.push(cur);
    const [date, start, end, minutes, task_id, task, project] = cells;
    return { date, start, end, minutes: Number(minutes) || 0, task_id, task, project };
  });
}

// body: {start, end} as epoch ms (the client's real phase times), minutes, taskId
export function logPomodoro({ start, end, minutes = 25, taskId = null }) {
  const s = new Date(Number(start)), e = new Date(Number(end));
  if (!Number.isFinite(s.getTime()) || !Number.isFinite(e.getTime()) || e <= s) throw httpError(400, 'start/end required');
  const date = localDate(e);
  // Idempotent: the same pomodoro may be reported twice (retry, two tabs).
  if (rows().some((r) => r.date === date && r.start === hm(s))) return stats();
  const t = taskId ? listTasks().find((x) => x.id === taskId) : null;
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, `${HEADER}\n`);
  fs.appendFileSync(FILE, `${[date, hm(s), hm(e), minutes, taskId || '', t?.title || '', t?.project || ''].map(csv).join(',')}\n`);
  return stats();
}

export function stats() {
  const all = rows();
  const today = localDate();
  const d = new Date(`${today}T12:00:00`);
  const week = localDate(weekStartDate(d)); // this week by Settings → week starts on
  const days = Array.from({ length: 7 }, (_, i) => { const x = new Date(d); x.setDate(d.getDate() - 6 + i); return localDate(x); });
  const byTask = {};
  for (const r of all.filter((x) => x.date === today && x.task_id)) byTask[r.task_id] = (byTask[r.task_id] || 0) + 1;
  return {
    today: all.filter((r) => r.date === today).length,
    week: all.filter((r) => r.date >= week && r.date <= today).length,
    last7: days.map((day) => ({ date: day, count: all.filter((r) => r.date === day).length })),
    todayByTask: byTask,
  };
}
