<%*
const title = await tp.system.prompt("Protocol (e.g. AM, PM)");
const start = await tp.system.prompt("Window start (HH:MM)");
const end = await tp.system.prompt("Window end (HH:MM)");
const slug = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-');
await tp.file.move("VAULT_ROOT/05_model/protocols/" + slug);
-%>
---
type: protocol
window: { start: "<% start %>", end: "<% end %>" }
provenance: stated
---

# <% title %>

Habits in order, one per line:

- 
