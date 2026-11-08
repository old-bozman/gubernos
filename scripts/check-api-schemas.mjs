#!/usr/bin/env node
// Sends every schema the app gives the model for a one-shot answer to the real Anthropic API once (Haiku, a tiny request each: well under a cent
// in all), as lib/llm.js converts it for the Claude API. The API checks schemas itself and refuses some that Claude Code
// and Codex take; run this after changing a schema. Needs the key (scripts/setup.sh key on).
//   node scripts/check-api-schemas.mjs
import Anthropic from '@anthropic-ai/sdk';
import { apiKey } from '../lib/anthropic.js';
import { _test } from '../lib/llm.js';
import { SCHEMA as triage } from '../lib/triage.js';
import { SCHEMA as voice } from '../lib/voice.js';
import { LISTS as importLists } from '../lib/import.js';
import { ESTIMATES as planner } from '../lib/planner.js';
import { DATE_SPEC_SCHEMA as dateSpec } from '../lib/dates.js';

if (!apiKey()) { console.error('no Anthropic API key here (scripts/setup.sh key on)'); process.exit(1); }
const S = {
  triage, voice, importLists, planner, // chat turns (lib/chat.js, the interview) put their schema in the prompt instead (lib/anthropic.js turn)
  dateSpec: { type: 'object', required: ['when'], properties: { when: dateSpec } },
  importCategories: { type: 'object', required: ['categories'], properties: { categories: { type: 'array', items: { enum: ['work', 'home'] } } } },
  why: { type: 'object', required: ['reason', 'better'], properties: { reason: { type: 'string' }, better: { type: ['integer', 'null'] } } },
};
const api = new Anthropic({ apiKey: apiKey(), baseURL: process.env.GUBERNOS_API_URL || undefined });
let bad = 0;
for (const [name, schema] of Object.entries(S)) {
  try {
    const r = await api.messages.create({ model: 'claude-haiku-5-5', max_tokens: 2000, thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: 'Give a short, valid example answer.' }], output_config: { format: { type: 'json_schema', schema: _test.apiSchema(schema) } } });
    JSON.parse(r.content.find((c) => c.type === 'text')?.text || '');
    console.log(`✓ ${name}`);
  } catch (e) { bad++; console.log(`✗ ${name}: ${String(e.message).slice(0, 300)}`); }
}
process.exit(bad ? 1 : 0);
