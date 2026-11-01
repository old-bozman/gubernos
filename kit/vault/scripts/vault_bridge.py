#!/usr/bin/env python3
"""Vault bridge: pull the owner's urgent tasks from external vaults into the vault.

Contract: 40_reference/system/vault-bridge.md.

- A project in 20_projects/ with `vault: <path>` links an external vault.
- That vault keeps the owner's own actions in `<owner>-tasks.md` (or `vault_tasks:`),
  Obsidian Tasks format: `- [ ] text 📅 YYYY-MM-DD 🆔 mt-001`, sections
  ## Now / ## Next / ## Waiting / ## Done.
- Urgent = open, not Waiting/Done, and (in ## Now, or due within URGENT_DAYS, or overdue).
- Urgent lines become tasks here (source: vault, vault_ref: <vault>#<id>). Only once.
- Done wins both ways: a task here marked done closes the vault line; a vault line
  closed in the vault closes the task here. Nothing else is synced after creation.

Dry run by default. `--write` applies changes.
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TASKS = ROOT / "10_tasks"
ARCHIVE = ROOT / "80_archive"
PROJECTS = ROOT / "20_projects"


def owner_id() -> str:
    """First name from profile.md in lowercase ("Maria Lopez" → "maria"); "my" without a profile."""
    p = ROOT / "profile.md"
    m = re.search(r"^name:\s*[\"']?([^\s\"']+)", p.read_text(encoding="utf-8"), re.M) if p.exists() else None
    return m.group(1).lower() if m else "my"


DEFAULT_FILE = f"{owner_id()}-tasks.md"
URGENT_DAYS = 2

LINE_RE = re.compile(r"^(\s*)- \[( |x|X)\] (.*)$")
ID_RE = re.compile(r"🆔\s*([A-Za-z0-9_-]+)")
DUE_RE = re.compile(r"📅\s*(\d{4}-\d{2}-\d{2})")
DONE_RE = re.compile(r"✅\s*(\d{4}-\d{2}-\d{2})")
LINK_RE = re.compile(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]")


def frontmatter(text: str) -> dict[str, str]:
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    fm = {}
    for line in text[3:end].splitlines():
        m = re.match(r"^([A-Za-z_]+):\s*(.*)$", line)
        if m:
            fm[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return fm


def set_field(text: str, key: str, value: str) -> str:
    end = text.find("\n---", 3)
    head, rest = text[:end], text[end:]
    if re.search(rf"^{key}:.*$", head, flags=re.M):
        head = re.sub(rf"^{key}:.*$", f"{key}: {value}", head, count=1, flags=re.M)
    else:
        head += f"\n{key}: {value}"
    return head + rest


def clean_text(raw: str) -> str:
    t = ID_RE.sub("", raw)
    t = DUE_RE.sub("", t)
    t = DONE_RE.sub("", t)
    return re.sub(r"\s{2,}", " ", t).strip()


def plain(text: str) -> str:
    """Drop wikilinks to the other vault; they would be broken links here.

    The body of the task here lists them as context paths instead."""
    t = LINK_RE.sub(lambda m: m.group(2) or "", text)
    return re.sub(r"\s{2,}", " ", t).strip(" ;,")


def parse_vault_file(path: Path) -> list[dict]:
    items, section = [], ""
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines()):
        if line.startswith("## "):
            section = line[3:].strip().lower()
            continue
        m = LINE_RE.match(line)
        if not m:
            continue
        body = m.group(3)
        idm, duem = ID_RE.search(body), DUE_RE.search(body)
        items.append({
            "line_no": n,
            "id": idm.group(1) if idm else None,
            "due": duem.group(1) if duem else None,
            "text": clean_text(body),
            "section": section,
            "closed": m.group(2).lower() == "x" or section == "done",
        })
    return items


def linked_projects() -> list[dict]:
    out = []
    for f in sorted(PROJECTS.glob("*.md")):
        fm = frontmatter(f.read_text(encoding="utf-8"))
        if fm.get("vault") and fm.get("status", "active") == "active":
            root = Path(fm["vault"]).expanduser()
            out.append({
                "project": f.stem,
                "root": root,
                "name": root.name,
                "file": root / (fm.get("vault_tasks") or DEFAULT_FILE),
            })
    return out


def tasks_by_ref() -> dict[str, dict]:
    refs = {}
    for folder, archived in ((TASKS, False), (ARCHIVE, True)):
        for f in folder.glob("*.md"):
            text = f.read_text(encoding="utf-8")
            if "vault_ref:" not in text[:2000]:
                continue
            fm = frontmatter(text)
            if fm.get("vault_ref"):
                refs[fm["vault_ref"]] = {"path": f, "status": fm.get("status"), "archived": archived}
    return refs


def is_urgent(item: dict, today: dt.date) -> bool:
    if item["closed"] or item["section"] == "waiting":
        return False
    if item["section"] == "now":
        return True
    return bool(item["due"]) and dt.date.fromisoformat(item["due"]) <= today + dt.timedelta(days=URGENT_DAYS)


def slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s[:60].rstrip("-") or "vault-task"


def task_file_text(item: dict, vp: dict, ref: str, now: dt.datetime) -> str:
    title = plain(item["text"]).replace('"', "'")
    vault_link = "obsidian://open?" + urllib.parse.urlencode(
        {"vault": vp["name"], "file": vp["file"].stem}, quote_via=urllib.parse.quote)
    links = [m.group(1) for m in LINK_RE.finditer(item["text"])]
    context = "".join(f"\n- context in the vault: `{l}`" for l in links)
    return f"""---
type: task
aliases: ["{title}"]
title: "{title}"
status: new
priority: urgent
assigned: me
project: "[[{vp['project']}]]"
due: {item['due'] or 'null'}
deadline: null
reminder: null
recurrence: null
labels: []
source: vault
vault_ref: "{ref}"
---

# {title}

From the {vp['name']} vault, `{vp['file'].name}` · 🆔 {item['id']} · [open in Obsidian]({vault_link})
Closing this task closes the line in the vault (and the other way round).{context}

<!-- AI-NOTE: created by scripts/vault_bridge.py on {now:%Y-%m-%d}; contract in 40_reference/system/vault-bridge.md -->
"""


def close_vault_line(path: Path, line_no: int, today: dt.date) -> None:
    lines = path.read_text(encoding="utf-8").splitlines()
    line = lines.pop(line_no).replace("- [ ]", "- [x]", 1)
    if not DONE_RE.search(line):
        line += f" ✅ {today.isoformat()}"
    for i, l in enumerate(lines):
        if l.strip().lower() == "## done":
            lines.insert(i + 1, line)
            break
    else:
        lines += ["", "## Done", line]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def close_task(path: Path, now: dt.datetime) -> Path:
    text = path.read_text(encoding="utf-8")
    text = set_field(text, "status", "done")
    text = set_field(text, "completed", now.isoformat(timespec="seconds"))
    target = ARCHIVE / path.name
    target.write_text(text, encoding="utf-8")
    path.unlink()
    return target


def run(write: bool, today: dt.date) -> int:
    now = dt.datetime.now().astimezone()
    refs = tasks_by_ref()
    created, closed_here, closed_there, notes = [], [], [], []

    for vp in linked_projects():
        if not vp["file"].exists():
            notes.append(f"{vp['project']}: {vp['file']} not found")
            continue
        items = parse_vault_file(vp["file"])
        seen = set()
        # Close vault lines bottom-up so earlier line numbers stay valid.
        to_close_in_vault = []
        for it in items:
            if not it["id"]:
                if not it["closed"]:
                    notes.append(f"{vp['project']}: line without 🆔 skipped: {it['text'][:70]}")
                continue
            ref = f"{vp['name']}#{it['id']}"
            seen.add(ref)
            g = refs.get(ref)
            if g is None:
                if is_urgent(it, today):
                    created.append((vp, it, ref))
                continue
            done_here = g["status"] == "done" or g["archived"]
            if it["closed"] and not done_here:
                closed_here.append((g["path"], ref))
            elif done_here and not it["closed"]:
                to_close_in_vault.append((it, ref))
        for it, ref in sorted(to_close_in_vault, key=lambda x: -x[0]["line_no"]):
            closed_there.append((vp["file"], it, ref))
        for ref, g in refs.items():
            if ref.startswith(vp["name"] + "#") and ref not in seen and not g["archived"]:
                notes.append(f"{ref}: task has no line in the vault any more (left as is)")

    mode = "WRITE" if write else "DRY RUN"
    print(f"vault bridge · {mode} · {today.isoformat()}")
    for vp, it, ref in created:
        due = f" · due {it['due']}" if it["due"] else ""
        print(f"+ new task [{vp['project']}] {plain(it['text'])}{due}  ({ref}, section {it['section']})")
        if write:
            stamp = now.strftime("%Y%m%d-%H%M%S")
            path = TASKS / f"{stamp}-{slugify(plain(it['text']))}.md"
            path.write_text(task_file_text(it, vp, ref, now), encoding="utf-8")
    for path, ref in closed_here:
        print(f"✓ close task (closed in the vault): {path.name}  ({ref})")
        if write:
            close_task(path, now)
    for vfile, it, ref in closed_there:
        print(f"✓ close vault line (done here): {it['text'][:80]}  ({ref})")
        if write:
            close_vault_line(vfile, it["line_no"], today)
    for n in notes:
        print(f"! {n}")
    if not (created or closed_here or closed_there):
        print("nothing to do")
    by_project = {}
    for vp, _, _ in created:
        by_project[vp["project"]] = by_project.get(vp["project"], 0) + 1
    detail = ", ".join(f"{p} {c}" for p, c in by_project.items())
    print(f"SUMMARY: {len(created)} new urgent" + (f" ({detail})" if detail else "")
          + f", {len(closed_here) + len(closed_there)} closed")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--write", action="store_true", help="apply changes (default: dry run)")
    ap.add_argument("--today", help="override today (YYYY-MM-DD), for testing")
    a = ap.parse_args()
    today = dt.date.fromisoformat(a.today) if a.today else dt.date.today()
    return run(a.write, today)


if __name__ == "__main__":
    sys.exit(main())
