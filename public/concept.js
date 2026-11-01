// What Gubernos is, drawn: the model as a wheel, the life loops and where the data lives. One source for the app
// (More → How it works, the first-launch tour), the site (scripts/build-concept.mjs writes it into site/index.html) and the
// README's pictures (the same script writes docs/img/*.svg). Colours come from the page's tokens (--ink, --accent, …).

export const CONCEPT_CSS = `
.cpt { --c-ink: var(--ink); --c-ink2: var(--ink-2, var(--muted)); --c-muted: var(--muted); --c-line: var(--line); --c-bg: var(--bg);
  --c-acc: var(--accent); --c-on: var(--accent-ink, #fff); --c-surface: var(--card, var(--bg));
  --c-r1: color-mix(in srgb, var(--ink) 3%, var(--bg)); --c-r2: color-mix(in srgb, var(--ink) 6.5%, var(--bg));
  --c-r3: color-mix(in srgb, var(--ink) 11%, var(--bg)); --c-soft: color-mix(in srgb, var(--accent) 9%, var(--bg)); }
.cpt svg text { font-family: inherit; }
.cw-rt { font-size: 11.5px; font-weight: 600; letter-spacing: .14em; fill: var(--c-ink2); }
.cw-rs { font-size: 11px; font-weight: 500; letter-spacing: .1em; fill: var(--c-muted); }
.cw-hub { font-size: 17px; font-weight: 600; letter-spacing: .06em; fill: var(--c-on); }
.cw-hub2 { font-size: 11.5px; font-weight: 500; fill: var(--c-on); opacity: .85; }
.cw-n { font-size: 12px; font-weight: 600; fill: var(--c-acc); }
.cl-t { font-size: 12.5px; font-weight: 500; fill: var(--c-ink); }
.cl-s { font-size: 11px; fill: var(--c-muted); }
.cl-mt { font-size: 13px; font-weight: 600; fill: var(--c-ink); }
.cl-ag { fill: var(--c-acc); }
.cpt-wheel { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 28px; align-items: center; }
.cpt-wheel > svg { width: 100%; max-width: 520px; height: auto; display: block; margin: 0 auto; }
.cpt-chain { list-style: none; margin: 0; padding: 0; display: grid; }
.cpt-chain li { display: grid; grid-template-columns: 28px 1fr; gap: 12px; padding: 11px 0; border-top: 1px solid var(--c-line); }
.cpt-chain li:first-child { border-top: 0; }
.cpt-chain .n { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 600; border: 1.5px solid var(--c-acc); color: var(--c-acc); }
.cpt-chain li:first-child .n { background: var(--c-acc); color: var(--c-on); }
.cpt-chain .k { font-size: 11.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--c-muted); font-weight: 600; }
.cpt-chain .v { font-weight: 500; }
.cpt-chain .h { font-size: 13.5px; color: var(--c-muted); }
.cpt-loops { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.cpt-loop { border: 1px solid var(--c-line); border-radius: 14px; padding: 16px 14px 14px; display: grid; gap: 8px; align-content: start; background: var(--c-surface); }
.cpt-loop svg { width: 100%; height: auto; display: block; }
.cpt-loop .cad { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.cpt-loop .cad b { font-weight: 600; font-size: 16px; }
.cpt-loop .cad span, .cpt-legend { font-size: 13px; color: var(--c-muted); }
.cpt-loop p { margin: 0; font-size: 14px; color: var(--c-ink2); }
.cpt-legend { display: flex; flex-wrap: wrap; gap: 6px 18px; }
.cpt-capture { display: grid; grid-template-columns: auto 1fr; gap: 14px; align-items: center; background: var(--c-soft); border-radius: 14px; padding: 14px 16px; }
.cpt-capture .ic { width: 38px; height: 38px; border-radius: 10px; background: var(--c-surface); display: grid; place-items: center; color: var(--c-acc); }
.cpt-capture p { margin: 0; font-size: 14.5px; color: var(--c-ink2); }
.cpt-capture b { color: var(--c-ink); font-weight: 600; }
.cpt-arch { display: grid; gap: 12px; }
.cpt-zone { border-radius: 16px; padding: 16px; display: grid; gap: 12px; }
.cpt-zone > .zl { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; align-items: baseline; }
.cpt-zone > .zl b { font-weight: 600; }
.cpt-zone > .zl span { font-size: 13px; color: var(--c-muted); }
.cpt-yours { border: 2px solid var(--c-ink); background: var(--c-surface); }
.cpt-map { display: grid; grid-template-columns: minmax(0, 1fr) 84px minmax(0, 1.1fr) 84px minmax(0, 1fr); align-items: center; }
.cpt-box { border: 1px solid var(--c-line); border-radius: 12px; padding: 12px 14px; background: var(--c-bg); display: grid; gap: 4px; min-width: 0; }
.cpt-box .bt { display: flex; align-items: center; gap: 8px; font-weight: 600; }
.cpt-box .bt svg { flex: none; width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; color: var(--c-ink2); }
.cpt-box p { margin: 0; font-size: 13.5px; color: var(--c-ink2); }
.cpt-box.files { border: 1.5px solid var(--c-acc); background: var(--c-soft); }
.cpt-box.files .bt svg { color: var(--c-acc); }
.cpt-stack { display: grid; gap: 10px; }
.cpt-link { display: grid; justify-items: center; gap: 2px; text-align: center; font-size: 11.5px; color: var(--c-muted); line-height: 1.25; padding: 0 4px; }
.cpt-link .ln { width: 100%; height: 2px; background: var(--c-ink2); position: relative; border-radius: 2px; }
.cpt-link .ln::before, .cpt-link .ln::after { content: ""; position: absolute; top: -4px; border: 5px solid transparent; }
.cpt-link .ln::before { left: -2px; border-right-color: var(--c-ink2); border-left-width: 0; }
.cpt-link .ln::after { right: -2px; border-left-color: var(--c-ink2); border-right-width: 0; }
.cpt-theirs { border: 1.5px dashed var(--c-line); }
.cpt-svc { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.cpt-svc div { display: grid; gap: 3px; align-content: start; }
.cpt-svc b { font-weight: 600; font-size: 14.5px; }
.cpt-svc span { font-size: 13px; color: var(--c-ink2); }
.cpt-none { background: var(--c-soft); grid-template-columns: auto 1fr; align-items: center; }
.cpt-none .x { font-weight: 600; text-decoration: line-through; text-decoration-color: var(--c-acc); text-decoration-thickness: 2px; color: var(--c-ink2); white-space: nowrap; }
.cpt-none p { margin: 0; font-size: 14.5px; color: var(--c-ink2); }
.cpt-duo { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.cpt-duo > div { border: 1px solid var(--c-line); border-radius: 14px; padding: 16px; background: var(--c-surface); display: grid; gap: 10px; align-content: start; }
.cpt-duo h3 { margin: 0; font-size: 16px; font-weight: 600; }
.cpt-duo ul { margin: 0; padding-left: 18px; display: grid; gap: 5px; font-size: 14.5px; color: var(--c-ink2); }
.cpt-term { font: 13px/1.5 ui-monospace, "SF Mono", Menlo, monospace; background: var(--c-bg); border: 1px solid var(--c-line); border-radius: 8px; padding: 10px 12px; color: var(--c-ink2); overflow-x: auto; white-space: pre; }
.cpt-same { text-align: center; font-size: 14.5px; color: var(--c-ink2); margin: 0; }
@media (max-width: 820px) {
  .cpt-wheel, .cpt-loops, .cpt-duo { grid-template-columns: 1fr; }
  .cpt-loop svg { max-width: 330px; margin: 0 auto; }
  .cpt-map { grid-template-columns: 1fr; }
  .cpt-link { grid-template-columns: auto auto; justify-content: center; align-items: center; gap: 10px; padding: 8px 0; }
  .cpt-link .ln { width: 2px; height: 26px; }
  .cpt-link .ln::before { left: -4px; top: -2px; border: 5px solid transparent; border-bottom-color: var(--c-ink2); border-top-width: 0; }
  .cpt-link .ln::after { left: -4px; right: auto; top: auto; bottom: -2px; border: 5px solid transparent; border-top-color: var(--c-ink2); border-bottom-width: 0; }
  .cpt-svc { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cpt-none { grid-template-columns: 1fr; }
}`;

// The model: today at the hub, then projects & tasks, then goals / commitments / wants / decisions, then the five areas.
// One line runs from today's #1 out to the area it serves (the numbered dots match chainHtml).
export function wheelSvg() {
  const h = 'M612 320H632M526.5 526.5L540.6 540.6M320 612V632M113.5 526.5L99.4 540.6M28 320H8M113.5 113.5L99.4 99.4M320 28V8M526.5 113.5L540.6 99.4';
  const arc = (id, r, top) => `<path id="${id}" d="M${320 - r} 320 A${r} ${r} 0 0 ${top ? 1 : 0} ${320 + r} 320"/>`;
  const dot = (x, n, hub) => `<circle cx="${x}" cy="320" r="12" style="fill:${hub ? 'var(--c-on)' : 'var(--c-surface)'};stroke:var(--c-acc)" stroke-width="2"/><text class="cw-n" x="${x}" y="324.5" text-anchor="middle">${n}</text>`;
  return `<svg viewBox="0 0 640 640" role="img" aria-label="Four rings: today at the centre, then projects and tasks, then goals, commitments, wants and decisions, then the areas of your life. One line runs from today out to an area.">
  <defs>${arc('cw-t2', 107, 1)}${arc('cw-t3', 182, 1)}${arc('cw-t4', 255, 1)}${arc('cw-b2', 111, 0)}${arc('cw-b3', 186, 0)}${arc('cw-b4', 259, 0)}</defs>
  <path d="${h}" style="stroke:var(--c-line)" stroke-width="10" stroke-linecap="round"/>
  <circle cx="320" cy="320" r="292" style="fill:var(--c-r1);stroke:var(--c-line)"/>
  <circle cx="320" cy="320" r="220" style="fill:var(--c-r2);stroke:var(--c-line)"/>
  <circle cx="320" cy="320" r="145" style="fill:var(--c-r3);stroke:var(--c-line)"/>
  <circle cx="320" cy="320" r="70" style="fill:var(--c-acc)"/>
  <path d="M320 100V28M529.2 252L597.7 229.8M449.3 498L491.6 556.2M190.7 498L148.4 556.2M110.8 252L42.3 229.8" style="stroke:var(--c-line)" stroke-width="1.5"/>
  <text class="cw-rt" text-anchor="middle"><textPath href="#cw-t2" startOffset="50%">PROJECTS &amp; TASKS</textPath></text>
  <text class="cw-rt" text-anchor="middle"><textPath href="#cw-t3" startOffset="50%">GOALS · COMMITMENTS · WANTS · DECISIONS</textPath></text>
  <text class="cw-rt" text-anchor="middle"><textPath href="#cw-t4" startOffset="50%">AREAS OF YOUR LIFE</textPath></text>
  <text class="cw-rs" text-anchor="middle" dy="10"><textPath href="#cw-b2" startOffset="50%">this week</textPath></text>
  <text class="cw-rs" text-anchor="middle" dy="10"><textPath href="#cw-b3" startOffset="50%">this quarter · this year · a few years</textPath></text>
  <text class="cw-rs" text-anchor="middle" dy="10"><textPath href="#cw-b4" startOffset="50%">energy · work · love · home · finance</textPath></text>
  <text class="cw-hub" x="320" y="316" text-anchor="middle">TODAY</text>
  <text class="cw-hub2" x="320" y="338" text-anchor="middle">#1 · protocol · plan</text>
  <path d="M372 320H575" style="stroke:var(--c-acc)" stroke-width="2.5"/>
  ${dot(390, 1, true)}${dot(428, 2)}${dot(502, 3)}${dot(575, 4)}
</svg>`;
}

const CHAIN = [
  ['Today’s #1', 'Long run, 14 km', 'The one result that makes the day a win'],
  ['Project', '12-week training block', 'An outcome with an end, made of tasks'],
  ['Goal', 'Run a half marathon by May', 'Next to it sit your promises, wishes and open decisions'],
  ['Area', 'Energy', 'Never done; it is why the rest exists'],
];
export const chainHtml = () => `<ol class="cpt-chain" aria-label="One line from today to why">${CHAIN.map(([k, v, h], i) => `<li><span class="n">${i + 1}</span><div><div class="k">${k}</div><div class="v">${v}</div><div class="h">${h}</div></div></li>`).join('')}</ol>`;
export const wheelHtml = () => `<div class="cpt-wheel">${wheelSvg()}${chainHtml()}</div>`;

// Life loops: [cadence, when, [top, right, bottom, left] steps as [title, sub, agent helps], centre, sub, text]
export const LOOPS = [
  ['Day', 'morning to evening', [['Plan the day', '#1, calendar, free time', 1], ['Protocol', 'morning habits'], ['Do the #1', 'focus blocks, tasks'], ['Reflect', 'evening, tomorrow’s #1']],
    'a day won', 'when the #1 is done', 'A morning plan that fits your real calendar, the habits that frame the day, one result that matters, and a short look back.'],
  ['Week', 'Sunday to Saturday', [['Three wins', 'results by Saturday'], ['Run the days', 'seven day loops'], ['Weekly review', 'habits, done, missed', 1], ['Next wins', 'from the review']],
    'a week won', 'when the wins land', 'Three results, not a to-do list. The review shows habits, finished work and what slipped, and suggests next week’s wins.'],
  ['Quarter', 'and the year', [['Focus', 'a few things, and why now'], ['Goals', 'and their projects'], ['Decide', 'options, criteria, default', 1], ['Review', 'the model itself']],
    'the course', 'set and corrected', 'Where you choose what deserves the next months, close open decisions, and drop what no longer fits.'],
];
// One loop's drawing (its own <svg>, or a <g> at an offset for the README's picture).
export function loopSvg([cad, , steps, mid, midSub], { g = false, x = 0 } = {}) {
  const ag = (s) => (s[2] ? ' <tspan class="cl-ag">✦</tspan>' : '');
  const node = (cx, cy, first) => `<circle cx="${cx}" cy="${cy}" r="7" style="${first ? 'fill:var(--c-acc)' : 'fill:var(--c-surface);stroke:var(--c-ink)'}" stroke-width="2"/>`;
  const [t, r, b, l] = steps;
  const body = `<g fill="none" style="stroke:var(--c-muted)" stroke-width="1.6" marker-end="url(#cl-ar)">
      <path d="M168 49A75 75 0 0 1 222 105"/><path d="M222 147A75 75 0 0 1 168 201"/><path d="M132 201A75 75 0 0 1 78 147"/><path d="M78 105A75 75 0 0 1 132 49"/></g>
    ${node(150, 51, true)}${node(225, 126)}${node(150, 201)}${node(75, 126)}
    <text class="cl-t" x="150" y="24" text-anchor="middle">${t[0]}${ag(t)}</text><text class="cl-s" x="150" y="38" text-anchor="middle">${t[1]}</text>
    <text class="cl-t" x="240" y="122">${r[0]}${ag(r)}</text><text class="cl-s" x="240" y="136">${r[1]}</text>
    <text class="cl-t" x="150" y="226" text-anchor="middle">${b[0]}${ag(b)}</text><text class="cl-s" x="150" y="240" text-anchor="middle">${b[1]}</text>
    <text class="cl-t" x="60" y="122" text-anchor="end">${l[0]}${ag(l)}</text><text class="cl-s" x="60" y="136" text-anchor="end">${l[1]}</text>
    <text class="cl-mt" x="150" y="124" text-anchor="middle">${mid}</text><text class="cl-s" x="150" y="139" text-anchor="middle">${midSub}</text>`;
  const marker = '<defs><marker id="cl-ar" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" style="fill:var(--c-muted)"/></marker></defs>';
  if (g) return `<g transform="translate(${x} 0)">${body}</g>`;
  return `<svg viewBox="-55 0 410 250" role="img" aria-label="${cad} loop: ${steps.map((s) => s[0]).join(', ')}.">${marker}${body}</svg>`;
}
export const loopsHtml = (only) => `<div class="cpt-loops"${only ? ' style="grid-template-columns:1fr"' : ''}>${LOOPS.filter((l) => !only || l[0] === only).map((l) => `<div class="cpt-loop"><div class="cad"><b>${l[0]}</b><span>${l[1]}</span></div>${loopSvg(l)}<p>${l[5]}</p></div>`).join('')}</div>`;
export const legendHtml = () => '<div class="cpt-legend"><span><span style="color:var(--c-acc)">✦</span> an AI agent helps here: estimates, drafts, research, triage</span></div>';
export const captureHtml = () => `<div class="cpt-capture"><div class="ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg></div>
  <p><b>Everything that comes in feeds the loops.</b> A voice note on the watch, a shared link, a mail, a thought at 2 am: it lands in the Inbox, an agent reads it and proposes what it is (a task, a reference, a note for later), and you decide with one tap.</p></div>`;

const ICON = {
  phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  mac: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20"/>',
  agent: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
};
const box = (ic, title, text, cls = '') => `<div class="cpt-box ${cls}"><div class="bt"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[ic]}</svg>${title}</div><p>${text}</p></div>`;
const link = (label) => `<div class="cpt-link"><div class="ln"></div><span>${label}</span></div>`;
// Where the data lives: the user's devices and files, the services they already use, and no server of ours.
export const archHtml = () => `<div class="cpt-arch">
  <div class="cpt-zone cpt-yours"><div class="zl"><b>Yours</b><span>your devices, your files, your accounts</span></div>
    <div class="cpt-map">
      <div class="cpt-stack">${box('phone', 'iPhone and Watch', 'Capture, today, habits, reminders. Works on its own, even offline.')}</div>
      ${link('iCloud Drive<br>sync')}
      ${box('folder', 'Your files', 'One folder of Markdown: tasks, projects, goals, habits, days, reviews. Readable in any editor, today and in twenty years.', 'files')}
      ${link('the same<br>folder')}
      <div class="cpt-stack">${box('mac', 'Your Mac', 'Gubernos for Mac: planning with your calendar, voice, the chat. Your phone reaches it over your own private network.')}
        ${box('agent', 'Your agents', 'Claude Code, Codex or Gemini on your Mac, with your own subscription. They work in the same files.')}</div>
    </div></div>
  <div class="cpt-zone cpt-theirs"><div class="zl"><b>Services you already use</b><span>with your own accounts, only when you turn them on</span></div>
    <div class="cpt-svc">
      <div><b>Your AI provider</b><span>Anthropic, OpenAI or Google get the text an agent needs for the task it is doing, under your account.</span></div>
      <div><b>Your calendar</b><span>Google or Apple Calendar, read for free time; blocks are written only when you apply a plan.</span></div>
      <div><b>Apple iCloud</b><span>Syncs the folder between your devices, like any other file.</span></div>
      <div><b>Apple Health</b><span>Ticks off habits like steps or sleep. Read on your phone and never sent anywhere.</span></div>
    </div></div>
  <div class="cpt-zone cpt-none"><span class="x">Gubernos servers</span><p>There are none. No account to create, nothing uploaded to us, no tracking. The Mac app is open source, so anyone can check.</p></div>
</div>`;
// The app next to the user's own agent.
export const roleHtml = () => `<div class="cpt-duo">
  <div><h3>With your agent, in plain words</h3><div class="cpt-term">› find everything about the birthday party
› draft the reply to the landlord
› compare three options for the new boiler</div>
    <ul><li>Open-ended work: research, drafts, analysis</li><li>Anything you can describe</li><li>Best at a desk</li></ul></div>
  <div><h3>In Gubernos, a screen for each step</h3><ul><li>The morning plan against your real calendar</li><li>Habits and protocols, ticked on the watch</li>
    <li>The inbox, sorted by an agent, decided by you</li><li>Weekly wins and the weekly review</li><li>Hand a task to an agent, then check its work and accept it</li>
    <li>Personal flows that need you in the loop, wherever you are</li></ul></div>
</div><p class="cpt-same">Both read and write the same files. Use either, or both.</p>`;

// The words around the drawings, shared by the app's page and the site.
export const TEXT = {
  lede: 'What you are responsible for, what you have promised, what you want and what you still have to decide, wired to your projects, your tasks and today. Gubernos keeps that model in plain files you own and gives you, and your AI agents, one place to steer it.',
  wheel: ['Your life as a wheel: today at the hub, the reasons around it', 'Each ring is a slower horizon. Anything on an inner ring links outward to why it matters, so a task is never just a task, and an area is never just a wish without a next step.'],
  loops: ['Life loops: a day inside a week inside a quarter', 'Every loop plans, does and looks back. The day reports to the week, the week to the quarter, and each review carries what you learned back into the model.'],
  arch: ['Everything stays with you. Gubernos has no server to send it to.', 'Your system is a folder of plain Markdown files in your own iCloud Drive. The apps and the agents read and write those files on your devices. There is no Gubernos account, no Gubernos cloud and no analytics.'],
  role: ['Your agent can do anything. The app gives your life’s routines a shape.', 'You can already ask Claude or Codex to work in a folder of notes. Gubernos adds the structure an agent does not keep on its own: the model, the loops and a screen for each step, on your Mac, phone and wrist.'],
};

// The whole explainer (More → How it works; the site's section), headings at level h2.
export function conceptHtml({ h = 'h2' } = {}) {
  const sec = (eyebrow, [title, note], body) => `<section class="cpt-sec"><div class="cpt-head"><div class="cpt-eyebrow">${eyebrow}</div><${h}>${title}</${h}><p>${note}</p></div>${body}</section>`;
  return `<div class="cpt">
  ${sec('The model', TEXT.wheel, wheelHtml())}
  ${sec('How it runs', TEXT.loops, loopsHtml() + captureHtml() + legendHtml())}
  ${sec('Where your data lives', TEXT.arch, archHtml())}
  ${sec('The app and your agent', TEXT.role, roleHtml())}
</div>`;
}
