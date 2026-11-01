---
type: view
---

# This Week

```dataviewjs
const today = dv.date("today");
const nextWeek = today.plus({days: 7});
dv.table(["Task", "Priority", "Project", "Due", "Assigned"],
  dv.pages('"VAULT_ROOT/10_tasks"')
    .where(p => p.status === "new" && p.due && p.due >= today && p.due <= nextWeek)
    .sort(p => p.due)
    .map(p => [dv.fileLink(p.file.path.slice(0, -3), false, p.title ?? p.file.name), p.priority, p.project, p.due, p.assigned])
)
```
