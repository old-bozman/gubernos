// install.sh and the vault's folder, on a fake home with curl and npm stubbed (no network). macOS ignores case in folder
// names, so ~/gubernos and ~/Gubernos are one folder, and the download replaces everything in the app's folder that isn't in
// the repo: a person's files must never end up there, and an update must never delete them if they already have.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './helpers.js';

let d, stubs;
const SHA = (c) => c.repeat(40);
function repoTar(sha) { // what GitHub would serve: a version of the app
  const src = path.join(d, `src-${sha.slice(0, 1)}`);
  fs.mkdirSync(path.join(src, 'gubernos-x/scripts'), { recursive: true });
  fs.writeFileSync(path.join(src, 'gubernos-x/.gitignore'), 'node_modules/\ndata/\n');
  const when = new Date(Date.now() - sha.charCodeAt(0) * 3600000); // GitHub's tarballs carry the commit's time: rsync needs it to see a change
  fs.writeFileSync(path.join(src, 'gubernos-x/server.js'), `// ${sha}\n`);
  fs.utimesSync(path.join(src, 'gubernos-x/server.js'), when, when);
  execFileSync('tar', ['-czf', path.join(d, 'repo.tgz'), '-C', src, 'gubernos-x']);
  fs.writeFileSync(path.join(d, 'sha'), sha);
}
const newHome = (name) => { const h = path.join(d, name); fs.mkdirSync(h); return h; };
const install = (home, ...args) => {
  const env = { ...process.env, HOME: home, PATH: `${stubs}:${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin` };
  delete env.GUBERNOS_DIR; delete env.GUBERNOS_REPO;
  return spawnSync('bash', [path.join(ROOT, 'install.sh'), ...args], { env, encoding: 'utf8' });
};
before(() => {
  d = fs.mkdtempSync(path.join(os.tmpdir(), 'gubernos-install-'));
  stubs = path.join(d, 'stubs'); fs.mkdirSync(stubs);
  fs.writeFileSync(path.join(stubs, 'curl'), `#!/bin/bash\ncase "$*" in *vnd.github.sha*) cat ${d}/sha;; *codeload*) cat ${d}/repo.tgz;; *) exit 1;; esac\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(stubs, 'npm'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
});
after(() => fs.rmSync(d, { recursive: true, force: true }));

test('a new install keeps the app apart from ~/Gubernos, and an update leaves the files alone', () => {
  const home = newHome('fresh');
  repoTar(SHA('a'));
  const r = install(home, '--update');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const app = path.join(home, '.gubernos/app');
  assert.ok(fs.existsSync(path.join(app, 'server.js')), 'the app is in ~/.gubernos/app');
  assert.ok(!fs.existsSync(path.join(home, 'gubernos')), 'nothing in ~/gubernos');
  // the person's vault next to it, then a new version of the app
  fs.mkdirSync(path.join(home, 'Gubernos/10_tasks'), { recursive: true });
  fs.writeFileSync(path.join(home, 'Gubernos/10_tasks/mine.md'), 'mine');
  fs.writeFileSync(path.join(home, 'Gubernos/profile.md'), 'me');
  repoTar(SHA('b'));
  const u = install(home, '--update');
  assert.equal(u.status, 0, u.stdout + u.stderr);
  assert.match(fs.readFileSync(path.join(app, 'server.js'), 'utf8'), /bbbb/);
  assert.equal(fs.readFileSync(path.join(home, 'Gubernos/10_tasks/mine.md'), 'utf8'), 'mine');
});

test('an install already in ~/gubernos stays there', () => {
  const home = newHome('older');
  fs.mkdirSync(path.join(home, 'gubernos'));
  fs.writeFileSync(path.join(home, 'gubernos/.gubernos-version'), `old-bozman/gubernos ${SHA('a')}\n`);
  repoTar(SHA('c'));
  const r = install(home, '--update');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(fs.readFileSync(path.join(home, 'gubernos/server.js'), 'utf8'), /cccc/);
  assert.ok(!fs.existsSync(path.join(home, '.gubernos/app')));
});

test('an update refuses a folder that also holds the person\'s files, and deletes nothing', () => {
  const home = newHome('mixed');
  const dir = path.join(home, 'gubernos');
  fs.mkdirSync(path.join(dir, '10_tasks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.gubernos-version'), `old-bozman/gubernos ${SHA('a')}\n`);
  fs.writeFileSync(path.join(dir, 'profile.md'), 'me');
  fs.writeFileSync(path.join(dir, '10_tasks/mine.md'), 'mine');
  repoTar(SHA('d'));
  const r = install(home, '--update');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /would delete/);
  assert.equal(fs.readFileSync(path.join(dir, '10_tasks/mine.md'), 'utf8'), 'mine');
  assert.ok(!fs.existsSync(path.join(dir, 'server.js')), 'the app was not unpacked over it');
});

test('setup refuses a vault in the app\'s folder, whatever the case of the name', () => {
  const home = newHome('setup');
  const app = path.join(home, 'gubernos');
  fs.mkdirSync(app);
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(app, 'scripts'), { recursive: true });
  for (const vault of ['~/gubernos', '~/Gubernos', '~/gubernos/my-files']) {
    const r = spawnSync('bash', [path.join(app, 'scripts/setup.sh'), 'install', '--vault', vault, '--name', 'Sam', '--no-launchd'], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
    assert.notEqual(r.status, 0, `${vault}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout + r.stderr, /inside the app's folder/, vault);
  }
  assert.ok(!fs.existsSync(path.join(app, 'my-files')));
});
