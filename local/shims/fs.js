// node:fs for the iOS offline mode: the vault and the app data live in memory (handed over by the native shell at
// start); writes go to memory at once and to disk through the shell (onWrite). The synchronous API the core uses is
// kept, so lib/*.js runs unchanged.
// Writes go straight to the phone's iCloud copy of the vault: boot.js refreshes the files changed elsewhere right before
// each change, so an edit applies to the fresh text (like the server). Every write/move returns the shell's promise
// (vfs.capture collects them per request; a failed one sends that request to the Mac's queue instead).
//   mode 'memory' — only re-applying queued requests at start: changes stay in this in-memory copy.
const files = new Map(); // abs path → { text, mtime }
const dirs = new Set(['/']);
const norm = (p) => `/${String(p).split('/').filter(Boolean).join('/')}`;
const parent = (p) => norm(p).split('/').slice(0, -1).join('/') || '/';
const addDirs = (p) => { for (let d = parent(p); d !== '/'; d = parent(d)) dirs.add(d); dirs.add('/'); };
const err = (code, msg) => Object.assign(new Error(msg), { code, status: code === 'ENOENT' ? 404 : 409 });
const recent = new Set(); // written on this phone, maybe not visible to a refresh yet
// AICODE-NOTE: changed here but not on disk (a write still going, or refused: the day's file, a stale base → the Mac's
// queue; or re-applied from the queue at start): a refresh never replaces or drops these — the phone's copy is the one
// with the change. (2026-10-15: offline check-ins made today's file only in memory; set #1 a minute later refreshed,
// the file wasn't on disk, and the check-ins vanished from the screen.)
const unsaved = new Map(); // abs path → writes not yet on disk (Infinity: refused / memory only)
const track = (pr, p) => {
  recent.add(p);
  unsaved.set(p, (unsaved.get(p) || 0) + 1);
  const done = Promise.resolve(pr).then(() => { const n = unsaved.get(p) - 1; if (n > 0) unsaved.set(p, n); else unsaved.delete(p); }, () => unsaved.set(p, Infinity))
    .finally(() => setTimeout(() => recent.delete(p), 60e3));
  done.catch(() => {}); vfs.capture?.push(pr); return done;
}; // a refused write is handled by boot.js (→ the Mac's queue)

export const vfs = {
  onWrite: null, // (path, text, created, base) → Promise; set by boot.js (base: the mtime of the version this edit was made on)
  load(root, entries = {}) { // {relative path: {text, mtime} | text}
    dirs.add(norm(root)); addDirs(`${norm(root)}/x`);
    for (const [rel, v] of Object.entries(entries)) {
      const p = norm(`${root}/${rel}`);
      files.set(p, typeof v === 'string' ? { text: v, mtime: Date.now() } : { text: v.text, mtime: v.mtime || Date.now() });
      addDirs(p);
    }
  },
  mode: 'direct',
  onMove: null, // (from, to) → Promise; set by boot.js
  capture: null, // [] while a request runs: the write/move promises it caused
  writable() {},
  persist: (p) => !(vfs.mode === 'memory' && p.startsWith('/vault/')), // memory-mode vault writes stay on the phone
  // files changed elsewhere (from the shell's refresh): update them; drop vault files no longer on disk (moved, archived)
  sync(root, changed = {}, paths = null) {
    for (const [rel, v] of Object.entries(changed)) { const p = norm(`${root}/${rel}`); if (unsaved.has(p)) continue; files.set(p, { text: v.text, mtime: v.mtime }); addDirs(p); }
    if (!paths) return;
    const keep = new Set(paths.map((rel) => norm(`${root}/${rel}`)));
    for (const p of [...files.keys()]) if (p.startsWith(`${norm(root)}/`) && p.endsWith('.md') && !keep.has(p) && !recent.has(p) && !unsaved.has(p)) files.delete(p);
  },
  files,
  unsaved,
};

function writeFileSync(p, data) {
  p = norm(p);
  const isNew = !files.has(p), base = files.get(p)?.mtime || null;
  vfs.writable(p, isNew);
  const text = String(data);
  files.set(p, { text, mtime: Date.now() });
  addDirs(p);
  if (vfs.persist(p) && vfs.onWrite) track(vfs.onWrite(p, text, isNew, base), p);
  else if (p.startsWith('/vault/')) unsaved.set(p, Infinity);
}
function readFileSync(p) {
  const f = files.get(norm(p));
  if (!f) throw err('ENOENT', `ENOENT: no such file, open '${p}'`);
  return f.text;
}
function appendFileSync(p, data) {
  p = norm(p);
  writeFileSync(p, (files.get(p)?.text || '') + String(data));
}
function existsSync(p) { p = norm(p); return files.has(p) || dirs.has(p); }
function mkdirSync(p) { p = norm(p); vfs.writable(`${p}/`, true); dirs.add(p); addDirs(`${p}/x`); }
function readdirSync(p, opts = {}) {
  p = norm(p);
  if (!dirs.has(p)) throw err('ENOENT', `ENOENT: no such directory, scandir '${p}'`);
  const pre = p === '/' ? '/' : `${p}/`, out = new Set();
  for (const k of [...files.keys(), ...dirs]) if (k.startsWith(pre) && k.length > pre.length) out.add(k.slice(pre.length).split('/')[0]);
  const names = [...out].sort();
  if (!opts.withFileTypes) return names;
  return names.map((name) => { const full = `${pre}${name}`, file = files.has(full); return { name, isDirectory: () => !file, isFile: () => file }; });
}
function statSync(p) {
  p = norm(p);
  const f = files.get(p);
  if (!f && !dirs.has(p)) throw err('ENOENT', `ENOENT: no such file, stat '${p}'`);
  return { mtimeMs: f?.mtime || 0, size: f?.text.length || 0, isDirectory: () => !f, isFile: () => !!f };
}
function renameSync(a, b) {
  a = norm(a); b = norm(b);
  const f = files.get(a);
  if (!f) throw err('ENOENT', `ENOENT: no such file, rename '${a}'`);
  files.delete(a); files.set(b, f); addDirs(b);
  if (unsaved.has(a)) { unsaved.set(b, unsaved.get(a)); unsaved.delete(a); }
  if (vfs.persist(a) && vfs.onMove) track(vfs.onMove(a, b), b);
  else if (b.startsWith('/vault/')) unsaved.set(b, Infinity);
}
function unlinkSync(p) { if (vfs.mode !== 'memory') throw err('EACCES', 'files are never deleted from the phone'); files.delete(norm(p)); }
const unsupported = (name) => () => { throw err('ENOTSUP', `fs.${name} is not available on the phone`); };

export default { writeFileSync, readFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, statSync, renameSync, unlinkSync,
  watch: unsupported('watch'), createReadStream: unsupported('createReadStream') };
export { writeFileSync, readFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, statSync, renameSync, unlinkSync };
