#!/usr/bin/env node
// Builds the offline bundle the iOS app ships: the web app (public/), the vault-only core (lib/), the shims (local/)
// and the browser build of `yaml`, with index.html → local.html that boots through local/boot.js.
//   node scripts/build-local.mjs OUT_DIR [--mock VAULT_DIR]
// --mock: a test page that reads VAULT_DIR from vault.json instead of the native bridge (writes are logged, not saved).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const [out, ...rest] = process.argv.slice(2);
if (!out) { console.error('usage: build-local.mjs OUT_DIR [--mock VAULT_DIR]'); process.exit(2); }
const mock = rest[0] === '--mock' ? rest[1] : null;
const CORE = ['core-routes.js', 'vault.js', 'model.js', 'review.js', 'config.js', 'settings.js', 'pomodoros.js', 'cron.js', 'dates.js', 'commitments.js', 'reflection.js', 'daily.js', 'habits.js', 'clock.js', 'macfocus.js'];

// every lib/ file a CORE file imports must be in CORE, or the offline app hangs on "Reading your system folder"
for (const f of CORE) for (const [, dep] of fs.readFileSync(path.join(ROOT, 'lib', f), 'utf8').matchAll(/from '\.\/([\w-]+\.js)'/g)) {
  if (!CORE.includes(dep)) { console.error(`build-local: lib/${f} imports ./${dep}, which is not in CORE (scripts/build-local.mjs)`); process.exit(1); }
}
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'public'), out, { recursive: true });
fs.mkdirSync(path.join(out, 'lib'), { recursive: true });
for (const f of CORE) fs.copyFileSync(path.join(ROOT, 'lib', f), path.join(out, 'lib', f));
fs.cpSync(path.join(ROOT, 'local'), path.join(out, 'local'), { recursive: true });
fs.cpSync(path.join(ROOT, 'node_modules', 'yaml', 'browser'), path.join(out, 'vendor', 'yaml'), { recursive: true }); // index.js adds the default export
fs.copyFileSync(path.join(ROOT, 'node_modules', 'yaml', 'LICENSE'), path.join(out, 'vendor', 'yaml', 'LICENSE'));

const importmap = { imports: {
  'node:fs': '/local/shims/fs.js', 'node:path': '/local/shims/path.js', 'node:child_process': '/local/shims/child_process.js',
  yaml: '/vendor/yaml/index.js',
  '/public/recur.js': '/recur.js', // lib/cron.js imports ../public/recur.js; in the bundle public/ is the root
} };
let html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8')
  .replace('<link rel="manifest" href="/manifest.webmanifest">', '')
  .replace('<link rel="stylesheet" href="/app.css">', `<link rel="stylesheet" href="/app.css">\n  <script type="importmap">${JSON.stringify(importmap)}</script>`)
  .replace('<script type="module" src="/app.js"></script>', `${mock ? '<script src="/mock-bridge.js"></script>\n  ' : ''}<script type="module" src="/local/boot.js"></script>`);
fs.writeFileSync(path.join(out, 'local.html'), html);

// the starter kit (kit/vault + kit/dirs.json) as one file: the iPhone app creates a new vault from it with no Mac
// (gubernos-ios VaultStore.createSystem); text files only, VAULT_ROOT/ → the vault root, like kit.mjs without an Obsidian subfolder
const kit = { dirs: JSON.parse(fs.readFileSync(path.join(ROOT, 'kit', 'dirs.json'), 'utf8')), files: {} };
const walkKit = (rel = '') => {
  for (const e of fs.readdirSync(path.join(ROOT, 'kit', 'vault', rel), { withFileTypes: true })) {
    if (e.name === '.DS_Store') continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walkKit(r); else kit.files[r] = fs.readFileSync(path.join(ROOT, 'kit', 'vault', r), 'utf8').replaceAll('VAULT_ROOT/', '');
  }
};
walkKit();
fs.writeFileSync(path.join(out, 'kit.json'), JSON.stringify(kit));

if (mock) {
  const vault = {};
  const walk = (dir, rel = '') => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (e.name.endsWith('.md')) vault[r] = { text: fs.readFileSync(path.join(dir, e.name), 'utf8'), mtime: fs.statSync(path.join(dir, e.name)).mtimeMs };
    }
  };
  walk(path.resolve(mock));
  fs.writeFileSync(path.join(out, 'vault.json'), JSON.stringify({ vault, data: {}, config: null }));
  // /data writes survive a reload (localStorage), like the app's own files on the phone; vault writes are only logged
  fs.writeFileSync(path.join(out, 'mock-bridge.js'), `window.gubernosWrites = [];
window.gubernosMockBridge = { call: async (m) => {
  if (m.op === 'load') { const b = await (await fetch('/vault.json')).json(); b.data = JSON.parse(localStorage.getItem('gubernos-data') || '{}'); return b; }
  window.gubernosWrites.push(m);
  if (m.op === 'write' && m.path.startsWith('/data/')) { const d = JSON.parse(localStorage.getItem('gubernos-data') || '{}'); d[m.path.slice(6)] = m.text; localStorage.setItem('gubernos-data', JSON.stringify(d)); }
  return { ok: true };
} };\n`);
}
console.log(`built ${out}${mock ? ` (mock vault: ${Object.keys(JSON.parse(fs.readFileSync(path.join(out, 'vault.json'))).vault).length} files)` : ''}`);
