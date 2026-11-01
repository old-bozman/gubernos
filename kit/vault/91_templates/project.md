<%*
const cats = app.metadataCache.getFileCache(app.vault.getAbstractFileByPath("VAULT_ROOT/profile.md"))?.frontmatter?.categories ?? ["energy", "work", "love", "home", "finance"];
const title = await tp.system.prompt("Title");
const category = await tp.system.suggester(cats, cats);
const description = await tp.system.prompt("Description", "", true);
const slug = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-');
await tp.file.move("VAULT_ROOT/20_projects/" + slug);
-%>
---
type: project
status: active
goal:
serves: []
category: <% category %>
due:
deadline:
---

# <% title %>

<% description %>

## Outcome

What does done look like?

## Tasks

```dataview
LIST
FROM "VAULT_ROOT/10_tasks"
WHERE project = this.file.link AND status = "new"
SORT priority ASC
```
