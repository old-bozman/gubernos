#!/usr/bin/env node
// Renders a feedback snapshot (data/feedback/<id>.html) to a PNG the way the owner saw it: the page's HTML with the
// app's CSS from the running app, at their viewport. Needs playwright-core and Google Chrome (developer tool only).
//   node scripts/feedback-view.mjs data/feedback/<id>.html [out.png] [--full]
import fs from 'node:fs';
import path from 'node:path';
const [file, out = file.replace(/\.html$/, '.png'), ...flags] = process.argv.slice(2);
if (!file || !fs.existsSync(file)) { console.error('usage: feedback-view.mjs <snapshot.html> [out.png] [--full]'); process.exit(2); }
let chromium;
try { ({ chromium } = await import(process.env.PLAYWRIGHT || 'playwright-core')); } catch { console.error('needs playwright-core (set PLAYWRIGHT=/path/to/playwright-core)'); process.exit(2); }
// a snapshot from someone else's install points at their port: use this Mac's app for app.css
const html = fs.readFileSync(file, 'utf8').replace(/<base href="[^"]*">/, `<base href="http://127.0.0.1:${process.env.GUBERNOS_PORT || 4747}/">`);
const vw = Number(html.match(/content="width=(\d+)"/)?.[1]) || 1280;
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const p = await b.newPage({ viewport: { width: vw, height: vw < 800 ? 844 : 900 }, deviceScaleFactor: vw < 800 ? 2 : 1 });
await p.setContent(html, { waitUntil: 'networkidle' });
// where the owner had scrolled: #main, the window, the task drawer
await p.evaluate(() => { const [m, w, d] = (document.body.dataset.scroll || '').split(',').map(Number); const q = (s) => document.querySelector(s);
  if (m && q('#main')) q('#main').scrollTop = m; if (w) window.scrollTo(0, w); if (d && q('#drawer')) q('#drawer').scrollTop = d; });
await p.screenshot({ path: out, fullPage: flags.includes('--full') });
await b.close();
console.log(path.resolve(out));
