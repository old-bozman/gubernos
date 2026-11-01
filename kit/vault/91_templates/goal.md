<%*
const title = await tp.system.prompt("Title");
const description = await tp.system.prompt("Description", "", true);
const slug = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-');
await tp.file.move("VAULT_ROOT/30_goals/" + slug);
-%>
---
type: goal
status: active
serves: []
horizon:
---

# <% title %>

<% description %>

## Success condition

## Projects

```dataview
LIST
FROM "VAULT_ROOT/20_projects"
WHERE goal = this.file.link AND status = "active"
```
