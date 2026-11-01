// Todoist-style quick-add parsing (repeats: see recur.js — "every monday", "каждый месяц 1-го"):
//   "Draft SSI report fri p1 #personal-os @agent {oct 1}"
//   dates: today tomorrow tmr mon..sun "next week" weekend "in 3 days" +3d +2w 2026-10-01 "24 sep" "sep 24" 24/9
//   ru: сегодня завтра послезавтра "в пятницу" пт "через 3 дня" "через неделю" "на выходных" "на следующей неделе" "25 сентября"
//   times → a reminder on the due date (today, or tomorrow if that time has passed): 10:00 · at 10 · 10am · 3:30pm · в 10 · в 10:30 · в 9 утра · в 7 вечера
//   p1 → urgent, p2/p3 → planned, p4 → someday · #project · @agent/@me/@someone, @claude/@codex/@gemini or @<assistant> (a specific agent; assistant = profile.md's, e.g. @cosy), other @x → label · {date} → deadline

import { parseRepeat } from './recur.js';

const B = '(?<=^|\\s)', E = '(?=\\s|$|[,.;!?])';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const RU_DAYS = { 'пн': 1, 'вт': 2, 'ср': 3, 'чт': 4, 'пт': 5, 'сб': 6, 'вс': 0 };
const RU_MON = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
const RU_MON_RE = '(январ[яь]|феврал[яь]|марта?|апрел[яь]|ма[яй]|июн[яь]|июл[яь]|августа?|сентябр[яь]|сен|сент|октябр[яь]|окт|ноябр[яь]|ноя|декабр[яь]|дек)';
const ruMonth = (w) => ({ сен: 8, сент: 8, окт: 9, ноя: 10, дек: 11 })[w] ?? RU_MON.findIndex((m) => (m === 'ма' ? /^ма[яй]$/.test(w) : w.startsWith(m)));
const RU_DOW = { понедельник: 1, вторник: 2, сред: 3, четверг: 4, пятниц: 5, суббот: 6, воскресень: 0 };
const MON_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

export const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const fromIso = (s) => new Date(`${s}T12:00:00`);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

// Ordered: first match in the text wins.
const DATE_RULES = [
  [/(today|tonight|сегодня|вечером)/, (t) => t],
  [/(?:by )?(end of (?:the )?week|eow|до конца недели|к концу недели)/, (t) => (t.getDay() === 5 ? t : nextDow(t, 5))],
  [/(?:by )?(end of (?:the )?month|eom|до конца месяца|к концу месяца|в конце месяца)/, (t) => new Date(t.getFullYear(), t.getMonth() + 1, 0, 12)],
  [/(next month|в следующем месяце)/, (t) => new Date(t.getFullYear(), t.getMonth() + 1, 1, 12)],
  [/(послезавтра|day after tomorrow)/, (t) => addDays(t, 2)],
  [/(tomorrow|tmrw?|завтра)/, (t) => addDays(t, 1)],
  [/(next week|(?:на )?след(?:ующей|ующая|\.)? недел[еяю])/, (t) => addDays(t, ((8 - t.getDay()) % 7) || 7)],
  [/((?:this |next |on the )?weekend|(?:на )?выходн(?:ых|ые))/, (t) => (t.getDay() === 6 ? t : nextDow(t, 6))],
  [/через (\d+) ?(дн(?:я|ей|ь)|недел[июь]|месяц(?:а|ев)?)/, (t, m) => unit(t, +m[1], m[2].startsWith('н') ? 'w' : m[2].startsWith('м') ? 'm' : 'd')],
  [/через (недел[юи]|месяц)/, (t, m) => unit(t, 1, m[1].startsWith('н') ? 'w' : 'm')],
  [new RegExp(`(\\d{1,2}) ${RU_MON_RE}`), (t, m) => nextMonthDay(t, ruMonth(m[2]), +m[1])],
  [/(?:во? )?(понедельник[ау]?|вторник[ау]?|сред[уаеы]|четверг[ау]?|пятниц[уаеы]|суббот[уаеы]|воскресень[еяю])/, (t, m) => nextDow(t, RU_DOW[Object.keys(RU_DOW).find((k) => m[1].startsWith(k))])], // в пятницу, к пятнице, до пятницы
  [/in (\d+) ?(d|days?|w|weeks?|m|months?)/, (t, m) => unit(t, +m[1], m[2])],
  [/\+(\d+)(d|w|m)/, (t, m) => unit(t, +m[1], m[2])],
  [/(\d{4})-(\d{2})-(\d{2})/, (t, m) => new Date(+m[1], m[2] - 1, +m[3], 12)],
  [new RegExp(`(?:on )?(\\d{1,2})(?:st|nd|rd|th)? (?:of )?${MON_RE}`), (t, m) => nextMonthDay(t, MONTHS.indexOf(m[2].slice(0, 3)), +m[1])],
  [new RegExp(`(?:on )?${MON_RE} (\\d{1,2})(?:st|nd|rd|th)?`), (t, m) => nextMonthDay(t, MONTHS.indexOf(m[1].slice(0, 3)), +m[2])],
  [/(\d{1,2})[/.](\d{1,2})/, (t, m) => nextMonthDay(t, m[2] - 1, +m[1])],
  [/(?:on |next |this )?(sun|mon|tue|wed|thu|fri|sat)(?:day|s|sday|rsday|nesday|urday)?/, (t, m) => nextDow(t, DAYS.indexOf(m[1]))],
  [/(пн|вт|ср|чт|пт|сб|вс)/, (t, m) => nextDow(t, RU_DAYS[m[1]])],
];
function unit(t, n, u) {
  if (u.startsWith('w')) return addDays(t, 7 * n);
  if (u.startsWith('m')) { const x = new Date(t); x.setMonth(x.getMonth() + n); return x; }
  return addDays(t, n);
}
function nextDow(t, dow) { return addDays(t, ((dow - t.getDay() + 7) % 7) || 7); }
function nextMonthDay(t, mon, day) {
  if (mon < 0 || mon > 11 || day < 1 || day > 31) return null;
  const d = new Date(t.getFullYear(), mon, day, 12);
  if (d < addDays(t, -1)) d.setFullYear(d.getFullYear() + 1);
  return d;
}

// Times: first match wins. "в 3 дня" = 15:00 (не "через 3 дня" — that's a date rule).
const pad = (n) => String(n).padStart(2, '0');
const TIME_RULES = [
  [/(?:at |в |@ ?)?(\d{1,2}):(\d{2}) ?(am|pm)?/, (m) => hm(m[1], m[2], m[3])],
  [/(?:at )?(\d{1,2}) ?(am|pm)/, (m) => hm(m[1], 0, m[2])],
  [/в (\d{1,2})(?::(\d{2}))? ?(утра|дня|вечера|ночи)/, (m) => hm(m[1], m[2] || 0, { утра: 'am', ночи: 'am', дня: 'pm', вечера: 'pm' }[m[3]])],
  [/(?:в|at) (\d{1,2})(?: ?ч(?:ас(?:а|ов)?)?)?/, (m) => hm(m[1], 0)],
];
function hm(h, m, ap) {
  h = +h; m = +m;
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return h > 23 || m > 59 ? null : `${pad(h)}:${pad(m)}`;
}
export function parseTime(text) {
  for (const [re, fn] of TIME_RULES) {
    const m = new RegExp(`${B}${re.source}${E}`, 'i').exec(text.toLowerCase());
    if (m) { const t = fn(m); if (t) return { time: t, index: m.index, length: m[0].length }; }
  }
  return null;
}

// by: the date is a limit — "к пятнице", "до 15 октября", "by friday", "до конца месяца" (the word goes with the match)
const BY_RE = /(?:^|\s)(к|ко|до|by|before|не позже|no later than|uiterlijk)\s*$/i;
export function parseDate(text, today) {
  const t = fromIso(today);
  for (const [re, fn] of DATE_RULES) {
    const m = new RegExp(`${B}${re.source}${E}`, 'i').exec(text.toLowerCase());
    if (!m) continue;
    const d = fn(t, m);
    if (!d) continue;
    const pre = BY_RE.exec(text.slice(0, m.index));
    const by = !!pre || /^(до|к|by)\s/i.test(m[0]);
    const index = pre ? pre.index + (pre[0].length - pre[0].trimStart().length) : m.index; // the limit word leaves the title too
    return { date: iso(d), index, length: m.index + m[0].length - index, by };
  }
  return null;
}

export function parseQuick(raw, { projects = [], today, now = new Date(), assistant = null }) {
  let text = ` ${raw} `;
  const out = { due: null, deadline: null, priority: null, assigned: null, project: null, labels: [], chips: [], recurrence: null, agent: null, time: null, reminder: null };
  const cut = (idx, len) => { text = `${text.slice(0, idx)} ${text.slice(idx + len)}`; };

  const rep = parseRepeat(text, today);
  if (rep) { out.recurrence = rep.recurrence; cut(rep.index, rep.length); }

  const dl = /\{([^}]+)\}/.exec(text);
  if (dl) { const d = parseDate(dl[1], today); if (d) { out.deadline = d.date; cut(dl.index, dl[0].length); } }

  let m = new RegExp(`${B}p([1-4])${E}`, 'i').exec(text);
  if (m) { out.priority = ({ 1: 'urgent', 2: 'planned', 3: 'planned', 4: 'someday' })[m[1]]; cut(m.index, m[0].length); }
  m = new RegExp(`${B}!(urgent|someday|planned)${E}`, 'i').exec(text);
  if (m) { out.priority = m[1].toLowerCase(); cut(m.index, m[0].length); }

  m = new RegExp(`${B}#([\\w.-]+)${E}`).exec(text);
  if (m) {
    const p = matchProject(m[1], projects);
    if (p) { out.project = p.slug; cut(m.index, m[0].length); }
  }

  for (;;) {
    m = new RegExp(`${B}@([\\w-]+)${E}`).exec(text);
    if (!m) break;
    const w = m[1].toLowerCase();
    const named = ['claude', 'codex', 'gemini', ...(assistant ? [assistant] : [])];
    if (['agent', 'ai', 'bot', ...named].includes(w)) { out.assigned = 'agent'; if (named.includes(w)) out.agent = w; }
    else if (['me', 'я'].includes(w)) out.assigned = 'me';
    else if (['someone', 'wait', 'waiting', 'delegate'].includes(w)) out.assigned = 'someone';
    else out.labels.push(m[1]);
    cut(m.index, m[0].length);
  }

  const tm = parseTime(text); // before dates: "в 10" is a time
  if (tm) { out.time = tm.time; cut(tm.index, tm.length); }

  const d = parseDate(text, today);
  if (d) { out.due = d.date; cut(d.index, d.length); }
  if (rep && !out.due) out.due = rep.due; // a repeat without a start date starts at its first occurrence
  if (out.time) { // a time is a reminder that day; with no date: today, or tomorrow if that time is gone
    if (!out.due) out.due = `${today}T${out.time}` > `${iso(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}` ? today : iso(addDays(fromIso(today), 1));
    out.reminder = `${out.due}T${out.time}`;
  }

  out.title = text.replace(/\s+/g, ' ').trim();
  return out;
}

export function matchProject(q, projects) {
  const n = q.toLowerCase();
  return projects.find((p) => p.slug === n) ||
    projects.find((p) => p.slug.startsWith(n)) ||
    projects.find((p) => p.slug.includes(n) || p.title.toLowerCase().includes(n));
}
