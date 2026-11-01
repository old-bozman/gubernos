// Google Contacts, read-only (People API): "who is X", their email / phone / company. Includes "other contacts"
// (people the owner has emailed), which is where most addresses live. Used by the agents through gubernos-tools.
import { gfetch } from './google.js';

const API = process.env.GUBERNOS_PEOPLE_API || 'https://people.googleapis.com/v1';
const MASK = 'names,emailAddresses,phoneNumbers,organizations';
const get = (url) => gfetch('contacts', API, 'GET', url);

const shape = (p) => ({
  name: p.names?.[0]?.displayName || null,
  emails: (p.emailAddresses || []).map((e) => e.value).filter(Boolean),
  phones: (p.phoneNumbers || []).map((e) => e.value).filter(Boolean),
  org: p.organizations?.[0] ? [p.organizations[0].title, p.organizations[0].name].filter(Boolean).join(', ') : null,
});

export async function search({ query, max = 10 }) {
  const q = encodeURIComponent(String(query || '').trim());
  if (!q) return [];
  const n = Math.min(Number(max) || 10, 30);
  // AICODE-NOTE: the People API wants a warm-up search with an empty query before results are fresh; cheap, so always do it.
  await Promise.all([get(`/people:searchContacts?query=&readMask=${MASK}`).catch(() => null), get(`/otherContacts:search?query=&readMask=names,emailAddresses,phoneNumbers`).catch(() => null)]);
  const [a, b] = await Promise.all([
    get(`/people:searchContacts?query=${q}&pageSize=${n}&readMask=${MASK}`),
    get(`/otherContacts:search?query=${q}&pageSize=${n}&readMask=names,emailAddresses,phoneNumbers`).catch(() => ({ results: [] })),
  ]);
  const seen = new Set(), out = [];
  for (const r of [...(a.results || []), ...(b.results || [])]) {
    const c = shape(r.person || {});
    const key = c.emails[0] || c.name;
    if (!key || seen.has(key)) continue;
    seen.add(key); out.push(c);
  }
  return out.slice(0, n);
}
