<%*
const title = await tp.system.prompt("Issue");
const description = await tp.system.prompt("What is wrong", "", true);
const slug = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-');
await tp.file.move("VAULT_ROOT/05_model/issues/" + slug);
-%>
---
type: issue
status: open
serves: []
attention_at:
provenance: stated
---

# <% title %>

<% description %>

## What we know

## Next step

## Decisions
