// Gubernos relay (Cloudflare Worker, relay.gubernos.app): bug reports and ideas from people's installs reach the
// developer without a GitHub account on their side. A report becomes an issue in a PRIVATE repo, opened with the
// developer's fine-grained token (that repo only: issues + contents), so reports, screenshots and task titles aren't public
// (the developer's dev session — Claude Code — reads them to work on them).
//   POST /feedback  {install, kind: bug|idea, title, body, attachment?: html}  → {issue, key}
//   GET  /feedback/<issue>?key=…                         → {state: OPEN|CLOSED, comments: [{body, at, from: developer|reporter}]}
//   POST /feedback/<issue>/reply?key=…  {body}           → the reporter's answer or "still wrong": a comment, reopens the issue
// key = HMAC(issue number): only the install that sent a report reads the answers to it.
//   POST /push  {env: sandbox|production, tokens: [≤10 device tokens], payload: "<APNs JSON, ≤4 KB>", collapse?}
//     → {results: [{device, status, reason}]}: Apple Push for the iPhone app on someone else's install. APNs takes only
//     the app owner's key, so their Mac (lib/apns.js, no apns.p8 of its own) hands the push here; the key never leaves.
//     The topic is fixed (APNS_TOPIC), so it pushes to Gubernos devices only. No auth beyond that: whoever holds a device
//     token (only that phone's own Mac has it) could send that phone an alert. Nothing is logged or stored (no console.log;
//     observability off in wrangler.toml).
// Secrets: GITHUB_TOKEN, KEY_SECRET, APNS_KEY (the .p8 text) (wrangler secret put …). Vars: FEEDBACK_REPO, APNS_KEY_ID,
// APNS_TEAM_ID, APNS_TOPIC. Bindings: LIMIT (reports per IP), PUSH_LIMIT (pushes per IP).
const MAX = 2 * 1024 * 1024;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const enc = new TextEncoder();

async function sign(env, n) {
  const k = await crypto.subtle.importKey('raw', enc.encode(env.KEY_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(`feedback:${n}`)));
  return btoa(String.fromCharCode(...mac)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 32);
}
const same = (a, b) => a.length === b.length && [...a].reduce((d, c, i) => d | (c.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0;

function gh(env, method, path, body) {
  return fetch(`${env.GITHUB_API || 'https://api.github.com'}${path}`, {
    method,
    headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'gubernos-relay', 'x-github-api-version': '2022-11-28', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}
const b64 = (s) => { const u = enc.encode(s); let out = ''; for (let i = 0; i < u.length; i += 0x8000) out += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(out); };
const clip = (s, n) => String(s || '').slice(0, n);

async function report(req, env) {
  const raw = await req.text();
  if (raw.length > MAX) return json({ error: 'too big (2 MB at most)' }, 413);
  let r; try { r = JSON.parse(raw); } catch { return json({ error: 'not JSON' }, 400); }
  const kind = r.kind === 'idea' ? 'idea' : 'bug';
  const title = clip(r.title, 200).trim(), install = clip(r.install, 40).replace(/[^\w-]/g, '');
  if (!title || !install) return json({ error: 'title and install are required' }, 400);
  const repo = env.FEEDBACK_REPO;
  let link = '';
  if (r.attachment) {
    // the screen snapshot and screenshots, one HTML file in the private repo (only the developer can open it)
    const file = `reports/${new Date().toISOString().slice(0, 10)}/${install}-${Date.now()}.html`;
    const put = await gh(env, 'PUT', `/repos/${repo}/contents/${file}`, { message: `${kind} from ${install}`, content: b64(String(r.attachment)) });
    if (!put.ok) return json({ error: `couldn't store the snapshot (${put.status})` }, 502);
    link = `\n\nSnapshot: \`${file}\` — \`gh api repos/${repo}/contents/${file} -H 'Accept: application/vnd.github.raw' > s.html && node scripts/feedback-view.mjs s.html\``;
  }
  const body = `${clip(r.body, 60000)}${link}\n\n<sub>install ${install}</sub>`;
  let res = await gh(env, 'POST', `/repos/${repo}/issues`, { title, body, labels: ['feedback', kind] });
  if (res.status === 422) res = await gh(env, 'POST', `/repos/${repo}/issues`, { title, body }); // labels refused
  if (!res.ok) return json({ error: `couldn't open the issue (${res.status})` }, 502);
  const n = (await res.json()).number;
  return json({ issue: n, key: await sign(env, n) });
}

async function answers(n, key, env) {
  if (!key || !same(key, await sign(env, n))) return json({ error: 'wrong key' }, 403);
  const repo = env.FEEDBACK_REPO;
  const [i, c] = await Promise.all([gh(env, 'GET', `/repos/${repo}/issues/${n}`), gh(env, 'GET', `/repos/${repo}/issues/${n}/comments?per_page=100`)]);
  if (!i.ok || !c.ok) return json({ error: `GitHub ${i.ok ? c.status : i.status}` }, 502);
  const issue = await i.json(), comments = await c.json();
  return json({ state: issue.state === 'closed' ? 'CLOSED' : 'OPEN',
    comments: comments.map((x) => (x.body.startsWith(REPORTER) ? { from: 'reporter', body: x.body.slice(REPORTER.length).trim().replace(/^\*\*Reporter:\*\*\s*/, ''), at: x.created_at } : { from: 'developer', body: x.body, at: x.created_at })) });
}

const REPORTER = '<!-- reporter -->';
async function reply(req, n, key, env) {
  if (!key || !same(key, await sign(env, n))) return json({ error: 'wrong key' }, 403);
  let r; try { r = JSON.parse(await req.text()); } catch { return json({ error: 'not JSON' }, 400); }
  const text = clip(r.body, 20000).trim();
  if (!text) return json({ error: 'body is required' }, 400);
  const repo = env.FEEDBACK_REPO;
  const c = await gh(env, 'POST', `/repos/${repo}/issues/${n}/comments`, { body: `${REPORTER}\n**Reporter:** ${text}` });
  if (!c.ok) return json({ error: `couldn't add the comment (${c.status})` }, 502);
  await gh(env, 'PATCH', `/repos/${repo}/issues/${n}`, { state: 'open' });
  return json({ ok: true });
}

// Apple Push: the provider token (ES256 JWT), reused for 50 min (Apple refuses one older than 60, or new ones too often)
const APNS = { sandbox: 'https://api.sandbox.push.apple.com', production: 'https://api.push.apple.com' };
const apnsHost = (env, e) => env.APNS_API || APNS[e]; // APNS_API: tests only
let jwt = null;
async function apnsBearer(env) {
  if (jwt && Date.now() - jwt.at < 50 * 60e3) return jwt.token;
  const der = Uint8Array.from(atob(String(env.APNS_KEY).replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const u = (o) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const data = `${u({ alg: 'ES256', kid: env.APNS_KEY_ID })}.${u({ iss: env.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) })}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(data))); // r||s already
  jwt = { at: Date.now(), token: `${data}.${btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}` };
  return jwt.token;
}
async function push(req, env) {
  let r; try { r = JSON.parse(await req.text()); } catch { return json({ error: 'not JSON' }, 400); }
  const host = APNS[r.env] && apnsHost(env, r.env), tokens = Array.isArray(r.tokens) ? r.tokens : [], payload = String(r.payload || '');
  if (!host || !tokens.length || tokens.length > 10 || tokens.some((t) => !/^[0-9a-f]{64,200}$/i.test(String(t)))) return json({ error: 'env and 1–10 device tokens' }, 400);
  if (!payload || payload.length > 4096) return json({ error: 'payload: APNs JSON, 4 KB at most' }, 400);
  try { if (!JSON.parse(payload).aps) throw 0; } catch { return json({ error: 'payload must be APNs JSON with "aps"' }, 400); }
  const bearer = await apnsBearer(env);
  const results = await Promise.all(tokens.map(async (t) => {
    const res = await fetch(`${host}/3/device/${t}`, { method: 'POST', body: payload, headers: {
      authorization: `bearer ${bearer}`, 'apns-topic': env.APNS_TOPIC || 'app.gubernos', 'apns-push-type': 'alert', 'apns-priority': '10',
      'apns-expiration': String(Math.floor(Date.now() / 1000) + 86400), ...(r.collapse ? { 'apns-collapse-id': clip(r.collapse, 64) } : {}) } });
    const reason = res.ok ? '' : await res.json().then((j) => j.reason, () => '');
    return { device: t.slice(0, 8), status: res.status, reason };
  }));
  return json({ results });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/feedback' && req.method === 'POST') {
      // sending is limited per IP; reading answers isn't (a Mac polls each open report every 20 minutes)
      const ok = !env.LIMIT || (await env.LIMIT.limit({ key: req.headers.get('cf-connecting-ip') || 'ip?' })).success;
      return ok ? report(req, env) : json({ error: 'too many reports, try again in a minute' }, 429);
    }
    if (url.pathname === '/push' && req.method === 'POST') {
      const ok = !env.PUSH_LIMIT || (await env.PUSH_LIMIT.limit({ key: req.headers.get('cf-connecting-ip') || 'ip?' })).success;
      return ok ? push(req, env) : json({ error: 'too many pushes, try again in a minute' }, 429);
    }
    const m = url.pathname.match(/^\/feedback\/(\d{1,9})(\/reply)?$/);
    if (m && !m[2] && req.method === 'GET') return answers(Number(m[1]), url.searchParams.get('key') || '', env);
    if (m && m[2] && req.method === 'POST') return reply(req, Number(m[1]), url.searchParams.get('key') || '', env);
    return json({ error: 'not found' }, 404);
  },
};
