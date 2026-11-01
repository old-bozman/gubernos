// node:path (POSIX) for the iOS offline mode — what lib/*.js uses.
const norm = (p) => { const out = []; for (const s of String(p).split('/')) { if (!s || s === '.') continue; if (s === '..') out.pop(); else out.push(s); } return out; };
export const sep = '/';
export function join(...a) { const s = a.filter((x) => x !== '').join('/'); return (s.startsWith('/') ? '/' : '') + norm(s).join('/') || '.'; }
export function resolve(...a) { let s = ''; for (const x of a) s = String(x).startsWith('/') ? x : `${s}/${x}`; return `/${norm(s).join('/')}`; }
export function dirname(p) { const n = norm(p); return (String(p).startsWith('/') ? '/' : '') + n.slice(0, -1).join('/') || (String(p).startsWith('/') ? '/' : '.'); }
export function basename(p, ext = '') { const b = norm(p).pop() || ''; return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b; }
export function extname(p) { const b = basename(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; }
export function relative(from, to) {
  const a = norm(resolve(from)), b = norm(resolve(to));
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}
export const posix = { sep, join, resolve, dirname, basename, extname, relative };
export default posix;
