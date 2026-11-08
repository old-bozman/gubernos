// Import tasks (Settings → General, lib/import.js): Todoist through a stand-in API in a real browser, and an export file
// through a stand-in model. Nothing is written before Import; done tasks, tasks already there and old dates stay out; the
// token is used for the one read and kept nowhere.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startServer } from './helpers.js';
import { openPage } from './chrome.js';

const TOKEN = 'tok-import-test-123';
let api, s, dir;
const T = (id, project_id, content, extra = {}) => ({ id, project_id, content, priority: 1, checked: false, is_deleted: false, ...extra });
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gubernos-import-'));
  const data = {
    projects: [{ id: 'p0', name: 'Inbox', inbox_project: true }, { id: 'p1', name: 'House and garden' }, { id: 'p2', name: 'Side gig' }],
    sections: [],
    tasks: [T('t1', 'p0', 'Call the dentist'), T('t2', 'p1', 'Fix the gate', { priority: 4, due: { date: '2020-01-10' } }),
      T('t3', 'p1', 'Water the plants', { due: { date: '2099-01-01', is_recurring: true, string: 'every monday' } }),
      T('t4', 'p1', 'Old done one', { checked: true }), T('t5', 'p2', 'Send the invoice'), T('t6', 'p2', 'Already here')],
  };
  api = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return res.writeHead(401).end();
    const what = new URL(req.url, 'http://x').pathname.split('/').pop();
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ results: data[what] || [], next_cursor: null }));
  }).listen(0, '127.0.0.1');
  await new Promise((r) => api.once('listening', r));
  // the model for an export file: the lists, then the categories (every call is logged)
  const fake = path.join(dir, 'claude');
  fs.writeFileSync(fake, `#!/usr/bin/env node
const a = process.argv.slice(2), sys = a[a.indexOf('--system-prompt') + 1] || '';
if (a[0] === 'auth') { console.log('{"loggedIn":true}'); process.exit(0); }
require('fs').appendFileSync(${JSON.stringify(path.join(dir, 'calls'))}, sys.slice(0, 40) + '\\n');
const out = /life area/.test(sys) ? { categories: ['energy'] }
  : { lists: [{ name: 'Running', kind: 'project', items: [{ title: 'Buy shoes', due: '2099-02-02', time: '09:30' }, { title: 'Track runs', repeat: 'every 2 weeks' }, { title: 'Old race', done: true }] }] };
console.log(JSON.stringify({ structured_output: out }));
`, { mode: 0o755 });
  s = await startServer({ GUBERNOS_TODOIST_API: `http://127.0.0.1:${api.address().port}`, GUBERNOS_CLAUDE_BIN: fake });
}, { timeout: 40000 });
after(async () => { api?.close(); await s?.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

const tasks = () => fs.readdirSync(path.join(s.vault, '10_tasks')).map((f) => fs.readFileSync(path.join(s.vault, '10_tasks', f), 'utf8'));
const task = (title) => tasks().find((t) => t.includes(`title: ${title}`));
const grepAll = (root, needle) => fs.readdirSync(root, { recursive: true }).some((f) => { const p = path.join(root, f); return fs.statSync(p).isFile() && fs.readFileSync(p, 'utf8').includes(needle); });

test('Todoist: pick it, paste the token, look at each list, change where it goes, import', { timeout: 90000 }, async () => {
  assert.equal((await s.post('/api/tasks', { title: 'Already here' })).status, 200);
  const before = tasks().length;
  const page = await openPage();
  try {
    await page.goto(`${s.url}/#/settings`);
    assert.ok(await page.waitFor('!!document.querySelector("[data-act=set-import]")', 15000), 'no Import tasks in Settings');
    assert.ok(await page.eval(`(() => { const h = (t) => [...document.querySelectorAll(".settings h2.set-g")].find((x) => x.textContent === t), row = document.querySelector("[data-act=set-import]");
      return !!(h("General").compareDocumentPosition(row) & 4) && !!(row.compareDocumentPosition(h("Your day")) & 4); })()`), 'Import tasks isn’t under General');
    await page.eval('document.querySelector("[data-act=set-import]").click()');
    assert.ok(await page.waitFor('!!document.querySelector(".imp [data-src=todoist]")'), 'no Todoist to pick');
    await page.eval('document.querySelector(".imp [data-src=todoist]").click()');
    assert.ok(await page.waitFor('!!document.querySelector("#imp-token")'));
    await page.eval(`document.querySelector("#imp-token").value = ${JSON.stringify(TOKEN)}; document.querySelector("#imp-read").click()`);
    assert.ok(await page.waitFor('document.querySelectorAll(".imp-l").length > 0', 20000), await page.eval('document.querySelector(".imp")?.innerText'));
    const lists = await page.eval('[...document.querySelectorAll(".imp-l")].map((r) => [r.querySelector("b").textContent, r.querySelector(".imp-n").textContent, r.querySelector(".imp-target").value])');
    assert.deepEqual(lists, [['Inbox', '1 task', 'none'], ['House and garden', '2 tasks', 'new'], ['Side gig', '1 task', 'new']]);
    const note = await page.eval('document.querySelector(".imp .imp-note").textContent');
    assert.match(note, /1 already in/); assert.match(note, /1 past due date cleared/);
    assert.equal(tasks().length, before, 'something was written before Import');
    // House and garden → home; Side gig stays out
    await page.eval(`(() => { const r = [...document.querySelectorAll(".imp-l")]; r[1].querySelector(".imp-cat").value = "home";
      const t = r[2].querySelector(".imp-target"); t.value = "skip"; t.dispatchEvent(new Event("change")); })()`);
    assert.equal(await page.eval('document.querySelector("#imp-apply").textContent'), 'Import 3 tasks');
    await page.eval('document.querySelector("#imp-apply").click()');
    assert.ok(await page.waitFor('!document.querySelector(".imp")', 10000), 'the dialog stayed');
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); }
  assert.equal(tasks().length, before + 3);
  const proj = fs.readFileSync(path.join(s.vault, '20_projects', 'house-and-garden.md'), 'utf8');
  assert.match(proj, /category: home/);
  assert.ok(!fs.existsSync(path.join(s.vault, '20_projects', 'side-gig.md')), 'a list left out still made a project');
  assert.match(task('Fix the gate'), /project: "\[\[house-and-garden\]\]"/); assert.match(task('Fix the gate'), /due: null/); assert.match(task('Fix the gate'), /priority: urgent/);
  assert.match(task('Water the plants'), /recurrence: 0 9 \* \* 1/); assert.match(task('Water the plants'), /source: import/);
  assert.match(task('Call the dentist'), /project: null/);
  assert.ok(!task('Old done one') && !task('Send the invoice'));
  assert.equal(tasks().filter((t) => t.includes('title: Already here')).length, 1, 'a task already there came in twice');
  assert.ok(!grepAll(s.dir, TOKEN), 'the Todoist token was kept somewhere');
});

test('an export file: the model reads it, the category is its guess, plain-word repeats become real ones; a read import is applied once', { timeout: 60000 }, async () => {
  const r = await s.post('/api/import/read', { source: 'file', text: 'title,list\nBuy shoes,Running\nTrack runs,Running' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.lists.map((l) => [l.name, l.count, l.target, l.category]), [['Running', 2, 'new', 'energy']]);
  assert.equal(r.body.skipped.done, 1, 'a done item in the file isn’t counted as left out');
  const a = await s.post('/api/import/apply', { id: r.body.id, lists: [] });
  assert.deepEqual(a.body, { tasks: 2, projects: ['Running'] });
  assert.match(task('Buy shoes'), /reminder: 2099-02-02T09:30/);
  assert.match(task('Track runs'), /recurrence: every 2 weeks/);
  assert.ok(!task('Old race'), 'a done item came in');
  assert.equal((await s.post('/api/import/apply', { id: r.body.id, lists: [] })).status, 409, 'the same import applied twice');
  assert.equal((await s.post('/api/import/read', { source: 'todoist', token: 'wrong' })).status, 400);
});
