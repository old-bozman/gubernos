#!/usr/bin/env node
// The explainer (public/concept.js) for the places outside the app: the site's "What is a personal OS" section (the
// gubernos.app repository, old-bozman/gubernos-site, checked out next to this one or at GUBERNOS_SITE: index.html between
// the concept markers, its styles in concept.css — commit and push there, a push publishes) and the README's pictures
// (docs/img/concept-wheel-*.svg, docs/img/concept-loops-*.svg). Run after changing concept.js, then commit.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONCEPT_CSS, TEXT, conceptHtml, wheelSvg, loopSvg, LOOPS } from '../public/concept.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); console.log('✓', rel); };

// site
const site = process.env.GUBERNOS_SITE || path.join(root, '..', 'gubernos-site');
const index = path.join(site, 'index.html');
const html = fs.readFileSync(index, 'utf8');
const START = '<!-- concept:start (scripts/build-concept.mjs) -->', END = '<!-- concept:end -->';
if (!html.includes(START) || !html.includes(END)) throw new Error(`${index}: concept markers missing`);
const section = `${START}
<section class="concept wide">
<h2>What is a personal OS</h2>
<p class="lead">${TEXT.lede}</p>
${conceptHtml({ h: 'h3' })}
</section>
${END}`;
const put = (file, text) => { fs.writeFileSync(path.join(site, file), text); console.log('✓', path.join(site, file)); };
put('index.html', html.slice(0, html.indexOf(START)) + section + html.slice(html.indexOf(END) + END.length));
put('concept.css', `/* written by scripts/build-concept.mjs from public/concept.js — edit there */\n${CONCEPT_CSS}\n`);

// README pictures: standalone SVGs with the Oxblood palette, a light and a dark file (the README's <picture> picks by
// GitHub's theme)
const PAL = {
  light: '--ink: #141312; --ink-2: #4a4745; --muted: #77736f; --line: #e2deda; --bg: #ffffff; --accent: #8e1c2c; --accent-ink: #ffffff; --card: #ffffff; --c-r1: #f7f5f3; --c-r2: #efebe8; --c-r3: #e5dfdb;',
  dark: '--ink: #e6edf3; --ink-2: #c4c0bd; --muted: #9a958f; --line: #3a3634; --bg: #0d1117; --accent: #d04a5c; --accent-ink: #ffffff; --card: #161b22; --c-r1: #161b22; --c-r2: #1d2229; --c-r3: #262c34;',
};
const standalone = (svg, theme) => svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" class="cpt" ').replace(/(<svg[^>]*>)/, `$1<style>
.cpt { ${PAL[theme]} font-family: -apple-system, "Segoe UI", system-ui, sans-serif; }
${CONCEPT_CSS.replace(/--c-r[123]: color-mix\([^;]*\);/g, '')}
</style>`);
const marker = '<defs><marker id="cl-ar" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" style="fill:var(--c-muted)"/></marker></defs>';
const loops = LOOPS.map((l, i) => `${loopSvg(l, { g: true, x: i * 410 })}<text x="${150 + i * 410}" y="-22" text-anchor="middle" style="font-size:16px;font-weight:600;fill:var(--c-ink)">${l[0]} <tspan style="font-size:12px;font-weight:400;fill:var(--c-muted)">· ${l[1]}</tspan></text>`).join('');
for (const theme of ['light', 'dark']) {
  write(`docs/img/concept-wheel-${theme}.svg`, standalone(wheelSvg(), theme));
  write(`docs/img/concept-loops-${theme}.svg`, standalone(`<svg viewBox="-60 -50 1240 300" role="img" aria-label="Life loops: day, week, quarter.">${marker}${loops}</svg>`, theme));
}
