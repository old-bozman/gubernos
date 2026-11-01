---
type: view
---

# Deadlines

Tasks with hard deadlines.

```dataviewjs
dv.table(["Task", "Priority", "Project", "Due", "Deadline", "Assigned"],
  dv.pages('"VAULT_ROOT/10_tasks"')
    .where(p => p.status === "new" && p.deadline)
    .sort(p => p.deadline)
    .map(p => [dv.fileLink(p.file.path.slice(0, -3), false, p.title ?? p.file.name), p.priority, p.project, p.due, p.deadline, p.assigned])
)
```
