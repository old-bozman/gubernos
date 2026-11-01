---
type: view
---

# Goals

```dataviewjs
dv.table(["Goal", "Status", "Active Projects", "Total Projects"],
  dv.pages('"VAULT_ROOT/30_goals"')
    .where(p => p.type === "goal")
    .sort(p => p.status)
    .map(p => {
      const projects = dv.pages('"VAULT_ROOT/20_projects"').where(q => q.goal?.path === p.file.path);
      const active = projects.where(q => q.status === "active").length;
      const total = projects.length;
      return [dv.fileLink(p.file.path.slice(0, -3), false, p.file.name), p.status, active, total];
    })
)
```
