// Headless Google Chrome over the DevTools protocol, no dependencies (Node's own WebSocket). For tests that need the page
// actually running: openPage() → {goto, eval, screenshot, resize, errors, close}. errors collects uncaught exceptions, console.error
// and failed loads. No Chrome on the machine is a failure, not a skip: this is what stands between a broken page and people.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = process.env.GUBERNOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Chrome occasionally doesn't come up cleanly: try again, and never leave a half-started one behind (it would keep the test
// process alive for ever: a hung release)
export async function openPage({ args = [] } = {}) {
  let last;
  for (let i = 0; i < 3; i++) { try { return await start(args); } catch (e) { last = e; } }
  throw last;
}

async function start(args) {
  if (!fs.existsSync(CHROME)) throw new Error(`no Chrome at ${CHROME} (set GUBERNOS_CHROME)`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gubernos-chrome-'));
  // on Linux without its sandbox: Ubuntu 24's AppArmor blocks it for a Chromium that isn't installed system-wide
  const proc = spawn(CHROME, ['--headless=new', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', ...args, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let chromeLog = '', gone = null;
  proc.stderr.on('data', (d) => { chromeLog = (chromeLog + d).slice(-2000); });
  proc.once('exit', (code, signal) => { gone = `Chrome exited (${code ?? signal}): ${chromeLog.slice(-500)}`; for (const w of waiting.values()) w.reject(new Error(gone)); waiting.clear(); });
  const waiting = new Map(), errors = [];
  const giveUp = (e) => { proc.kill('SIGKILL'); try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp */ } throw e; };
  try {
  const portFile = path.join(dir, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !fs.existsSync(portFile) && !gone; i++) await sleep(100);
  if (!fs.existsSync(portFile)) throw new Error(gone || `Chrome didn't start in 15 s: ${chromeLog.slice(-500)}`);
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; setTimeout(() => reject(new Error('no answer from Chrome in 10 s')), 10000); });
  process.once('exit', () => proc.kill('SIGKILL'));
  let id = 0;
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.id) { const w = waiting.get(m.id); if (!w) return; /* its 15 s ran out already: that test failed with it */ waiting.delete(m.id); return m.error ? w.reject(new Error(m.error.message)) : w.resolve(m.result); }
    if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; errors.push(`exception: ${d.exception?.description || d.text} (${d.url || ''}:${d.lineNumber})`); }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(`log: ${m.params.entry.text} ${m.params.entry.url || ''}`);
  };
  // never wait forever: a dead or stuck browser fails the test instead of hanging the release
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    if (gone) return reject(new Error(gone));
    const n = ++id;
    const t = setTimeout(() => { waiting.delete(n); reject(new Error(`Chrome didn't answer ${method} in 15 s`)); }, 15000);
    waiting.set(n, { resolve: (x) => { clearTimeout(t); resolve(x); }, reject: (e) => { clearTimeout(t); reject(e); } });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const page = {
    errors, sleep, eval: evaluate, send,
    goto: (url) => send('Page.navigate', { url }),
    onNewDocument: (source) => send('Page.addScriptToEvaluateOnNewDocument', { source }), // runs before the page's own scripts (the iPhone app's window.gubernosNative)
    userAgent: (userAgent) => send('Emulation.setUserAgentOverride', { userAgent }),
    screenshot: async (file) => fs.writeFileSync(file, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64')),
    resize: (width, height, mobile = false) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }),
    waitFor: async (expression, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (await evaluate(expression).catch(() => false)) return true; await sleep(100); } return false; },
    close: async () => {
      ws.close();
      if (!gone) { proc.kill(); await new Promise((r) => { proc.once('exit', r); setTimeout(() => { proc.kill('SIGKILL'); r(); }, 2000); }); }
      // Chrome's helpers can still be writing here for a moment: leftovers in the temp dir must not fail the test
      try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* the OS cleans its temp dir */ }
    },
  };
  await evaluate('1');
  return page;
  } catch (e) { return giveUp(e); }
}
