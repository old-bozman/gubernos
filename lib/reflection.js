// Daily reflection: three short answers at the end of the day (the Wins screen's daily sibling of the Weekly review).
// Its sections live in the day's file, 50_reviews/daily/YYYY-MM-DD.md (lib/daily.js), next to the plan and the habit
// check-ins; the Weekly review reads the week's ones. Two formats: E-S-P journaling (Effort, Success, Progress) and a plain journal.
import path from 'node:path';
import { VAULT, localDate, httpError } from './vault.js';
import * as Daily from './daily.js';
import * as Habits from './habits.js';

export const FORMATS = {
  esp: [
    ['effort', 'Effort', 'Your moment of honest, hard work today — what you could control and the energy you put in.'],
    ['success', 'Success', 'A moment you got something right, however small.'],
    ['progress', 'Progress', 'How you got better compared to past attempts.'],
  ],
  journal: [
    ['well', 'What went well', ''],
    ['needs', 'What needs work', ''],
    ['tomorrow', 'What to improve tomorrow', ''],
  ],
};
const HEADINGS = new Set(Object.values(FORMATS).flat().map(([, h]) => h.toLowerCase()));
// Three thank-yous: who and what the owner is grateful for today (after Three Good Things, Seligman 2005): up to three numbered lines, "· because …" optional, in their own
// section after the answers — any format, and it stays when the format changes. Design: 40_reference/personal-os/
// gratitude-in-daily-reflection.md.
const GRATITUDE = 'Gratitude';
const gratitudeOf = (sections) => (sections.find((s) => s.heading.toLowerCase() === 'gratitude')?.text || '')
  .split('\n').map((l) => l.replace(/^\s*(?:\d+[.)]|[-*])\s*/, '').trim()).filter(Boolean).slice(0, 3);

// The day's reflection: {date, format, answers {key: text}, gratitude [lines], exists, file}
export function getReflection(date = localDate()) {
  const body = Daily.readText(Daily.checkDate(date));
  const file = path.relative(VAULT, Daily.fileOf(date));
  // a day file holding only the plan or habits has no reflection yet
  const { head, sections } = Daily.split(body || '');
  const mine = sections.filter((s) => HEADINGS.has(s.heading.toLowerCase()));
  const gratitude = gratitudeOf(sections);
  if (!mine.length && !gratitude.length) return { date, format: null, answers: {}, gratitude: [], exists: false, file };
  const format = head.match(/<!-- format: (\w+)/)?.[1] || 'esp';
  const answers = {};
  for (const [k, h] of FORMATS[format] || FORMATS.esp) answers[k] = (mine.find((s) => s.heading.toLowerCase() === h.toLowerCase())?.text || '').trim();
  return { date, format, answers, gratitude, exists: true, file };
}

export function saveReflection({ date = localDate(), format = 'esp', answers = {}, gratitude = [] } = {}) {
  if (!FORMATS[format]) throw httpError(400, 'format must be esp or journal');
  Daily.checkDate(date);
  const items = FORMATS[format].map(([k, h]) => [h, String(answers[k] || '').trim()]);
  const thanks = (Array.isArray(gratitude) ? gratitude : []).map((x) => String(x || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 3);
  const answered = items.some(([, t]) => t);
  if (!answered && !thanks.length) throw httpError(400, 'write at least one answer');
  const marker = `<!-- format: ${format} · saved ${Daily.stamp()} (Gubernos) -->`;
  Daily.update(date, ({ head, sections }) => {
    const h = /<!-- format: [^>]*-->/.test(head) ? head.replace(/<!-- format: [^>]*-->/, marker) : `${head.replace(/\s*$/, '')}\n\n${marker}\n`;
    // the other format's answers go (switching formats replaces them); the plan, habits and anyone else's sections stay
    // only good things written: the answers saved earlier stay
    const keep = sections.filter((s) => (answered ? !HEADINGS.has(s.heading.toLowerCase()) : true) && s.heading.toLowerCase() !== 'gratitude');
    return { head: h, sections: [...keep, ...(answered ? items.map(([heading, text]) => ({ heading, text: text || '—' })) : []),
      ...(thanks.length ? [{ heading: GRATITUDE, text: thanks.map((t, i) => `${i + 1}. ${t}`).join('\n') }] : [])] };
  });
  try { Daily.closeDay(date); } catch (e) { console.warn('[daily] close', e.message); } // the evening line: plan vs actual
  try { Habits.reflectionSaved(date); } catch (e) { console.warn('[habits]', e.message); } // habits done by writing it
  return getReflection(date);
}

// The reflections of the days start..end (inclusive), for the Weekly review.
export function reflectionsBetween(start, end) {
  return Daily.datesBetween(start, end).map((d) => [d, getReflection(d)]).filter(([, r]) => r.exists).map(([d, r]) => {
    const items = (FORMATS[r.format] || FORMATS.esp).map(([k, h]) => ({ label: h, text: r.answers[k] })).filter((x) => x.text && x.text !== '—');
    if (r.gratitude.length) items.push({ label: 'Thank-yous', text: r.gratitude.join(' · ') });
    return { date: d, format: r.format, items };
  });
}
