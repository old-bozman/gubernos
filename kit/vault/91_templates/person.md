<%*
const title = await tp.system.prompt("Name");
const relationship = await tp.system.prompt("Relationship");
const slug = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-');
await tp.file.move("VAULT_ROOT/05_model/people/" + slug);
-%>
---
type: person
relationship: <% relationship %>
birthday:
provenance: stated
---

# <% title %>

One short paragraph: who this is to you, current situation.

## State

## Open threads

## See also

---

## Timeline
