// Google Drive, read-only: find the documents a task refers to and read them as text (Docs → text, Sheets → CSV,
// text files as is; other files: name and link only). Used by the agents through gubernos-tools.
import { gfetch, accessTokenFor } from './google.js';

const API = process.env.GUBERNOS_DRIVE_API || 'https://www.googleapis.com/drive/v3';
const FIELDS = 'files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName))';

export async function search({ query, max = 10 }) {
  const q = String(query || '').trim().replace(/\\/g, '').replace(/'/g, "\\'");
  if (!q) return [];
  const where = `(name contains '${q}' or fullText contains '${q}') and trashed = false`;
  const r = await gfetch('drive', API, 'GET', `/files?${new URLSearchParams({ q: where, pageSize: String(Math.min(Number(max) || 10, 25)), orderBy: 'modifiedTime desc', fields: FIELDS })}`);
  return (r.files || []).map((f) => ({ id: f.id, name: f.name, type: f.mimeType.replace('application/vnd.google-apps.', 'google-'), modified: f.modifiedTime, owner: f.owners?.[0]?.displayName || null, link: f.webViewLink }));
}

export async function read(id, { maxChars = 15000 } = {}) {
  const meta = await gfetch('drive', API, 'GET', `/files/${encodeURIComponent(id)}?fields=id,name,mimeType,modifiedTime,webViewLink`);
  const exportAs = { 'application/vnd.google-apps.document': 'text/plain', 'application/vnd.google-apps.spreadsheet': 'text/csv', 'application/vnd.google-apps.presentation': 'text/plain' }[meta.mimeType];
  let url = null;
  if (exportAs) url = `${API}/files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(exportAs)}`;
  else if (/^text\/|json|csv|markdown/.test(meta.mimeType)) url = `${API}/files/${encodeURIComponent(id)}?alt=media`;
  let text = null;
  if (url) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${await accessTokenFor('drive')}` } });
    text = r.ok ? (await r.text()).slice(0, maxChars) : null;
  }
  return { id: meta.id, name: meta.name, type: meta.mimeType, modified: meta.modifiedTime, link: meta.webViewLink,
    text: text ?? '(not a text document — open the link)' };
}
