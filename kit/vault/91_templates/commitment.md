<%*
const title = await tp.system.prompt("Commitment");
const description = await tp.system.prompt("The obligation: where it comes from, what 'met' means", "", true);
const slug = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-');
await tp.file.move("VAULT_ROOT/05_model/commitments/" + slug);
-%>
---
type: commitment
status: active
serves: []
to:
deadline:
recurrence:
attention_at:
provenance: stated
---

# <% title %>

<% description %>

## Tasks

```dataview
LIST
FROM "VAULT_ROOT/10_tasks"
WHERE project = this.file.link AND status != "done"
```

## Decisions
