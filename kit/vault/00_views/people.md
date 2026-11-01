---
type: view
---

# People

People in `05_model/people/`, by next birthday. The attention pass surfaces close family 21 days ahead and friends 7 days ahead (AGENTS.md → "Attention pass").

```dataviewjs
const today = dv.date("today");
const text = b => b.toISODate ? b.toISODate() : String(b);
function nextBirthday(b) {
  const s = text(b);
  const md = s.length === 5 ? s : s.slice(5, 10);
  let d = dv.date(`${today.year}-${md}`);
  if (d < today) d = dv.date(`${today.year + 1}-${md}`);
  return d;
}
const rows = dv.pages('"VAULT_ROOT/05_model/people"')
  .where(p => p.type === "person" && p.birthday)
  .map(p => {
    const next = nextBirthday(p.birthday);
    const s = text(p.birthday);
    return { p, next, days: Math.round(next.diff(today, "days").days),
             turns: s.length === 10 ? next.year - Number(s.slice(0, 4)) : "" };
  })
  .sort(r => r.days);
dv.table(["Person", "Relationship", "Birthday", "In days", "Turns"],
  rows.map(r => [r.p.file.link, r.p.relationship, r.next.toFormat("d LLL"), r.days, r.turns]));
```
