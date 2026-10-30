import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  INTERRUPTED_ATTENTION_MS, PARKED_AFTER_MS, deriveFlags, findWorktreeForPath, isParked, matchPr, needsAttention,
} from '../src/state.js';

const clean = { changed: 0, untracked: 0, conflicted: 0, ahead: 0, behind: 0, upstream: 'origin/x' };

test('findWorktreeForPath prefers the deepest containing worktree and ignores prefix lookalikes', () => {
  const paths = ['/work/repo', '/work/repo/nested', '/work/repo-feature'];
  assert.equal(findWorktreeForPath(paths, '/work/repo/nested/src'), '/work/repo/nested');
  assert.equal(findWorktreeForPath(paths, '/work/repo-feature'), '/work/repo-feature');
  assert.equal(findWorktreeForPath(paths, '/work/repo-featurex'), null);
});

test('matchPr prefers an open PR, then the most recently updated', () => {
  const prs = [
    { number: 1, headRefName: 'feat', state: 'MERGED', updatedAt: '2026-01-03T00:00:00Z' },
    { number: 2, headRefName: 'feat', state: 'OPEN', updatedAt: '2026-01-01T00:00:00Z' },
    { number: 3, headRefName: 'other', state: 'OPEN', updatedAt: '2026-01-05T00:00:00Z' },
  ];
  assert.equal(matchPr(prs, 'feat').number, 2);
  assert.equal(matchPr(prs.slice(0, 1), 'feat').number, 1);
  assert.equal(matchPr(prs, 'missing'), null);
});

test('matchPr never matches long-lived branch names', () => {
  assert.equal(matchPr([{ number: 9, headRefName: 'main', state: 'OPEN', updatedAt: '2026-01-01' }], 'main'), null);
});

test('deriveFlags marks merged, clean, agent-free linked worktrees for cleanup', () => {
  const flags = deriveFlags({ isMain: false, status: clean, pr: { state: 'MERGED' }, liveSessions: [] });
  assert.deepEqual(flags, ['cleanup']);
});

test('deriveFlags does not suggest cleanup for dirty, main, or agent-occupied worktrees', () => {
  const merged = { state: 'MERGED' };
  assert.ok(!deriveFlags({ isMain: false, status: { ...clean, changed: 1 }, pr: merged, liveSessions: [] }).includes('cleanup'));
  assert.ok(!deriveFlags({ isMain: true, status: clean, pr: merged, liveSessions: [] }).includes('cleanup'));
  assert.ok(!deriveFlags({ isMain: false, status: clean, pr: merged, liveSessions: [{ status: 'idle' }] }).includes('cleanup'));
});

test('deriveFlags surfaces open-PR problems and waiting agents as attention', () => {
  const flags = deriveFlags({
    isMain: false,
    status: { ...clean, behind: 3 },
    pr: { state: 'OPEN', checks: { state: 'failing' }, reviewDecision: 'CHANGES_REQUESTED', mergeStateStatus: 'DIRTY' },
    liveSessions: [{ status: 'idle', statusUpdatedAt: Date.now() }, { status: 'busy' }],
  });
  assert.deepEqual(flags, ['agent-busy', 'agent-waiting', 'behind', 'checks-failing', 'changes-requested', 'merge-conflict']);
  assert.equal(needsAttention(flags), true);
  assert.equal(needsAttention(['dirty', 'behind', 'agent-busy']), false);
});

test('idle sessions untouched for over a day are parked and do not need attention', () => {
  const now = 10 * PARKED_AFTER_MS;
  const stale = { status: 'idle', statusUpdatedAt: now - PARKED_AFTER_MS - 1 };
  const fresh = { status: 'idle', statusUpdatedAt: now - 1000 };

  assert.equal(isParked(stale, now), true);
  assert.equal(isParked(fresh, now), false);
  assert.equal(isParked({ status: 'busy', statusUpdatedAt: 0 }, now), false);
  assert.equal(isParked({ ...stale, needsYou: true }, now), false);
  assert.deepEqual(deriveFlags({ isMain: true, status: clean, pr: null, liveSessions: [stale] }, now), []);
  assert.deepEqual(deriveFlags({ isMain: true, status: clean, pr: null, liveSessions: [fresh] }, now), ['agent-waiting']);
});

test('a recently interrupted session flags its worktree for attention unless an agent is running there', () => {
  const now = 10 * INTERRUPTED_ATTENTION_MS;
  const interrupted = { updatedAt: now - 1000, transcript: { endState: 'interrupted' } };
  const flags = deriveFlags({ isMain: false, status: clean, pr: null, liveSessions: [], lastSession: interrupted }, now);
  assert.deepEqual(flags, ['agent-interrupted']);
  assert.equal(needsAttention(flags), true);

  const running = deriveFlags({ isMain: false, status: clean, pr: null, liveSessions: [{ status: 'busy' }], lastSession: interrupted }, now);
  assert.ok(!running.includes('agent-interrupted'));
  const old = { ...interrupted, updatedAt: now - INTERRUPTED_ATTENTION_MS - 1 };
  assert.deepEqual(deriveFlags({ isMain: false, status: clean, pr: null, liveSessions: [], lastSession: old }, now), []);
  const finished = { ...interrupted, transcript: { endState: 'finished' } };
  assert.deepEqual(deriveFlags({ isMain: false, status: clean, pr: null, liveSessions: [], lastSession: finished }, now), []);
});
