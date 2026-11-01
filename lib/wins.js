// A week's wins check themselves when they link something that can be counted (05_model/focus.md, "- [ ] result · [[link]]"):
// a task → won when the task is done; a protocol or a habit → won when it was closed / done on N days of that week,
// N from the text ("× 3", "x3", "3 days", "3 times"; none = every day of the week). Projects, goals, decisions: by hand.
import * as V from './vault.js';
import * as M from './model.js';
import * as H from './habits.js';

const linkOf = (text) => text.match(/·\s*\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s*$/)?.[1].trim() || null;
// "× 3" / "x 3" first ("start 06:30 x 3 days" is 3, not 30), then "3 days" / "3 times"
const countOf = (text) => { const m = text.match(/(?:^|\s)[x×]\s*(\d+)\b/i) || text.match(/\b(\d+)\s*(?:days?|times|раз|дн)/i); return m ? Number(m[1]) : null; };

// The dates of the week named iso ("2026-W44"): looked up among the last few weeks (Settings → week starts on).
function weekRange(iso) {
  const now = new Date();
  for (let i = -1; i < 12; i++) { const w = M.isoWeek(new Date(now.getTime() - i * 7 * 864e5)); if (w.iso === iso) return w; }
  return null;
}

// {kind, done, have, need, title} for one win line, or null when its link isn't something countable.
export function autoOf(text, iso) {
  const slug = linkOf(text);
  if (!slug) return null;
  let t = null;
  try { t = V.getTask(slug); } catch { /* not a task */ }
  if (t) return { kind: 'task', done: t.status === 'done' && !t.dropped, title: t.title };
  const w = iso && weekRange(iso);
  if (!w) return null;
  const end = w.end < V.localDate() ? w.end : V.localDate(); // this week: the days so far
  let r = null;
  try { r = H.daysDone(slug, w.start, end); } catch { /* habits module off */ }
  if (!r) return null;
  const need = Math.min(7, countOf(text) || 7);
  return { kind: r.kind, done: r.days >= need, have: r.days, need, title: r.title };
}

// readFocus() with each week's items carrying `auto` (and done when auto says so), plus what a win can link to.
export function withAuto(f) {
  if (!f) return f;
  const mark = (sec) => sec && { ...sec, items: sec.items.map((x) => { const a = x.legacy ? null : autoOf(x.text, sec.iso); return a ? { ...x, auto: a, manual: x.done, done: x.done || a.done } : x; }) };
  let targets = [];
  try { const ps = H.listProtocols(); targets = [...ps.filter((p) => p.window).map((p) => ({ slug: p.slug, title: `${p.title} protocol`, kind: 'protocol' })), ...H.listHabits(ps).map((h) => ({ slug: h.slug, title: h.title, kind: 'habit' }))]; } catch { /* habits off */ }
  return { ...f, week: mark(f.week), previous: mark(f.previous), next: f.next, targets };
}

// A finished week's section text with the wins that count as won ticked ("- [ ]" → "- [x]"), before it becomes
// "Previous week": the file then says what happened, for the weekly review.
export function tickWon(sectionText, iso) {
  return sectionText.replace(/^- \[ \] (.+)$/gm, (line, text) => (autoOf(text, iso)?.done ? `- [x] ${text}` : line));
}
M.onWeekEnd(tickWon);
