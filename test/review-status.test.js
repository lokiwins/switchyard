import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewLabel, reviewReasons } from '../public/review-status.js';

test('a review\'s badge: reviewing, passed, changes asked for, or no verdict', () => {
  assert.deepEqual(reviewLabel({ state: 'reviewing' }), { text: 'Reviewing…', tone: 'is-running' });
  assert.deepEqual(reviewLabel({ state: 'passed' }), { text: 'Review passed', tone: 'is-passed' });
  assert.deepEqual(reviewLabel({ state: 'changes' }), { text: 'Review: changes asked for', tone: 'is-failed' });
  assert.deepEqual(reviewLabel({ state: 'no verdict' }), { text: 'Review: no verdict', tone: 'is-stale' });
});

test('the reasons are the reviewer\'s reply without its VERDICT word', () => {
  assert.equal(reviewReasons('VERDICT: CHANGES — tax is skipped on refunds.'), 'tax is skipped on refunds.');
  assert.equal(reviewReasons('VERDICT: PASS. Covered by tests.'), 'Covered by tests.');
  assert.equal(reviewReasons('Still reading the diff'), 'Still reading the diff');
  assert.equal(reviewReasons(null), '');
});

test('a reviewer waiting on you says so', () => {
  assert.deepEqual(reviewLabel({ state: 'needs you' }), { text: 'Review: needs you', tone: 'is-needs-you' });
});
