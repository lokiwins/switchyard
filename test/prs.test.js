import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLocalIndex, copilotStatus, parsePrRef, prStage, sortByStage } from '../src/prs.js';

const base = {
  isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED',
  reviewDecision: 'REVIEW_REQUIRED', checks: { state: 'passing' },
};

test('prStage picks the most urgent problem first', () => {
  assert.equal(prStage({ ...base, mergeable: 'CONFLICTING', checks: { state: 'failing' } }), 'merge-conflict');
  assert.equal(prStage({ ...base, checks: { state: 'failing' }, reviewDecision: 'CHANGES_REQUESTED' }), 'checks-failing');
  assert.equal(prStage({ ...base, reviewDecision: 'CHANGES_REQUESTED', checks: { state: 'pending' } }), 'changes-requested');
  assert.equal(prStage({ ...base, checks: { state: 'pending' } }), 'checks-running');
  assert.equal(prStage({ ...base, mergeStateStatus: 'BEHIND' }), 'needs-update');
  assert.equal(prStage(base), 'awaiting-review');
});

test('prStage distinguishes ready, blocked, draft and unknown', () => {
  assert.equal(prStage({ ...base, reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN' }), 'ready');
  assert.equal(prStage({ ...base, reviewDecision: '', mergeStateStatus: 'CLEAN' }), 'ready');
  assert.equal(prStage({ ...base, reviewDecision: 'APPROVED', mergeStateStatus: 'BLOCKED' }), 'blocked');
  assert.equal(prStage({ ...base, isDraft: true, checks: { state: 'failing' } }), 'draft');
  assert.equal(prStage({ error: 'gh failed' }), 'unknown');
});

test('sortByStage orders by urgency, then most recently updated', () => {
  const sorted = sortByStage([
    { number: 1, stage: 'awaiting-review', updatedAt: '2026-01-05T00:00:00Z' },
    { number: 2, stage: 'checks-failing', updatedAt: '2026-01-01T00:00:00Z' },
    { number: 3, stage: 'awaiting-review', updatedAt: '2026-01-06T00:00:00Z' },
  ]);
  assert.deepEqual(sorted.map((pr) => pr.number), [2, 3, 1]);
});

test('buildLocalIndex keys worktrees by repo and branch', () => {
  const index = buildLocalIndex({
    repos: [
      {
        github: 'org/repo',
        worktrees: [
          { path: '/w/feat', branch: 'feat', flags: ['dirty'], agents: { live: [{ name: 'a1', status: 'busy' }] } },
          { path: '/w/detached', branch: null, flags: [], agents: { live: [] } },
        ],
      },
      { github: null, worktrees: [{ path: '/w/local', branch: 'feat', flags: [], agents: { live: [] } }] },
    ],
  });
  assert.equal(index.size, 1);
  assert.deepEqual(index.get('org/repo#feat'), {
    path: '/w/feat', dirty: true, agents: [{ name: 'a1', status: 'busy', parked: false }],
  });
});

test('copilotStatus reports the last Copilot review and any pending request', () => {
  const reviewed = copilotStatus({
    reviews: [{ login: 'alice', state: 'APPROVED' }, { login: 'copilot-pull-request-reviewer', state: 'COMMENTED', submittedAt: '2026-01-02T00:00:00Z' }],
    requested: [{ name: 'org/copilot-pull-request-reviewer', isTeam: true }],
  });
  assert.deepEqual(reviewed, { requested: false, lastReviewedAt: '2026-01-02T00:00:00Z' });

  const pending = copilotStatus({ reviews: [], requested: [{ name: 'copilot-pull-request-reviewer', isTeam: false }] });
  assert.deepEqual(pending, { requested: true, lastReviewedAt: null });
});

test('parsePrRef accepts owner/repo and a positive integer, rejecting anything else', () => {
  assert.deepEqual(parsePrRef({ repo: 'org/my.repo', number: '12' }), { repo: 'org/my.repo', number: 12 });
  for (const bad of [{ repo: 'org/repo/../x', number: 1 }, { repo: 'org', number: 1 }, { repo: 'o/r', number: 0 }, { repo: 'o/r', number: 1.5 }, null]) {
    assert.throws(() => parsePrRef(bad), (error) => error.status === 400);
  }
});
