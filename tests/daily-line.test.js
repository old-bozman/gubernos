// The evening "Plan:" line follows the plan's marks: a #1 ticked after the line was written read "#1 ✗" for good
// (2026-11-07, -10-18, -11-08 in Alex's vault), also in the morning brief.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlan, formatPlan } from '../lib/daily.js';

test('a #1 ticked after the evening line counts as done', () => {
  const p = parsePlan('- [x] #1: Be with my family · [[20261106-224553-be-with-my-family]]\n- [ ] [[a]]\n- [x] [[b]] · 30 min\n\nPlan: 0/2 · #1 ✗ · 1 moved');
  assert.deepEqual(p.line, { done: 1, planned: 2, one: true, moved: 1 });
  assert.match(formatPlan(p), /Plan: 1\/2 · #1 ✓ · 1 moved$/);
});

test('a #1 linked to a planned task that is done counts too; no #1 keeps the line as it is', () => {
  assert.equal(parsePlan('- #1: Ship it · [[t1]]\n- [x] [[t1]]\n\nPlan: 0/1 · #1 ✗').line.one, true);
  assert.equal(parsePlan('- #1: Ship it\n\nPlan: 0/0 · #1 ✗').line.one, false);
  assert.deepEqual(parsePlan('- [ ] [[a]]\n\nPlan: 0/1').line, { done: 0, planned: 1, one: null, moved: 0 });
});
