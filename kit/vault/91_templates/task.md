<%*
const title = await tp.system.prompt("Title");
const priority = await tp.system.suggester(["planned", "urgent", "someday"], ["planned", "urgent", "someday"]);
const assigned = await tp.system.suggester(["me", "agent", "someone"], ["me", "agent", "someone"]);
const description = await tp.system.prompt("Description", "", true);
const slug = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-');
const filename = tp.date.now("YYYYMMDD") + "-" + tp.date.now("HHmmss") + "-" + slug;
await tp.file.move("VAULT_ROOT/10_tasks/" + filename);
-%>
---
type: task
aliases: ["<% title %>"]
title: "<% title %>"
status: new
priority: <% priority %>
assigned: <% assigned %>
project:
due:
deadline:
reminder:
recurrence:
labels: []
source: manual
---

# <% title %>

<% description %>

## Subtasks

- [ ]
