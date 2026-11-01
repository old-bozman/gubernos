---
type: view
---

# Waiting

```dataviewjs
dv.table(["Task", "Priority", "Project", "Due", "Assigned"],
  dv.pages('"VAULT_ROOT/10_tasks"')
    .where(p => p.status === "wait")
    .sort(p => p.due)
    .map(p => [dv.fileLink(p.file.path.slice(0, -3), false, p.title ?? p.file.name), p.priority, p.project, p.due, p.assigned])
)
```
