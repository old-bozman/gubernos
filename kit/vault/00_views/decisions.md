---
type: view
---

# Decisions

The decision queue from `05_model/decisions/`. Rules: AGENTS.md → "Decision queue".

## Open and parked

```dataviewjs
const iso = d => d ? (d.toISODate ? d.toISODate() : String(d)) : "";
dv.table(["Decision", "Status", "Decide by", "Review", "About"],
  dv.pages('"VAULT_ROOT/05_model/decisions"')
    .where(p => p.type === "decision" && p.status !== "decided")
    .sort(p => (p.status === "parked" ? "1" : "0") + (iso(p.decide_by) || "9999"))
    .map(p => [p.file.link, p.status, iso(p.decide_by), iso(p.review_at), p.about])
)
```

## Recently decided

```dataviewjs
dv.table(["Decision", "About", "Recorded"],
  dv.pages('"VAULT_ROOT/80_archive/model"')
    .where(p => p.type === "decision" && p.status === "decided")
    .sort(p => p.file.mtime, "desc")
    .limit(10)
    .map(p => [p.file.link, p.about, p.file.mtime.toISODate()])
)
```
