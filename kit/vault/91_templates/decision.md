<%*
const title = await tp.system.prompt("Question");
const slug = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-');
await tp.file.move("VAULT_ROOT/05_model/decisions/" + slug);
-%>
---
type: decision
status: open
about: []
owner: me
decide_by:
review_at:
reversible:
provenance: stated
---

# <% title %>

## Options

-

## Criteria

## Missing info

## Recommendation

## Default if not decided

## Decision
