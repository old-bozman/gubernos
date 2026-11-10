// The phone reaches the computer through a tunnel, where a request can stall and never end. 2026-11-09 the iPhone app opened
// to its menu over an empty page, tapping did nothing, until it was restarted. Now the first load has a time limit: the page
// says the computer can't be reached and tries again by itself, and the tasks come as soon as it answers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from './helpers.js';
import { openPage } from './chrome.js';

let s, proxy, stall = true, stallBody = false;
const held = [];
before(async () => {
  s = await startServer();
  // in front of the server: /api/state never answers while `stall` is on (a stuck tunnel); everything else goes through
  proxy = http.createServer((req, res) => {
    if (stall && req.url.startsWith('/api/state')) {
      // stallBody: the answer starts (200 and its first bytes) and then stops, as when a slow tunnel outlasts the time limit
      if (stallBody) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{"tasks":[{"id":"x"'); }
      held.push(res); return;
    }
    const up = http.request(`${s.url}${req.url}`, { method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => res.destroy());
    req.pipe(up);
  }).listen(0, '127.0.0.1');
  await new Promise((r) => proxy.once('listening', r));
}, { timeout: 30000 });
after(async () => { for (const r of held) r.destroy(); proxy?.closeAllConnections?.(); proxy?.close(); await s?.stop(); });

test('a stuck first load says the computer can’t be reached, then shows the tasks once it answers', { timeout: 60000 }, async () => {
  const page = await openPage();
  try {
    await page.goto(`http://127.0.0.1:${proxy.address().port}/#/today`);
    assert.ok(await page.waitFor('/Can’t reach your computer/.test(document.querySelector("#main")?.textContent)', 20000), 'still an empty page');
    // tapping around while it can't be reached keeps saying so, not empty lists
    await page.eval('location.hash = "#/inbox"');
    await new Promise((r) => setTimeout(r, 300));
    assert.match(await page.eval('document.querySelector("#main").textContent'), /Can’t reach your computer/);
    stall = false;
    await page.eval('document.querySelector("[data-act=load-retry]").click()');
    assert.ok(await page.waitFor('document.querySelector("#main h1")?.textContent === "Inbox" && !/Can’t reach/.test(document.querySelector("#main").textContent)', 15000), 'the page didn’t come');
  } finally { await page.close(); }
});

// 2026-11-10: the state's answer began and then stalled past the limit; the cut-off body was taken as an empty state ({}),
// and every screen broke on S.data.inbox.length / S.data.tasks.filter, /api/day?date=undefined
test('an answer cut off midway is not taken as an empty state', { timeout: 60000 }, async () => {
  stall = true; stallBody = true;
  const page = await openPage();
  try {
    await page.goto(`http://127.0.0.1:${proxy.address().port}/#/day`);
    assert.ok(await page.waitFor('/Can’t reach your computer/.test(document.querySelector("#main")?.textContent)', 20000), 'not told it can’t be reached');
    assert.deepEqual(page.errors.filter((e) => /TypeError|Cannot read propert|date=undefined/.test(e)), []);
    stall = false;
    await page.eval('document.querySelector("[data-act=load-retry]").click()');
    assert.ok(await page.waitFor('!/Can’t reach/.test(document.querySelector("#main").textContent) && !!document.querySelector("#main h1")', 15000), 'the page didn’t come');
    assert.deepEqual(page.errors.filter((e) => /TypeError|Cannot read propert|date=undefined/.test(e)), []);
  } finally { await page.close(); stallBody = false; }
});

// the state goes compressed when the client takes it (every browser and URLSession does), so a slow tunnel carries less
test('a big answer goes gzip-compressed to a client that accepts it', { timeout: 60000 }, async () => {
  // enough tasks for the kit's state to be a big answer
  while ((await (await fetch(`${s.url}/api/state`)).text()).length < 30000) await s.post('/api/tasks', { title: `A task with a long enough title to fill the state ${'x'.repeat(200)}` });
  const big = await new Promise((ok, no) => http.get(`${s.url}/api/state`, { headers: { 'Accept-Encoding': 'gzip' } }, (r) => { r.resume(); ok(r.headers['content-encoding']); }).on('error', no));
  assert.equal(big, 'gzip');
  const raw = await new Promise((ok, no) => http.get(`${s.url}/api/state`, (r) => { r.resume(); ok(r.headers['content-encoding']); }).on('error', no));
  assert.equal(raw, undefined, 'compressed for a client that didn’t ask');
});
