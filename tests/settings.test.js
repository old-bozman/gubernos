// Settings: each setting where it applies — this device, you (every device), your Mac. 2026-11-05 Alex: "the settings got
// very complicated again… and on the iPhone and the server they should differ; now they're the same, it looks odd."
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { openPage } from './chrome.js';
import { webTargets } from '../lib/push.js';

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const GROUPS = '[...document.querySelectorAll(".settings h2.set-g")].map((h) => h.textContent)';
const ROWS = '[...document.querySelectorAll(".settings .set-row .set-l")].map((l) => l.firstChild.textContent.trim())';
const row = (label) => `[...document.querySelectorAll(".settings .set-row")].find((r) => r.querySelector(".set-l").firstChild.textContent.trim() === ${JSON.stringify(label)})`;
let s;
before(async () => { s = await startServer(); }, { timeout: 30000 });
after(async () => { await s?.stop(); });

async function settingsOn(setup) {
  const page = await openPage();
  await setup?.(page);
  await page.resize(402, 874, true);
  await page.goto(`${s.url}/#/settings`);
  assert.ok(await page.waitFor('document.querySelector(".settings .set-row")', 15000), 'Settings never drew');
  await page.sleep(1500); // the rows that ask the Mac (model, calendar, pairing) come in a moment later
  return page;
}

test('on a computer: grouped by where it applies; the Mac’s own settings are there; the calendar is one choice with its connection', { timeout: 60000 }, async () => {
  const page = await settingsOn();
  try {
    assert.deepEqual(await page.eval(GROUPS), ['This device', 'General', 'Your day', 'Your Mac', 'About']);
    const rows = await page.eval(ROWS);
    for (const gone of ['Undo window', 'Reminder pushes from the Mac', 'Morning & evening pushes from the Mac', 'Calendars', 'Profile', 'Screen explanations', 'Reflection format', 'Connect your iPhone', 'Pair a device', 'Require pairing'])
      assert.ok(!rows.includes(gone), `${gone} is still a row of its own`);
    for (const there of ['Theme', 'Notifications', 'Time format', 'Daily reflection', 'Model', 'Agents', 'Calendar', 'Google', 'iPhone and other devices'])
      assert.ok(rows.includes(there), `no ${there} row: ${rows.join(', ')}`);
    assert.deepEqual(await page.eval(`[...${row('Calendar')}.querySelectorAll(".seg button")].map((b) => b.textContent)`), ['This Mac', 'Google'], 'the calendar: this Mac or Google');
    // Google picked, not signed in: what to do is on that row, not somewhere else
    await page.eval(`${row('Calendar')}.querySelector('[data-val=google]').click()`);
    assert.ok(await page.waitFor(`/Google isn’t set up|Sign in with Google/.test(${row('Calendar')}.innerText)`), await page.eval(`${row('Calendar')}.innerText`));
    assert.ok(await page.waitFor(`${row('Daily reflection')}.innerText.includes("E-S-P")`), 'the reflection format sits with the reflection');
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); }
});

test('on a phone: the Mac’s own settings are one line', { timeout: 60000 }, async () => {
  const page = await settingsOn((p) => p.userAgent(IPHONE_UA));
  try {
    assert.deepEqual(await page.eval(GROUPS), ['This device', 'General', 'Your day', 'Your Mac', 'About']);
    const rows = await page.eval(ROWS);
    for (const mac of ['Model', 'Voice', 'Agents', 'Calendar', 'Google', 'iPhone and other devices']) assert.ok(!rows.includes(mac), `${mac} shows on the phone`);
    assert.ok(rows.includes('Your Mac') && await page.eval(`${row('Your Mac')}.innerText.includes("set on the Mac itself")`));
    assert.ok(rows.includes('Week starts on') && rows.includes('Habits'), 'what is yours stays');
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); }
});

test('in the iPhone app: This iPhone holds the app’s own settings, changed right there', { timeout: 60000 }, async () => {
  const page = await settingsOn(async (p) => {
    await p.userAgent(IPHONE_UA);
    await p.onNewDocument(`window.gubernosNative = { platform: 'ios', version: '0.2', speech: true, settings: true };
      let state = { mac: 'https://m-1.gubernos.dev', paired: true, folder: null, reminders: true, checkins: false, agents: true, language: 'en-US', languages: [{ id: 'en-US', name: 'English' }, { id: 'ru-RU', name: 'Russian' }] };
      window.sentToApp = [];
      window.webkit = { messageHandlers: { gubernos: { postMessage: async (m) => { window.sentToApp.push(m);
        if (m.op === 'native') return state;
        if (m.op === 'setNative') { state = { ...state, [m.key]: m.value }; return state; }
        return { ok: true }; } } } };`);
  });
  try {
    assert.deepEqual(await page.eval(GROUPS), ['This iPhone', 'General', 'Your day', 'Your Mac', 'About']);
    const rows = await page.eval(ROWS);
    assert.ok(!rows.includes('Notifications') && !rows.includes('iPhone app'), `the web app's notifications or the old sheet row: ${rows.join(', ')}`);
    assert.ok(await page.eval(`${row('Mac')}.innerText.includes("m-1.gubernos.dev · paired ✓")`), await page.eval(`${row('Mac')}?.innerText`));
    assert.equal(await page.eval(`${row('Morning plan & evening check-in')}.querySelector(".seg .on").textContent`), 'Off');
    await page.eval(`${row('Morning plan & evening check-in')}.querySelector("[data-val=on]").click()`);
    assert.ok(await page.waitFor(`${row('Morning plan & evening check-in')}.querySelector(".seg .on").textContent === "On"`), 'the switch didn’t take');
    assert.ok(await page.eval('window.sentToApp.some((m) => m.op === "setNative" && m.key === "checkins" && m.value === true)'), 'the app wasn’t told');
    await page.eval('const sel = document.querySelector("#set-native-lang"); sel.value = "ru-RU"; sel.dispatchEvent(new Event("change", { bubbles: true }))');
    assert.ok(await page.waitFor('window.sentToApp.some((m) => m.op === "setNative" && m.key === "language" && m.value === "ru-RU")'));
    await page.eval(`${row('Mac')}.querySelector("[data-act=native-settings]").click()`);
    assert.ok(await page.waitFor('window.sentToApp.some((m) => m.op === "settings")'), 'Change… doesn’t open the app’s sheet');
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); }
});

test('a reminder doesn’t ring twice on an iPhone whose app rings it itself', () => {
  const subs = [{ endpoint: 'a', ua: IPHONE_UA.slice(0, 80) }, { endpoint: 'b', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }];
  const rings = [{ local: { reminders: true, checkins: false } }];
  assert.deepEqual(webTargets(subs, { kind: 'reminder' }, rings).map((x) => x.endpoint), ['b'], 'the iPhone web app got it too');
  assert.deepEqual(webTargets(subs, { kind: 'checkin' }, rings).map((x) => x.endpoint), ['a', 'b'], 'the app doesn’t ring check-ins: the web app does');
  assert.deepEqual(webTargets(subs, { kind: 'agent' }, rings).map((x) => x.endpoint), ['a', 'b'], 'other pushes go everywhere');
  assert.deepEqual(webTargets(subs, { kind: 'reminder' }, []).map((x) => x.endpoint), ['a', 'b'], 'no iPhone app: the web app reminds');
});
