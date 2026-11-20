// Gemini's deep model busy (2026-11-20: gemini-4-hydrogen answered 503 "high demand" after a minute): the quick model
// answers that request instead of an error. Other errors, and the quick model's own, are not hidden.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adapt, MODELS } from '../lib/gemini-loop.js';

const ok = { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'hi' }] }], usage: {} };
const ask = (model) => ({ model, max_tokens: 100, messages: [{ role: 'user', content: 'hello' }] });

test('the deep model busy or out of its daily quota → the quick one answers', async () => {
  for (const err of [{ status: 503, message: 'high demand' }, { status: 429, message: 'quota per day' }, { message: 'the free Gemini quota is used up for now' }, { status: 0, message: 'The operation was aborted due to timeout' }, { message: 'Gemini API 503: busy' }]) {
    const seen = [];
    const send = adapt(async (b) => { seen.push(b.model); if (b.model === MODELS.sonnet) throw Object.assign(new Error(err.message), err); return ok; });
    const r = await send(ask(MODELS.sonnet));
    assert.equal(r.content[0].text, 'hi');
    assert.deepEqual(seen, [MODELS.sonnet, MODELS.haiku], err.message);
  }
});

test('a bad key, or the quick model busy or out of quota: the error stays', async () => {
  const fail = (status, message) => adapt(async () => { throw Object.assign(new Error(message), { status }); });
  await assert.rejects(fail(400, 'API key not valid')(ask(MODELS.sonnet)), /not valid/);
  await assert.rejects(fail(429, 'quota per day')(ask(MODELS.haiku)), /quota/);
  await assert.rejects(fail(503, 'high demand')(ask(MODELS.haiku)), /high demand/);
});

// AI Studio's newer keys start with AQ. (2026-11-20, a fresh key): Google's, and not refused as "not a key"
test('an AQ. key is Google’s', async () => {
  const { vendorOf } = await import('../lib/anthropic.js');
  assert.equal(vendorOf('AQ.test-not-a-real-key-000000000000'), 'google');
  assert.equal(vendorOf('AIza-test-gemini-key-not-real'), 'google');
  assert.equal(vendorOf('sk-proj-test'), 'openai');
});

test('a key copied across a line break is still the same key', async () => {
  const { vendorOf } = await import('../lib/anthropic.js');
  assert.equal(vendorOf(' AQ.test-not-a-real\n key-000000 '), 'google');
});
