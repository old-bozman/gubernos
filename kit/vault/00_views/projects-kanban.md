---
type: view
---
pltkf
# Projects Kanban

Live view from frontmatter (`status` field). Click a card to open the project. To move a card → edit the project's `status` (or finish it in Gubernos).

```dataviewjs
const board = dv.container.createEl("div");
board.style.display = "grid";
board.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
board.style.gap = "1rem";
board.style.alignItems = "start";

const colDef = [
  { key: "active", label: "🟢 Active" },
  { key: "done",   label: "✅ Done"   },
];

const projects = dv.pages('"VAULT_ROOT/20_projects"').where(p => p.type === "project");

for (const { key, label } of colDef) {
  const col = board.createEl("div");
  col.style.background = "var(--background-secondary)";
  col.style.borderRadius = "8px";
  col.style.padding = "0.6rem 0.8rem";

  const items = projects.where(p => p.status === key)
    .sort(p => p.deadline ?? p.due ?? "9999-12-31");

  col.createEl("h3", { text: `${label} · ${items.length}` })
     .style.marginTop = "0";

  const ul = col.createEl("ul");
  ul.style.paddingLeft = "1.1rem";
  ul.style.margin = "0";

  for (const p of items) {
    const openTasks = dv.pages('"VAULT_ROOT/10_tasks"')
      .where(t => t.project?.path === p.file.path && t.status !== "done")
      .length;

    const li = ul.createEl("li");
    li.style.marginBottom = "0.35rem";
    li.createEl("a", {
      cls: "internal-link",
      text: p.file.name,
      attr: { "data-href": p.file.path, "href": p.file.path }
    });

    const meta = [];
    if (p.category) meta.push(p.category);
    if (p.goal) meta.push(`→ ${p.goal.path ? p.goal.path.split("/").pop().replace(".md","") : p.goal}`);
    if (p.deadline) meta.push(`⏰ ${p.deadline}`);
    else if (p.due) meta.push(`📅 ${p.due}`);
    if (openTasks > 0) meta.push(`${openTasks} open`);
    if (p.shared) meta.push("shared");

    if (meta.length) {
      const small = li.createEl("div");
      small.style.fontSize = "0.78rem";
      small.style.color = "var(--text-muted)";
      small.textContent = meta.join(" · ");
    }
  }

  if (items.length === 0) {
    const empty = col.createEl("div");
    empty.style.color = "var(--text-faint)";
    empty.style.fontStyle = "italic";
    empty.textContent = "—";
  }
}
```
