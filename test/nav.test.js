import assert from 'node:assert/strict';
import { test } from 'node:test';
import { navCounts } from '../src/nav.js';

test('navCounts badges agents waiting on you plus recently interrupted sessions', () => {
  const { agents } = navCounts({
    state: {
      liveSessions: [{ status: 'idle' }, { status: 'idle', parked: true }, { status: 'busy' }],
      endedSessions: [{ needsAttention: true }, { needsAttention: false }],
    },
    prs: null,
  });
  assert.deepEqual(agents, { count: 2, working: 1, waiting: 1, interrupted: 1, tone: 'amber' });
});

test('navCounts badges PRs needing fixes in red, otherwise review requests in purple', () => {
  const fixes = navCounts({
    state: null,
    prs: { authored: [{ stage: 'checks-failing' }, { stage: 'awaiting-review' }], reviewRequested: [{}] },
  }).prs;
  assert.deepEqual(fixes, { count: 2, needFixes: 1, reviewRequests: 1, tone: 'red' });

  const reviewsOnly = navCounts({ state: null, prs: { authored: [{ stage: 'ready' }], reviewRequested: [{}, {}] } }).prs;
  assert.equal(reviewsOnly.tone, 'purple');
  assert.equal(reviewsOnly.count, 2);
});

test('navCounts is quiet before data loads', () => {
  const counts = navCounts({ state: null, prs: null });
  assert.equal(counts.agents.count, 0);
  assert.equal(counts.agents.tone, null);
  assert.equal(counts.prs.tone, null);
});
