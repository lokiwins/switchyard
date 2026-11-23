import { expect, test } from 'vitest';
import { reviewLabel, reviewReasons } from './review-status';

test('a review\'s badge: reviewing, passed, changes asked for, or no verdict', () => {
  expect(reviewLabel({ state: 'reviewing' })).toStrictEqual({ text: 'Reviewing…', tone: 'is-running' });
  expect(reviewLabel({ state: 'passed' })).toStrictEqual({ text: 'Review passed', tone: 'is-passed' });
  expect(reviewLabel({ state: 'changes' })).toStrictEqual({ text: 'Review: changes asked for', tone: 'is-failed' });
  expect(reviewLabel({ state: 'no verdict' })).toStrictEqual({ text: 'Review: no verdict', tone: 'is-stale' });
});

test('the reasons are the reviewer\'s reply without its VERDICT word', () => {
  expect(reviewReasons('VERDICT: CHANGES — tax is skipped on refunds.')).toBe('tax is skipped on refunds.');
  expect(reviewReasons('VERDICT: PASS. Covered by tests.')).toBe('Covered by tests.');
  expect(reviewReasons('Still reading the diff')).toBe('Still reading the diff');
  expect(reviewReasons(null)).toBe('');
});

test('a reviewer waiting on you says so', () => {
  expect(reviewLabel({ state: 'needs you' })).toStrictEqual({ text: 'Review: needs you', tone: 'is-needs-you' });
});
