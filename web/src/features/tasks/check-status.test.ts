import { expect, test } from 'vitest';
import { checkLabel, hasFailedCheck, ranBy } from './check-status';
import type { CheckResult } from './types';

test('a check\'s label and tone, by its name: running, waiting, passed, failed with its exit code or why, interrupted', () => {
  expect(checkLabel({ name: 'lint', state: 'running' })).toStrictEqual({ text: 'lint: checking…', tone: 'is-running' });
  expect(checkLabel({ name: 'test', state: 'queued' })).toStrictEqual({ text: 'test: waiting', tone: 'is-running' });
  expect(checkLabel({ name: 'lint', state: 'passed', exitCode: 0, outOfDate: false })).toStrictEqual({ text: 'lint passed', tone: 'is-passed' });
  expect(checkLabel({ name: 'test', state: 'failed', exitCode: 1, outOfDate: false })).toStrictEqual({ text: 'test failed (exit 1)', tone: 'is-failed' });
  expect(checkLabel({ name: 'test', state: 'failed', exitCode: null, detail: 'Stopped after 10 minutes', outOfDate: false })).toStrictEqual({ text: 'test failed: Stopped after 10 minutes', tone: 'is-failed' });
  expect(checkLabel({ name: 'lint', state: 'interrupted' })).toStrictEqual({ text: 'lint interrupted', tone: 'is-stale' });
});

test('a repo\'s single check is just "Check"', () => {
  expect(checkLabel({ name: 'check', state: 'passed', exitCode: 0, outOfDate: false })).toStrictEqual({ text: 'Check passed', tone: 'is-passed' });
});

test('a result from before the worktree changed says so, and is shown muted', () => {
  expect(checkLabel({ name: 'test', state: 'passed', exitCode: 0, outOfDate: true })).toStrictEqual({ text: 'test passed · out of date', tone: 'is-stale' });
});

test('a task has a failed check when any of its worktrees\' current checks failed', () => {
  const work = (checks?: Pick<CheckResult, 'state' | 'outOfDate'>[]) => ({ path: '/w', checks });
  expect(hasFailedCheck({ work: [work([{ state: 'passed', outOfDate: false }, { state: 'failed', outOfDate: false }])] })).toBe(true);
  expect(hasFailedCheck({ work: [work([{ state: 'failed', outOfDate: true }])] }), 'out of date: it may pass now').toBe(false);
  expect(hasFailedCheck({ work: [work([]), work([{ state: 'running' }]), work()] })).toBe(false);
});

test('what started a check, when it ran by itself', () => {
  expect(ranBy({ trigger: 'after-turn' })).toBe('ran by itself after an agent turn');
  expect(ranBy({ trigger: 'on-commit' })).toBe('ran by itself on a new commit');
  expect(ranBy({ trigger: 'manual' })).toBe(null);
  expect(ranBy({})).toBe(null);
});
