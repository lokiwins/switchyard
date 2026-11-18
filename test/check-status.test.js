import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkLabel, hasFailedCheck } from '../public/check-status.js';

test('a check\'s label and tone, by its name: running, waiting, passed, failed with its exit code or why, interrupted', () => {
  assert.deepEqual(checkLabel({ name: 'lint', state: 'running' }), { text: 'lint: checking…', tone: 'is-running' });
  assert.deepEqual(checkLabel({ name: 'test', state: 'queued' }), { text: 'test: waiting', tone: 'is-running' });
  assert.deepEqual(checkLabel({ name: 'lint', state: 'passed', exitCode: 0, outOfDate: false }), { text: 'lint passed', tone: 'is-passed' });
  assert.deepEqual(checkLabel({ name: 'test', state: 'failed', exitCode: 1, outOfDate: false }), { text: 'test failed (exit 1)', tone: 'is-failed' });
  assert.deepEqual(checkLabel({ name: 'test', state: 'failed', exitCode: null, detail: 'Stopped after 10 minutes', outOfDate: false }), { text: 'test failed: Stopped after 10 minutes', tone: 'is-failed' });
  assert.deepEqual(checkLabel({ name: 'lint', state: 'interrupted' }), { text: 'lint interrupted', tone: 'is-stale' });
});

test('a repo\'s single check is just "Check"', () => {
  assert.deepEqual(checkLabel({ name: 'check', state: 'passed', exitCode: 0, outOfDate: false }), { text: 'Check passed', tone: 'is-passed' });
});

test('a result from before the worktree changed says so, and is shown muted', () => {
  assert.deepEqual(checkLabel({ name: 'test', state: 'passed', exitCode: 0, outOfDate: true }), { text: 'test passed · out of date', tone: 'is-stale' });
});

test('a task has a failed check when any of its worktrees\' current checks failed', () => {
  const work = (checks) => ({ path: '/w', checks });
  assert.equal(hasFailedCheck({ work: [work([{ state: 'passed', outOfDate: false }, { state: 'failed', outOfDate: false }])] }), true);
  assert.equal(hasFailedCheck({ work: [work([{ state: 'failed', outOfDate: true }])] }), false, 'out of date: it may pass now');
  assert.equal(hasFailedCheck({ work: [work([]), work([{ state: 'running' }]), { path: '/x' }] }), false);
});
