// A web page → its title, site, description and readable text (no dependencies: the main <article> / <main> / <body>
// with scripts, menus and footers taken out, paragraphs kept). Used for links shared to the inbox (the iPhone's
// Share → Gubernos): the text is kept in the item, so it can be read and triaged without the page.
const MAX_HTML = 3e6, MAX_TEXT = 20000;

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©' };
const decode = (s) => s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});
const meta = (html, key) => {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  return tag ? decode(tag.match(/content=["']([^"']*)["']/i)?.[1] || '').trim() || null : null;
};

export function extract(html) {
  const title = meta(html, 'og:title') || decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim() || null;
  const site = meta(html, 'og:site_name');
  const description = meta(html, 'og:description') || meta(html, 'description');
  let part = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|noscript|svg|template|iframe|form|button|select)[\s\S]*?<\/\1>/gi, ' ');
  const pick = (tag) => { const m = part.match(new RegExp(`<${tag}[\\s>][\\s\\S]*<\\/${tag}>`, 'i')); return m ? m[0] : null; };
  part = pick('article') || pick('main') || pick('body') || part;
  part = part.replace(/<(nav|header|footer|aside)[\s\S]*?<\/\1>/gi, ' ');
  const text = decode(part
    .replace(/<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi, (_, h, t) => `\n\n${'#'.repeat(Math.min(6, +h[1] + 1))} ${t.replace(/<[^>]+>/g, '').trim()}\n\n`)
    .replace(/<li[^>]*>/gi, '\n- ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|section|li|blockquote|pre|tr)>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' '))
    .split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).filter((l, i, a) => l || (a[i - 1] && a[i - 1] !== ''))
    .join('\n').replace(/\n{3,}/g, '\n\n').replace(/^- *$/gm, '').trim();
  // a page that is mostly an app shell (a Telegram post, a tweet): its description is the content
  const body = text.length < 400 || (description && description.length > text.length / 2) ? (description || text) : text;
  return { title, site, description, text: body.length > MAX_TEXT ? `${body.slice(0, MAX_TEXT).replace(/\s+\S*$/, '')} …` : body };
}

export async function fetchArticle(url, { timeoutMs = 15000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { redirect: 'follow', signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', Accept: 'text/html,application/xhtml+xml' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (!/html|xml/i.test(r.headers.get('content-type') || '')) throw new Error(`not a page (${r.headers.get('content-type') || 'no type'})`);
    const buf = await r.arrayBuffer();
    const html = new TextDecoder().decode(buf.byteLength > MAX_HTML ? buf.slice(0, MAX_HTML) : buf);
    return { ...extract(html), url: r.url || url };
  } finally { clearTimeout(t); }
}
