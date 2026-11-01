---
type: view
---

# Overdue

```dataviewjs
dv.table(["Task", "Priority", "Project", "Due", "Assigned"],
  dv.pages('"VAULT_ROOT/10_tasks"')
    .where(p => p.status === "new" && p.due && p.due < dv.date("today"))
    .sort(p => p.due)
    .map(p => [dv.fileLink(p.file.path.slice(0, -3), false, p.title ?? p.file.name), p.priority, p.project, p.due, p.assigned])
)
```
