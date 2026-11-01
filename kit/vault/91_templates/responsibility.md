<%*
const cats = app.metadataCache.getFileCache(app.vault.getAbstractFileByPath("VAULT_ROOT/profile.md"))?.frontmatter?.categories ?? ["energy", "work", "love", "home", "finance"];
const title = await tp.system.prompt("Area");
const category = await tp.system.suggester(cats, cats);
const description = await tp.system.prompt("What 'well kept' means", "", true);
const slug = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-');
await tp.file.move("VAULT_ROOT/05_model/responsibilities/" + slug);
-%>
---
type: responsibility
status: active
category: <% category %>
provenance: stated
---

# <% title %>

<% description %>

## Commitments

```dataview
LIST
FROM "VAULT_ROOT/05_model/commitments"
WHERE contains(serves, this.file.link) AND status = "active"
```

## Wants and goals

```dataview
LIST status
FROM "VAULT_ROOT/05_model/wants" OR "VAULT_ROOT/30_goals"
WHERE contains(serves, this.file.link) AND status != "abandoned"
```

## Projects

```dataview
LIST
FROM "VAULT_ROOT/20_projects"
WHERE contains(serves, this.file.link) AND status = "active"
```
