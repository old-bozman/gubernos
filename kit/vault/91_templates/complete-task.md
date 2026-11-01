<%*
const file = app.workspace.getActiveFile();
if (!file) { new Notice("No active file"); return; }

const fm = app.metadataCache.getFileCache(file)?.frontmatter;
if (!fm || fm.type !== "task") {
    new Notice("Not a task file");
    return;
}
if (fm.status === "done") {
    new Notice("Already done");
    return;
}

// Mark as done
await app.fileManager.processFrontMatter(file, (front) => {
    front.status = "done";
});

// Defer move until after Templater finishes inserting (prevents blank note creation)
const name = file.name;
setTimeout(async () => {
    await app.vault.rename(file, "VAULT_ROOT/80_archive/" + name);
    new Notice("✓ Done & archived: " + file.basename);
}, 300);
-%>
