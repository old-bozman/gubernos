---
type: view
---

# Projects

```dataviewjs
dv.table(["Project", "Status", "Goal", "Due", "Deadline", "Open Tasks"],
  dv.pages('"VAULT_ROOT/20_projects"')
    .where(p => p.type === "project")
    .sort(p => [p.status === "active" ? 0 : 1, p.deadline ?? p.due ?? "9999"])
    .map(p => {
      const openTasks = dv.pages('"VAULT_ROOT/10_tasks"')
        .where(t => t.project?.path === p.file.path && t.status !== "done")
        .length;
      return [dv.fileLink(p.file.path.slice(0, -3), false, p.file.name), p.status, p.goal, p.due, p.deadline, openTasks];
    })
)
```
