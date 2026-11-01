# Live personal model tree

This diagram reads the current canon whenever Dataview refreshes. It includes active responsibilities, commitments, wants (latent and active), goals, issues and projects, but no tasks, decisions, people or archived records. Arrows show **only explicit** `serves` and `goal` links. Unlinked nodes remain visible. A node can have several parents.


```dataviewjs
const sources = [
  ["responsibility", '"VAULT_ROOT/05_model/responsibilities"', new Set(["active"])],
  ["commitment", '"VAULT_ROOT/05_model/commitments"', new Set(["active"])],
  ["want", '"VAULT_ROOT/05_model/wants"', new Set(["latent", "active"])],
  ["goal", '"VAULT_ROOT/30_goals"', new Set(["active"])],
  ["issue", '"VAULT_ROOT/05_model/issues"', new Set(["open"])],
  ["project", '"VAULT_ROOT/20_projects"', new Set(["active"])],
];
const rows = sources.flatMap(([kind, folder, statuses]) =>
  dv.pages(folder).array()
    .filter(p => p.type === kind && statuses.has(String(p.status)))
    .map(p => ({kind, page: p}))
);
rows.sort((a, b) => a.kind.localeCompare(b.kind) || a.page.file.name.localeCompare(b.page.file.name));
const slug = value => {
  if (!value) return null;
  const raw = typeof value === "object" ? value.path : String(value);
  return raw.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0]
    .split("/").pop().replace(/\.md$/, "");
};
const titles = rows.map(({page}) => {
  const file = app.vault.getAbstractFileByPath(page.file.path);
  const headings = file && app.metadataCache.getFileCache(file)?.headings;
  return headings?.find(h => h.level === 1)?.heading || page.file.name.replace(/-/g, " ");
});
const escapeLabel = s => String(s).replace(/["<>]/g, "").replace(/[\r\n]+/g, " ");
const bySlug = new Map(rows.map((row, i) => [row.page.file.name, `N${i}`]));
const diagram = ["flowchart LR"];
rows.forEach(({kind, page}, i) => {
  const state = kind === "want" ? ` · ${page.status}` : "";
  diagram.push(`N${i}["${escapeLabel(titles[i])}<br/>${kind.toUpperCase()}${state}"]:::${kind}`);
});
const links = [];
for (const [i, {kind, page}] of rows.entries()) {
  const parents = page.serves ? dv.array(page.serves).array() : [];
  for (const ref of parents) {
    const parent = bySlug.get(slug(ref));
    if (parent) links.push(`${parent} -->|serves| N${i}`);
  }
  if (kind === "project" && page.goal) {
    const parent = bySlug.get(slug(page.goal));
    if (parent) links.push(`${parent} -->|goal| N${i}`);
  }
}
diagram.push(...new Set(links));
diagram.push(
  "classDef responsibility fill:#3a7b9e,color:#fff,stroke:#20506a",
  "classDef commitment fill:#aa6c39,color:#fff,stroke:#714122",
  "classDef want fill:#9672aa,color:#fff,stroke:#60456d",
  "classDef goal fill:#367d57,color:#fff,stroke:#235439",
  "classDef issue fill:#a95151,color:#fff,stroke:#733636",
  "classDef project fill:#526caa,color:#fff,stroke:#354675"
);
dv.paragraph(["~~~mermaid", ...diagram, "~~~"].join("\n"));
dv.paragraph(`${rows.length} active model/project cards · ${new Set(links).size} explicit links. Click a note in the list below to edit its canon record.`);
dv.table(["Type", "Canon note"], rows.map(({kind, page}) => [kind, page.file.link]));
```
