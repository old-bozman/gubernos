---
type: view
---

# Urgent

```dataviewjs
dv.table(["Task", "Project", "Due", "Deadline", "Assigned"],
  dv.pages('"VAULT_ROOT/10_tasks"')
    .where(p => p.status === "new" && p.priority === "urgent")
    .sort(p => p.due)
    .map(p => [dv.fileLink(p.file.path.slice(0, -3), false, p.title ?? p.file.name), p.project, p.due, p.deadline, p.assigned])
)
```
