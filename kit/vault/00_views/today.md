---
type: view
---

# Today

```dataviewjs
dv.table(["Task", "Priority", "Project", "Assigned"],
  dv.pages('"VAULT_ROOT/10_tasks"')
    .where(p => p.status === "new" && p.due?.hasSame(dv.date("today"), "day"))
    .sort(p => p.priority)
    .map(p => [dv.fileLink(p.file.path.slice(0, -3), false, p.title ?? p.file.name), p.priority, p.project, p.assigned])
)
```
