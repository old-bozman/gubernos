---
type: view
---

# Agent Tasks

Tasks assigned to agents.

```dataviewjs
dv.table(["Task", "Priority", "Project", "Due", "Status"],
  dv.pages('"VAULT_ROOT/10_tasks"')
    .where(p => p.assigned === "agent" && p.status !== "done")
    .sort(p => p.priority)
    .map(p => [dv.fileLink(p.file.path.slice(0, -3), false, p.title ?? p.file.name), p.priority, p.project, p.due, p.status])
)
```
