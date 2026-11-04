// The phone's own copy of the vault, for a vault that isn't in iCloud (gubernos-ios Gubernos/Mirror.swift): the iPhone
// pulls it whenever it reaches the Mac and runs offline from it (local/boot.js), as it does from an iCloud folder.
//   GET /api/mirror?since=<ms>  → {now, files: {relPath: {text, mtime}} changed after `since`, paths: [every mirrored .md]}
// Mirrored: every .md file outside dot folders and 80_archive/ (history the phone doesn't need; ~1 MB for a busy vault).
// A file counts as changed by the later of mtime and ctime, so one moved in (mtime kept, ctime new) comes too.
// Unreadable files (an iCloud placeholder) are left out of `files` until they read; the phone keeps its copy meanwhile.
import fs from 'node:fs';
import path from 'node:path';
import { VAULT } from './config.js';

const SKIP_TOP = new Set(['80_archive']);

function walk(dir, rel, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!(rel === '' && SKIP_TOP.has(e.name))) walk(path.join(dir, e.name), r, out); } else if (e.name.endsWith('.md')) out.push(r);
  }
}

export function mirror(since = 0, root = VAULT) {
  const paths = [], files = {};
  walk(root, '', paths);
  for (const r of paths) {
    const f = path.join(root, r);
    try {
      const st = fs.statSync(f), changed = Math.max(st.mtimeMs, st.ctimeMs);
      if (changed > since) files[r] = { text: fs.readFileSync(f, 'utf8'), mtime: st.mtimeMs };
    } catch { /* gone meanwhile, or an iCloud placeholder: next pull */ }
  }
  return { now: Date.now(), files, paths };
}
