// Attachments: files from the phone/desktop saved into the vault and linked from a task or project.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { VAULT, DIRS, findTaskFile, readDoc, writeDoc, appendToSection, httpError, slugify, localDate } from './vault.js';

export const ATT_DIR = path.join(VAULT, '40_reference', 'attachments');
const IMG = /\.(png|jpe?g|gif|webp|heic|heif)$/i;
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.heic': 'image/heic', '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv' };

function uniqueName(dir, original) {
  const ext = (path.extname(original) || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 8);
  const base = slugify(path.basename(original, path.extname(original))).slice(0, 50) || 'file';
  const stamp = localDate().replace(/-/g, '');
  let name = `${stamp}-${base}${ext}`, n = 2;
  while (fs.existsSync(path.join(dir, name))) name = `${stamp}-${base}-${n++}${ext}`;
  return name;
}

// Insert "- ![[name]]" (images) / "- [[name]]" under "## Attachments" of a task or project file.
function linkInto(file, name) {
  const { doc, body } = readDoc(file);
  writeDoc(file, doc, appendToSection(body, 'Attachments', [`- ${IMG.test(name) ? '!' : ''}[[${name}]]`]));
}

// AICODE-NOTE: iPhone photos can arrive as HEIC, which Claude can't read and most browsers can't show → JPEG (macOS sips).
export function heicToJpeg(file) {
  if (!/\.hei[cf]$/i.test(file)) return file;
  const jpg = file.replace(/\.hei[cf]$/i, '.jpg');
  try {
    execFileSync('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85', '-Z', '2400', file, '--out', jpg], { stdio: 'ignore', timeout: 30000 });
    fs.unlinkSync(file);
    return jpg;
  } catch { return file; }
}

export function saveAttachment(buffer, { name = 'file', taskId = null, project = null } = {}) {
  if (!buffer?.length) throw httpError(400, 'empty file');
  const dir = path.join(ATT_DIR, localDate().slice(0, 7));
  fs.mkdirSync(dir, { recursive: true });
  let fname = uniqueName(dir, name);
  fs.writeFileSync(path.join(dir, fname), buffer);
  fname = path.basename(heicToJpeg(path.join(dir, fname)));
  if (taskId) linkInto(findTaskFile(taskId).file, fname);
  else if (project) {
    const f = path.join(DIRS.projects, `${project}.md`);
    if (fs.existsSync(f)) linkInto(f, fname);
  }
  const rel = path.relative(VAULT, path.join(dir, fname));
  return { name: fname, path: rel, url: `/api/attachment/${encodeURIComponent(rel)}`, image: IMG.test(fname) };
}

// Serve only files inside 40_reference/attachments.
export function attachmentFile(rel) {
  const abs = path.resolve(VAULT, decodeURIComponent(rel));
  if (!abs.startsWith(ATT_DIR + path.sep) || !fs.existsSync(abs)) throw httpError(404, 'not found');
  return { abs, type: TYPES[path.extname(abs).toLowerCase()] || 'application/octet-stream' };
}

// Find an attachment by its file name (chat history stores [[name]]).
export function attachmentByName(name) {
  if (!fs.existsSync(ATT_DIR)) return null;
  for (const month of fs.readdirSync(ATT_DIR)) {
    const f = path.join(ATT_DIR, month, name);
    if (fs.existsSync(f)) return path.relative(VAULT, f);
  }
  return null;
}
