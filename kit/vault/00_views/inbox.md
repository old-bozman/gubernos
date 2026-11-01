---
type: view
---

# Inbox

Items from integrations and quick captures. Review and decide: task / reference / note / trash.

```dataviewjs
dv.table(["Capture", "Source", "Sender", "Suggestion", "Date"],
  dv.pages('"VAULT_ROOT/01_inbox"')
    .where(p => p.status === "inbox" && p.suggestion !== "note")
    .sort(p => p.date, "desc")
    .map(p => [dv.fileLink(p.file.path.slice(0, -3), false, p.file.name), p.source, p.sender, p.suggestion, p.date])
)
```

## Notes

Ideas parked until they become a task or project (reviewed weekly).

```dataviewjs
dv.table(["Note", "Source", "Date"],
  dv.pages('"VAULT_ROOT/01_inbox"')
    .where(p => p.status === "inbox" && p.suggestion === "note")
    .sort(p => p.date, "desc")
    .map(p => [dv.fileLink(p.file.path.slice(0, -3), false, p.file.name), p.source, p.date])
)
```
