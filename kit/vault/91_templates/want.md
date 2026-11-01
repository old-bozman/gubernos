<%*
const title = await tp.system.prompt("Want");
const description = await tp.system.prompt("Why", "", true);
const slug = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-');
await tp.file.move("VAULT_ROOT/05_model/wants/" + slug);
-%>
---
type: want
status: latent
serves: []
horizon:
review_at:
provenance: stated
---

# <% title %>

<% description %>

## What would make it a goal

## Decisions
