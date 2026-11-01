// Gmail: read (search, thread) for the agents; draft + send only from the app after the owner confirms in the UI.
// AICODE-NOTE: agents never get send/draft — those are app endpoints behind a confirmation card (see AGENTS.md).
import { httpError } from './vault.js';
import { gfetch } from './google.js';

const API = process.env.GUBERNOS_GMAIL_API || 'https://gmail.googleapis.com/gmail/v1/users/me'; // overridable for tests
const gapi = (method, url, body) => gfetch('gmail', API, method, url, body);
export const threadLink = (id) => `https://mail.google.com/mail/u/0/#all/${id}`;

const header = (m, name) => (m.payload?.headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
const b64 = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

// Plain text of a message: text/plain part if any, else text/html stripped.
function bodyText(payload) {
  const parts = [];
  const walk = (p) => { if (!p) return; parts.push(p); (p.parts || []).forEach(walk); };
  walk(payload);
  const plain = parts.find((p) => p.mimeType === 'text/plain' && p.body?.data);
  if (plain) return b64(plain.body.data);
  const html = parts.find((p) => p.mimeType === 'text/html' && p.body?.data);
  if (!html) return '';
  return b64(html.body.data).replace(/<(style|script)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
// Drop the quoted history ("On … wrote:" and "> " lines) — the earlier messages are in the thread anyway.
const unquote = (t) => t.split(/\n(?:On .{5,200} wrote:|Op .{5,200} schreef .{0,80}:|\S.{0,200} пишет:|-----Original Message-----)\s*\n/)[0]
  .split('\n').filter((l) => !/^>/.test(l)).join('\n').trim();
const attachments = (payload) => {
  const out = [];
  const walk = (p) => { if (!p) return; if (p.filename) out.push(p.filename); (p.parts || []).forEach(walk); };
  walk(payload);
  return out;
};

// Gmail search syntax: "from:caroline invoice newer_than:30d".
export async function search({ query, max = 10 }) {
  if (!String(query || '').trim()) throw httpError(400, 'query required');
  const r = await gapi('GET', `/threads?${new URLSearchParams({ q: query, maxResults: String(Math.min(Number(max) || 10, 25)) })}`);
  return Promise.all((r.threads || []).map(async (t) => {
    const th = await gapi('GET', `/threads/${t.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
    const first = th.messages[0], last = th.messages[th.messages.length - 1];
    return { id: t.id, subject: header(first, 'Subject') || '(no subject)', from: header(last, 'From'), date: header(last, 'Date'),
      messages: th.messages.length, unread: th.messages.some((m) => (m.labelIds || []).includes('UNREAD')), snippet: last.snippet || t.snippet || '', link: threadLink(t.id) };
  }));
}

export async function thread(id, { maxChars = 12000 } = {}) {
  if (!id) throw httpError(400, 'thread id required');
  const th = await gapi('GET', `/threads/${encodeURIComponent(id)}?format=full`);
  const msgs = th.messages.map((m) => ({
    id: m.id, from: header(m, 'From'), to: header(m, 'To'), cc: header(m, 'Cc') || null, date: header(m, 'Date'),
    subject: header(m, 'Subject'), messageId: header(m, 'Message-ID') || header(m, 'Message-Id'),
    text: unquote(bodyText(m.payload)), attachments: attachments(m.payload),
  }));
  // Keep the newest messages whole when the thread is long.
  let budget = maxChars;
  for (let i = msgs.length - 1; i >= 0; i--) { msgs[i].text = budget > 0 ? msgs[i].text.slice(0, budget) : '(older message trimmed)'; budget -= msgs[i].text.length; }
  return { id: th.id, subject: msgs[0]?.subject || '', link: threadLink(th.id), messages: msgs };
}

// RFC 2822 message, UTF-8 everywhere; replying keeps the thread (In-Reply-To/References + threadId).
const encWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
// "Имя <a@b>, c@d" → non-ASCII display names as encoded words.
const encAddrs = (list) => (String(list).match(/(?:"[^"]*"|[^,])+/g) || []).map((x) => x.trim()).filter(Boolean)
  .map((x) => x.replace(/^"?([^"<]*?)"?\s*<([^>]+)>$/, (m, name, addr) => (!name ? `<${addr}>` : /^[\x20-\x7e]*$/.test(name) ? `"${name.trim()}" <${addr}>` : `${encWord(name.trim())} <${addr}>`))).join(', ');
async function compose({ to, cc, subject, body, threadId }) {
  if (!String(to || '').trim()) throw httpError(400, 'to required');
  if (!String(body || '').trim()) throw httpError(400, 'body required');
  let subj = String(subject || '').trim(), refs = '';
  if (threadId) {
    const th = await gapi('GET', `/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=Subject`);
    const last = th.messages[th.messages.length - 1];
    const mid = header(last, 'Message-ID');
    refs = mid ? `In-Reply-To: ${mid}\r\nReferences: ${[header(last, 'References'), mid].filter(Boolean).join(' ')}\r\n` : '';
    if (!subj) subj = header(th.messages[0], 'Subject');
    if (subj && !/^(re|aw|antw):/i.test(subj)) subj = `Re: ${subj}`;
  }
  const raw = `To: ${encAddrs(to)}\r\n${cc ? `Cc: ${encAddrs(cc)}\r\n` : ''}Subject: ${encWord(subj || '(no subject)')}\r\n${refs}MIME-Version: 1.0\r\n`
    + `Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(String(body).replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64')}`;
  return { raw: Buffer.from(raw, 'utf8').toString('base64url'), subject: subj, ...(threadId ? { threadId } : {}) };
}

export async function send(msg) {
  const { raw, threadId, subject } = await compose(msg);
  const r = await gapi('POST', '/messages/send', { raw, ...(threadId ? { threadId } : {}) });
  return { id: r.id, threadId: r.threadId, subject, link: threadLink(r.threadId) };
}

export async function draft(msg) {
  const { raw, threadId, subject } = await compose(msg);
  const r = await gapi('POST', '/drafts', { message: { raw, ...(threadId ? { threadId } : {}) } });
  return { id: r.id, threadId: r.message?.threadId, subject, link: 'https://mail.google.com/mail/u/0/#drafts' };
}
