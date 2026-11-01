// Repeats in words ⇄ canon `recurrence`. Shared by the browser (quick add, Repeat field) and the server (completing).
// Canon keeps a cron pattern (`min hour dom month dow`, only the date fields matter) whenever cron can say it, and a small
// interval form `every N days|weeks|months|years` when it can't ("every 2 weeks" has no cron equivalent).
//   en: every day · daily · every weekday · every weekend · every monday · every mon and thu · every week · weekly ·
//       every 2 weeks · every other week · every month · monthly on the 1st · every 15th · every year · every year on 5 oct
//   ru: каждый день · ежедневно · по будням · по выходным · каждый понедельник · по понедельникам и четвергам ·
//       каждую неделю · каждые 2 недели · раз в две недели · каждый месяц · каждый месяц 1-го · 1-го числа каждого месяца ·
//       каждый год · каждый год 5 октября

const B = '(?<=^|\\s)', E = '(?=\\s|$|[,.;!?])';
const DOW_EN = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DOW_RU = { воскрес: 0, понедельн: 1, вторн: 2, сред: 3, четверг: 4, пятниц: 5, суббот: 6 };
const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MON_RU = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
const NUM = { other: 2, two: 2, three: 3, four: 4, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6 };

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = (s) => new Date(`${s}T12:00:00`);

const ruDow = (w) => { const k = Object.keys(DOW_RU).find((x) => w.startsWith(x)); return k === undefined ? null : DOW_RU[k]; };
const enDow = (w) => { const i = DOW_EN.indexOf(w.slice(0, 3)); return i < 0 ? null : i; };
const ruMon = (w) => (/^ма[йя]$/.test(w) ? 4 : MON_RU.findIndex((m, i) => i !== 4 && w.startsWith(m)));
const enMon = (w) => MON_EN.indexOf(w.slice(0, 3));
const unitOf = (w) => (/^(d|дн|ден|сут)/.test(w) ? 'days' : /^(w|нед)/.test(w) ? 'weeks' : /^(m|мес)/.test(w) ? 'months' : /^(y|год|лет)/.test(w) ? 'years' : null);
const cronDows = (days) => [...new Set(days)].sort((a, b) => a - b).join(',');

const EN_DAY = '(?:mon(?:day)?|tues?(?:day)?|wed(?:nesday)?|thu(?:rs?)?(?:day)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)s?(?![a-z])';
const RU_DAY = '(?:понедельн|вторн|сред|четверг|пятниц|суббот|воскресен)[а-я]*';
const EN_MONTH = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';
const RU_MONTH = '(январ[яь]|феврал[яь]|марта?|апрел[яь]|ма[яй]|июн[яь]|июл[яь]|августа?|сентябр[яь]|октябр[яь]|ноябр[яь]|декабр[яь])';

// Each rule: regex (matched on lowercased text) → recurrence, given today's date.
const RULES = [
  [/(?:every day|each day|daily|каждый день|ежедневно)/, () => '0 9 * * *'],
  [/(?:every weekday|each weekday|on weekdays|weekdays|по будням|каждый будний день|в будни)/, () => '0 9 * * 1-5'],
  [/(?:every weekend|on weekends|по выходным|каждые выходные)/, () => '0 9 * * 0,6'],
  // intervals first, so "every 2 weeks" doesn't read as "every week"
  [/(?:every|each|каждые|каждых|раз в)\s+(\d+|other|two|three|four|два|две|три|четыре|пять|шесть)\s+(days?|weeks?|months?|years?|дн[яейь]|день|недел[иьюя]|месяц[аев]*|год[а]?|лет)/,
    (t, m) => { const n = Number(m[1]) || NUM[m[1]]; const u = unitOf(m[2]); return n > 1 ? `every ${n} ${u}` : null; }],
  [new RegExp(`(?:every|each)\\s+(${EN_DAY}(?:(?:\\s*,\\s*|\\s+and\\s+|\\s*&\\s*)${EN_DAY})*)`),
    (t, m) => { const d = m[1].split(/\s*,\s*|\s+and\s+|\s*&\s*/).map(enDow).filter((x) => x !== null); return d.length ? `0 9 * * ${cronDows(d)}` : null; }],
  [new RegExp(`(?:кажд(?:ый|ую|ое)|по)\\s+(${RU_DAY}(?:(?:\\s*,\\s*|\\s+и\\s+)${RU_DAY})*)`),
    (t, m) => { const d = m[1].split(/\s*,\s*|\s+и\s+/).map(ruDow).filter((x) => x !== null); return d.length ? `0 9 * * ${cronDows(d)}` : null; }],
  [/(?:every week|each week|weekly|каждую неделю|еженедельно|раз в неделю)/, (t) => `0 9 * * ${t.getDay()}`],
  // monthly on a day: "every month on the 1st", "monthly on 15", "every 15th", "каждый месяц 1-го", "1-го числа каждого месяца"
  [/(?:every month|each month|monthly|каждый месяц|ежемесячно|раз в месяц)(?:\s+on)?(?:\s+the)?\s+(\d{1,2})(?:st|nd|rd|th|-?го|-?е)?(?:\s+числа)?/, (t, m) => dom(m[1])],
  [/(?:on the\s+)?(\d{1,2})(?:st|nd|rd|th)\s+of\s+(?:every|each)\s+month/, (t, m) => dom(m[1])],
  [/(?:every|each)\s+(\d{1,2})(?:st|nd|rd|th)/, (t, m) => dom(m[1])],
  [/(\d{1,2})(?:-?го|-?е)?\s+(?:числа\s+)?каждого\s+месяца/, (t, m) => dom(m[1])],
  [/(?:every month|each month|monthly|каждый месяц|ежемесячно|раз в месяц)/, (t) => `0 9 ${t.getDate()} * *`],
  // yearly on a date
  [new RegExp(`(?:every year|each year|yearly|annually)(?:\\s+on)?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${EN_MONTH}`), (t, m) => ymd(m[1], enMon(m[2]))],
  [new RegExp(`(?:every year|each year|yearly|annually)(?:\\s+on)?\\s+${EN_MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?`), (t, m) => ymd(m[2], enMon(m[1]))],
  [new RegExp(`(?:every|each)\\s+${EN_MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?`), (t, m) => ymd(m[2], enMon(m[1]))],
  [new RegExp(`(?:каждый год|ежегодно|раз в год)\\s+(\\d{1,2})\\s+${RU_MONTH}`), (t, m) => ymd(m[1], ruMon(m[2]))],
  [new RegExp(`(\\d{1,2})\\s+${RU_MONTH}\\s+каждый год`), (t, m) => ymd(m[1], ruMon(m[2]))],
  [/(?:every year|each year|yearly|annually|каждый год|ежегодно|раз в год)/, (t) => `0 9 ${t.getDate()} ${t.getMonth() + 1} *`],
];
function dom(d) { const n = Number(d); return n >= 1 && n <= 31 ? `0 9 ${n} * *` : null; }
function ymd(d, mon) { const n = Number(d); return mon >= 0 && n >= 1 && n <= 31 ? `0 9 ${n} ${mon + 1} *` : null; }

// Find a repeat phrase in free text (quick add title, Repeat field). → { recurrence, due (first occurrence ≥ today), index, length } | null
export function parseRepeat(text, todayISO) {
  const t = at(todayISO);
  const low = String(text || '').toLowerCase();
  for (const [re, fn] of RULES) {
    const m = new RegExp(`${B}${re.source}${E}`).exec(low);
    if (!m) continue;
    // a bare "daily" / "weekly" … right before another word is an adjective in a title ("daily reflection", "weekly review"),
    // not a repeat; at the end, before punctuation or before on / at / a number it still is ("water plants daily", "monthly on the 1st")
    if (/^(?:daily|weekly|monthly|yearly|annually|weekdays)$/.test(m[0]) && /^\s+(?!(?:on|at|the|from|starting|until|till|by|in)(?![a-zа-яё]))[a-zа-яё]/.test(low.slice(m.index + m[0].length))) continue;
    const recurrence = fn(t, m);
    if (!recurrence) continue;
    const due = /^every /.test(recurrence) ? todayISO : nextRepeatDate(recurrence, iso(new Date(t.getTime() - 864e5)));
    return { recurrence, due, index: m.index, length: m[0].length };
  }
  return null;
}

// The Repeat field: words, a cron pattern or an interval. → recurrence | '' (clear) | null (not understood)
export function toRecurrence(input, todayISO) {
  const s = String(input || '').trim();
  if (!s) return '';
  if (isCron(s)) return s;
  if (/^every \d+ (days|weeks|months|years)$/.test(s)) return s;
  return parseRepeat(s, todayISO)?.recurrence ?? null;
}
export const isCron = (s) => /^\S+\s+\S+\s+[\d*?,/-]+\s+[\d*?,/-]+\s+[\d*?,/-]+$/.test(String(s).trim());

function matches(field, value, min, max) {
  if (field === '*' || field === '?') return true;
  return field.split(',').some((part) => {
    const [range, stepStr] = part.split('/');
    const step = stepStr ? Number(stepStr) : 1;
    let lo, hi;
    if (range === '*') { lo = min; hi = max; } else if (range.includes('-')) [lo, hi] = range.split('-').map(Number);
    else { lo = Number(range); hi = stepStr ? max : lo; }
    return value >= lo && value <= hi && (value - lo) % step === 0;
  });
}

// Next date strictly after `afterISO` for a cron pattern or an interval, or null.
export function nextRepeatDate(rec, afterISO) {
  const s = String(rec || '').trim();
  const iv = s.match(/^every (\d+) (days|weeks|months|years)$/);
  if (iv) {
    const d = at(afterISO), n = Number(iv[1]);
    if (iv[2] === 'days') d.setDate(d.getDate() + n);
    if (iv[2] === 'weeks') d.setDate(d.getDate() + 7 * n);
    if (iv[2] === 'months') d.setMonth(d.getMonth() + n);
    if (iv[2] === 'years') d.setFullYear(d.getFullYear() + n);
    return iso(d);
  }
  const parts = s.split(/\s+/);
  if (parts.length !== 5) return null;
  const [, , domF, mon, dowRaw] = parts;
  const dow = dowRaw.replace(/\b7\b/g, '0');
  const d = at(afterISO);
  for (let i = 0; i < 800; i++) {
    d.setDate(d.getDate() + 1);
    const domOk = matches(domF, d.getDate(), 1, 31);
    const dowOk = matches(dow, d.getDay(), 0, 6);
    const dayOk = domF !== '*' && dow !== '*' ? domOk || dowOk : domOk && dowOk; // standard cron: either may match
    if (dayOk && matches(mon, d.getMonth() + 1, 1, 12)) return iso(d);
  }
  return null;
}

const ord = (n) => `${n}${[, 'st', 'nd', 'rd'][n % 10 > 3 || Math.floor(n / 10) === 1 ? 0 : n % 10] || 'th'}`;
// recurrence → "Every Monday", "Every weekday", "Every month on the 1st", "Every 2 weeks"; unknown cron → itself.
export function describeRepeat(rec) {
  const s = String(rec || '').trim();
  if (!s) return '';
  const iv = s.match(/^every (\d+) (days|weeks|months|years)$/);
  if (iv) return `Every ${iv[1]} ${iv[2]}`;
  const p = s.split(/\s+/);
  if (p.length !== 5) return s;
  const [, , domF, mon, dow] = p;
  if (domF === '*' && mon === '*') {
    if (dow === '*') return 'Every day';
    if (dow === '1-5') return 'Every weekday';
    if (/^(0,6|6,0)$/.test(dow)) return 'Every weekend';
    if (/^[0-7](,[0-7])*$/.test(dow)) {
      const days = dow.split(',').map((x) => DOW_NAMES[Number(x) % 7]);
      return `Every ${days.length === 1 ? days[0] : days.map((x) => x.slice(0, 3)).join(', ')}`;
    }
  }
  if (/^\d+$/.test(domF) && dow === '*') {
    if (mon === '*') return `Every month on the ${ord(Number(domF))}`;
    if (/^\d+$/.test(mon)) return `Every year on ${Number(domF)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(mon) - 1]}`;
  }
  return s;
}
