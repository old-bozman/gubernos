#!/usr/bin/env node
// gubernos-tools: a tiny stdio MCP server with READ-ONLY integrations for agents (task chat, Ask, ▶ Run — Claude Code, Codex or
// see lib/llm.js — or any agent session). Sending mail / creating events is never here — the app proposes those
// and the owner confirms.
// Plug in: claude --mcp-config '{"mcpServers":{"gubernos-tools":{"command":"node","args":["<repo>/tools/gubernos-tools.js"]}}}'
// AICODE-NOTE: newline-delimited JSON-RPC 2.0 (MCP stdio transport), no SDK; stdout is protocol only — log to stderr.
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import * as Gmail from '../lib/gmail.js';
import * as Cal from '../lib/calendar.js';
import * as Contacts from '../lib/contacts.js';
import * as Drive from '../lib/drive.js';

const TOOLS = [
  {
    name: 'gmail_search',
    description: "Search the owner's Gmail (Gmail search syntax: from:, to:, subject:, newer_than:30d, has:attachment, is:unread …). Returns threads: id, subject, last sender, date, snippet, link.",
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, max: { type: 'integer', description: 'default 10, max 25' } }, required: ['query'] },
    run: (a) => Gmail.search({ query: a.query, max: a.max }),
  },
  {
    name: 'gmail_thread',
    description: 'Read one Gmail thread as plain text (quoted history removed): every message with from/to/date/text/attachment names, plus a link.',
    inputSchema: { type: 'object', properties: { thread_id: { type: 'string' } }, required: ['thread_id'] },
    run: (a) => Gmail.thread(a.thread_id),
  },
  {
    name: 'calendar_events',
    description: "The owner's calendar events between two local dates (YYYY-MM-DD, inclusive; to defaults to from).",
    inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from'] },
    run: (a) => Cal.listEvents({ from: a.from, to: a.to }),
  },
  {
    name: 'contacts_search',
    description: "Find people in the owner's Google Contacts and the people they have emailed: name, emails, phones, company. Use it for an email address or to know who someone is.",
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'a name, part of a name, or an email' } }, required: ['query'] },
    run: (a) => Contacts.search({ query: a.query }),
  },
  {
    name: 'drive_search',
    description: "Search the owner's Google Drive by file name and content. Returns id, name, type, modified, owner, link.",
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, max: { type: 'integer', description: 'default 10' } }, required: ['query'] },
    run: (a) => Drive.search({ query: a.query, max: a.max }),
  },
  {
    name: 'drive_read',
    description: 'Read one Google Drive file as text (Google Docs and Slides as text, Sheets as CSV, text files as is; other types: name and link only).',
    inputSchema: { type: 'object', properties: { file_id: { type: 'string' } }, required: ['file_id'] },
    run: (a) => Drive.read(a.file_id),
  },
];
export const TOOL_NAMES = TOOLS.map((t) => `mcp__gubernos-tools__${t.name}`);
// This server as an MCP config entry (GUBERNOS_* env is passed on, so tests can point it at stubs); lib/llm.js hands it to the CLI.
export function mcpServer() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('GUBERNOS_') || k === 'PORT'));
  return { command: process.execPath, args: [fileURLToPath(import.meta.url)], env };
}

const reply = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
const fail = (id, code, message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`);

async function handle(msg) {
  const { id, method, params = {} } = msg;
  if (id === undefined) return; // notifications (initialized, cancelled)
  if (method === 'initialize') {
    return reply(id, { protocolVersion: params.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'gubernos-tools', version: '1.0.0' } });
  }
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') return reply(id, { tools: TOOLS.map(({ run, ...t }) => t) });
  if (method === 'tools/call') {
    const tool = TOOLS.find((t) => t.name === params.name);
    if (!tool) return fail(id, -32602, `unknown tool ${params.name}`);
    try {
      const out = await tool.run(params.arguments || {});
      return reply(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }] });
    } catch (e) {
      return reply(id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
    }
  }
  return fail(id, -32601, `method not found: ${method}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return fail(null, -32700, 'parse error'); }
    handle(msg).catch((e) => process.stderr.write(`gubernos-tools: ${e.stack}\n`));
  });
}
