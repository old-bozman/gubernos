---
type: view
---

# No Due Date

```dataviewjs
dv.table(["Task", "Priority", "Project", "Assigned"],
  dv.pages('"VAULT_ROOT/10_tasks"')
    .where(p => p.status === "new" && !p.due)
    .sort(p => p.file.ctime, 'desc')
    .map(p => [dv.fileLink(p.file.path.slice(0, -3), false, p.title ?? p.file.name), p.priority, p.project, p.assigned])
)
```
