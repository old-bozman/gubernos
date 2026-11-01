#!/usr/bin/env node
// File work for scripts/setup.sh: create a vault from kit/vault, set the owner's profile, write the machine config.
// Never overwrites a file that exists — safe to run again on a vault in use.
//   node scripts/kit.mjs vault  --vault PATH [--name NAME] [--language LANG] [--obsidian-path SUB]
//   node scripts/kit.mjs config --vault PATH [--port N] [--public-url URL] [--obsidian-vault NAME] [--obsidian-path SUB] [--feedback-repo OWNER/NAME|none] [--agent-tools Bash,…|none]
//   node scripts/kit.mjs get KEY            (prints a value from ~/.config/gubernos/config.json)
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const KIT = path.join(ROOT, 'kit', 'vault');
const CONFIG_DIR = process.env.GUBERNOS_CONFIG_DIR || path.join(process.env.HOME, '.config', 'gubernos');
const CONFIG = path.join(CONFIG_DIR, 'config.json');
const DIRS = JSON.parse(fs.readFileSync(path.join(ROOT, 'kit', 'dirs.json'), 'utf8')); // the vault's folders (also the iPhone app's new-vault kit, build-local.mjs)

const [cmd, ...rest] = process.argv.slice(2);
const opt = {};
for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) opt[rest[i].slice(2)] = rest[i + 1]?.startsWith('--') || rest[i + 1] === undefined ? 'true' : rest[++i];
const expand = (p) => path.resolve(String(p).replace(/^~(?=\/|$)/, process.env.HOME));
const readConfig = () => { try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { return {}; } };

// Copy kit files that are missing; text files get VAULT_ROOT/ → the folder of this system inside its Obsidian vault.
function copyKit(dst, prefix) {
  const made = [], kept = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(KIT, rel), { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (e.name === '.DS_Store') continue;
      if (e.isDirectory()) { fs.mkdirSync(path.join(dst, r), { recursive: true }); walk(r); continue; }
      const to = path.join(dst, r);
      if (fs.existsSync(to)) { kept.push(r); continue; }
      let text = fs.readFileSync(path.join(KIT, r), 'utf8');
      text = text.replaceAll('VAULT_ROOT/', prefix);
      fs.writeFileSync(to, text);
      made.push(r);
    }
  };
  walk('');
  return { made, kept };
}

// Set top-level frontmatter keys in profile.md, keeping the rest of the file as it is.
function setProfile(file, values) {
  const text = fs.readFileSync(file, 'utf8');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) throw new Error(`${file}: no frontmatter`);
  const doc = YAML.parseDocument(m[1]);
  for (const [k, v] of Object.entries(values)) if (v !== undefined && v !== '') doc.set(k, v);
  fs.writeFileSync(file, `---\n${doc.toString().trimEnd()}\n---${text.slice(m[0].length)}`);
}

if (cmd === 'vault') {
  if (!opt.vault) throw new Error('--vault required');
  const dst = expand(opt.vault);
  const isNew = !fs.existsSync(path.join(dst, 'CLAUDE.md'));
  fs.mkdirSync(dst, { recursive: true });
  const sub = String(opt['obsidian-path'] || '').replace(/^\/+|\/+$/g, '');
  const { made, kept } = copyKit(dst, sub ? `${sub}/` : '');
  for (const d of DIRS) fs.mkdirSync(path.join(dst, d), { recursive: true });
  if (made.includes('profile.md')) setProfile(path.join(dst, 'profile.md'), { name: opt.name, language: opt.language });
  console.log(JSON.stringify({ vault: dst, new: isNew, created: made.length, kept: kept.length, keptFiles: kept.slice(0, 20) }, null, 1));
} else if (cmd === 'config') {
  const c = readConfig();
  if (opt.vault) c.vault = expand(opt.vault);
  if (opt.port) c.port = Number(opt.port);
  if (opt['public-url']) c.publicUrl = opt['public-url'] === 'none' ? null : opt['public-url'];
  if (opt['agent-tools']) c.agentTools = opt['agent-tools'] === 'none' ? [] : opt['agent-tools'].split(',').map((x) => x.trim()).filter(Boolean);
  if (opt['feedback-repo']) c.feedbackRepo = opt['feedback-repo'] === 'none' ? null : opt['feedback-repo'];
  if (opt['obsidian-vault']) c.obsidian = opt['obsidian-vault'] === 'none' ? null : { vault: opt['obsidian-vault'], path: String(opt['obsidian-path'] || '').replace(/^\/+|\/+$/g, '') };
  if (!c.vault) throw new Error('--vault required (no vault in the config yet)');
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG, `${JSON.stringify(c, null, 1)}\n`);
  console.log(JSON.stringify(c, null, 1));
} else if (cmd === 'get') {
  const v = readConfig()[rest[0]];
  // plain text (console.log may colour numbers when FORCE_COLOR is set)
  if (v !== undefined && v !== null) process.stdout.write(`${typeof v === 'object' ? JSON.stringify(v) : v}\n`);
} else {
  console.error('usage: kit.mjs vault|config|get … (see the header of this file)');
  process.exit(2);
}
