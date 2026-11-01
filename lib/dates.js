// Resolve a structured date spec against the local clock. Used by voice parsing so the
// model only says *what* was meant ("next wednesday"), never computes the calendar date.
//
// spec: { kind, n?, weekday?, week_offset?, day?, month?, year? }
//   today | tomorrow | day_after_tomorrow
//   in_days(n) | in_weeks(n) | in_months(n)
//   weekday(weekday, week_offset)   next occurrence after today, + week_offset weeks
//   next_week                       Monday of next week
//   end_of_week                     this Sunday (today if Sunday)
//   end_of_month                    last day of this month
//   absolute(day, month, year?)     year omitted → next occurrence from today

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export function resolveDateSpec(spec, now = new Date()) {
  if (!spec || typeof spec !== 'object' || !spec.kind) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const n = Number.isInteger(spec.n) && spec.n >= 0 && spec.n < 1000 ? spec.n : null;
  switch (spec.kind) {
    case 'today': return iso(today);
    case 'tomorrow': return iso(addDays(today, 1));
    case 'day_after_tomorrow': return iso(addDays(today, 2));
    case 'in_days': return n == null ? null : iso(addDays(today, n));
    case 'in_weeks': return n == null ? null : iso(addDays(today, 7 * n));
    case 'in_months': {
      if (n == null) return null;
      const d = new Date(today); const day = d.getDate();
      d.setDate(1); d.setMonth(d.getMonth() + n);
      d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
      return iso(d);
    }
    case 'weekday': {
      const w = WEEKDAYS.indexOf(String(spec.weekday || '').slice(0, 3).toLowerCase());
      if (w < 0) return null;
      const off = Number.isInteger(spec.week_offset) && spec.week_offset > 0 ? spec.week_offset : 0;
      return iso(addDays(today, (((w - today.getDay() + 7) % 7) || 7) + 7 * off));
    }
    case 'next_week': return iso(addDays(today, ((8 - today.getDay()) % 7) || 7));
    case 'end_of_week': return iso(addDays(today, (7 - today.getDay()) % 7));
    case 'end_of_month': return iso(new Date(today.getFullYear(), today.getMonth() + 1, 0, 12));
    case 'absolute': {
      const { day, month, year } = spec;
      if (!Number.isInteger(day) || !Number.isInteger(month) || month < 1 || month > 12 || day < 1) return null;
      let y = Number.isInteger(year) ? year : today.getFullYear();
      let d = new Date(y, month - 1, day, 12);
      if (d.getMonth() !== month - 1) return null; // e.g. 31 Feb
      if (!Number.isInteger(year) && d < today) { y += 1; d = new Date(y, month - 1, day, 12); }
      return iso(d);
    }
    default: return null;
  }
}

export const DATE_SPEC_SCHEMA = {
  type: ['object', 'null'],
  required: ['kind'],
  properties: {
    kind: { enum: ['today', 'tomorrow', 'day_after_tomorrow', 'in_days', 'in_weeks', 'in_months', 'weekday', 'next_week', 'end_of_week', 'end_of_month', 'absolute'] },
    n: { type: ['integer', 'null'] },
    weekday: { enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', null] },
    week_offset: { type: ['integer', 'null'] },
    day: { type: ['integer', 'null'] },
    month: { type: ['integer', 'null'] },
    year: { type: ['integer', 'null'] },
  },
};
