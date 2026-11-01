---
type: view
---

# Commitments

Active obligations from `05_model/commitments/`. ⏳ = the attention date has come.

```dataviewjs
const iso = d => d ? (d.toISODate ? d.toISODate() : String(d)) : "";
const today = dv.date("today");
dv.table(["Commitment", "Serves", "Recurrence", "Deadline", "Attention", ""],
  dv.pages('"VAULT_ROOT/05_model/commitments"')
    .where(p => p.type === "commitment" && p.status === "active")
    .sort(p => iso(p.attention_at) || iso(p.deadline) || "9999")
    .map(p => [p.file.link, p.serves, p.recurrence, iso(p.deadline), iso(p.attention_at),
               (p.attention_at && p.attention_at <= today) ? "⏳" : ""])
)
```
