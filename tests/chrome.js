// Headless Google Chrome over the DevTools protocol, no dependencies (Node's own WebSocket). For tests that need the page
// actually running: openPage() → {goto, eval, resize, errors, close}. errors collects uncaught exceptions, console.error
// and failed loads. No Chrome on the machine is a failure, not a skip: this is what stands between a broken page and people.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = process.env.GUBERNOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function openPage() {
  if (!fs.existsSync(CHROME)) throw new Error(`no Chrome at ${CHROME} (set GUBERNOS_CHROME)`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gubernos-chrome-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
  const portFile = path.join(dir, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const waiting = new Map(), errors = [];
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.id) { const w = waiting.get(m.id); waiting.delete(m.id); return m.error ? w.reject(new Error(m.error.message)) : w.resolve(m.result); }
    if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; errors.push(`exception: ${d.exception?.description || d.text} (${d.url || ''}:${d.lineNumber})`); }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(`log: ${m.params.entry.text} ${m.params.entry.url || ''}`);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; waiting.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })); });
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  return {
    errors, sleep, eval: evaluate,
    goto: (url) => send('Page.navigate', { url }),
    resize: (width, height, mobile = false) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }),
    waitFor: async (expression, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (await evaluate(expression).catch(() => false)) return true; await sleep(100); } return false; },
    close: async () => { ws.close(); proc.kill(); await new Promise((r) => { proc.once('exit', r); setTimeout(r, 2000); }); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}
