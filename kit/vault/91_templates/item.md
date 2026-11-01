<%*
const title = await tp.system.prompt("Title");
const source = await tp.system.suggester(["manual", "mail", "telegram", "meeting", "agent"], ["manual", "mail", "telegram", "meeting", "agent"]);
const content = await tp.system.prompt("Content", "", true);
const slug = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-');
const filename = tp.date.now("YYYYMMDD") + "-" + tp.date.now("HHmmss") + "-" + slug;
await tp.file.move("VAULT_ROOT/01_inbox/" + filename);
-%>
---
type: item
source: <% source %>
status: inbox
date: <% tp.date.now("YYYY-MM-DD") %>
sender:
suggestion:
---

# <% title %>

<% content %>

## Agent note

