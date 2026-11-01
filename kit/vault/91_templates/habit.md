<%*
const title = await tp.system.prompt("Habit");
const kind = await tp.system.suggester(["build", "quit"], ["build", "quit"]);
const why = await tp.system.prompt("Why: what it gives you", "", true);
const slug = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-');
await tp.file.move("VAULT_ROOT/05_model/habits/" + slug);
-%>
---
type: habit
status: active
kind: <% kind %>
protocol: null
serves: []
supports: []
target: null
unit: null
minimum: null
cue: null
keystone: null
provenance: stated
---

# <% title %>

## Why

<% why %>

## Log
