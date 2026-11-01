---
type: view
---

# Tasks Kanban

Live view from frontmatter (`status` field). Cards are sorted by priority within each column. "Done" shows the last 30 days only.

```dataviewjs
const board = dv.container.createEl("div");
board.style.display = "grid";
board.style.gridTemplateColumns = "repeat(3, minmax(0, 1fr))";
board.style.gap = "1rem";
board.style.alignItems = "start";

const priorityRank = { urgent: 0, planned: 1, someday: 2 };
const priorityIcon = { urgent: "🔴", planned: "🟡", someday: "⚪" };

const colDef = [
  { key: "new",  label: "📥 New"      },
  { key: "wait", label: "⏸ Waiting"  },
  { key: "done", label: "✅ Done (30d)" },
];

const allTasks = dv.pages('"VAULT_ROOT/10_tasks"').where(t => t.type === "task");
const cutoff = dv.date("today").minus({ days: 30 });

function projectShort(t) {
  if (!t.project) return null;
  if (t.project.path) return t.project.path.split("/").pop().replace(".md", "");
  return String(t.project);
}

for (const { key, label } of colDef) {
  const col = board.createEl("div");
  col.style.background = "var(--background-secondary)";
  col.style.borderRadius = "8px";
  col.style.padding = "0.6rem 0.8rem";

  let items = allTasks.where(t => t.status === key);
  if (key === "done") {
    items = items.where(t => t.file.mtime && t.file.mtime >= cutoff);
    items = items.sort(t => t.file.mtime, "desc");
  } else {
    items = items.sort(t => [
      priorityRank[t.priority] ?? 9,
      t.due ?? "9999-12-31"
    ]);
  }

  col.createEl("h3", { text: `${label} · ${items.length}` })
     .style.marginTop = "0";

  const ul = col.createEl("ul");
  ul.style.paddingLeft = "1.1rem";
  ul.style.margin = "0";

  for (const t of items) {
    const li = ul.createEl("li");
    li.style.marginBottom = "0.35rem";

    const icon = priorityIcon[t.priority] ?? "";
    if (icon) {
      const sp = li.createEl("span", { text: icon + " " });
    }
    li.createEl("a", {
      cls: "internal-link",
      text: t.title ?? t.file.name,
      attr: { "data-href": t.file.path, "href": t.file.path }
    });

    const meta = [];
    const proj = projectShort(t);
    if (proj) meta.push(`📁 ${proj}`);
    if (t.due) meta.push(`📅 ${t.due}`);
    if (t.deadline) meta.push(`⏰ ${t.deadline}`);
    if (t.assigned && t.assigned !== "me") meta.push(`👤 ${t.assigned}`);

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
