#!/usr/bin/env node
// A task run on the Claude API (lib/anthropic.js), started by lib/runner.js through lib/llm.js agentRun: it prints Claude Code's
// stream-json lines (each response as an "assistant" message, then a "result"), so the runner shows, logs and stops it like a
// Claude Code run (stopping = killing this process).
//   node scripts/api-agent.mjs "<prompt>"     (in the vault: the current folder is where its file tools work)
import { loop, toolset, MODELS, price, why } from '../lib/anthropic.js';

const prompt = String(process.argv[2] || '').trim();
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const model = MODELS.sonnet;
const system = `You are an autonomous agent working in a folder of plain Markdown files: the owner's vault (their tasks, projects and notes).
Use the tools to read, search and change files; paths are relative to the vault. Work carefully: read a file before you edit it, change only what the task needs.
You can search and read the web, and read the owner's Gmail, Calendar, Contacts and Drive. Nothing you do sends anything to anyone.
Now: ${new Date().toString()}.`;

let spent = 0, turns = 0;
try {
  if (!prompt) throw new Error('no prompt');
  const r = await loop({ model, system, messages: [{ role: 'user', content: prompt }], tools: toolset({ write: true, web: true }), root: process.cwd(), effort: 'medium', maxTurns: 80,
    onResponse: (m) => { spent += price(model, m.usage) || 0; turns++; out({ type: 'assistant', message: { content: m.content } }); } });
  out({ type: 'result', result: r.text, total_cost_usd: spent, num_turns: turns, is_error: false });
} catch (e) {
  out({ type: 'result', result: why(e), total_cost_usd: spent, num_turns: turns, is_error: true });
  process.exitCode = 1;
}
