import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkLabel, hasFailedCheck } from '../public/check-status.js';

test('a check\'s label and tone: running, passed, failed with its exit code or why, interrupted', () => {
  assert.deepEqual(checkLabel({ state: 'running' }), { text: 'Checking…', tone: 'is-running' });
  assert.deepEqual(checkLabel({ state: 'passed', exitCode: 0, outOfDate: false }), { text: 'Check passed', tone: 'is-passed' });
  assert.deepEqual(checkLabel({ state: 'failed', exitCode: 1, outOfDate: false }), { text: 'Check failed (exit 1)', tone: 'is-failed' });
  assert.deepEqual(checkLabel({ state: 'failed', exitCode: null, detail: 'Stopped after 10 minutes', outOfDate: false }), { text: 'Check failed: Stopped after 10 minutes', tone: 'is-failed' });
  assert.deepEqual(checkLabel({ state: 'interrupted', detail: 'switchyard restarted while it ran' }), { text: 'Check interrupted', tone: 'is-stale' });
});

test('a result from before the worktree changed says so, and is shown muted', () => {
  assert.deepEqual(checkLabel({ state: 'passed', exitCode: 0, outOfDate: true }), { text: 'Check passed · out of date', tone: 'is-stale' });
  assert.deepEqual(checkLabel({ state: 'failed', exitCode: 2, outOfDate: true }), { text: 'Check failed (exit 2) · out of date', tone: 'is-stale' });
});

test('a task has a failed check when any of its worktrees\' latest, current check failed', () => {
  const work = (check) => ({ path: '/w', check });
  assert.equal(hasFailedCheck({ work: [work({ state: 'passed', outOfDate: false }), work({ state: 'failed', outOfDate: false })] }), true);
  assert.equal(hasFailedCheck({ work: [work({ state: 'failed', outOfDate: true })] }), false, 'out of date: it may pass now');
  assert.equal(hasFailedCheck({ work: [work(null), work({ state: 'running' })] }), false);
  assert.equal(hasFailedCheck({ work: [] }), false);
});
