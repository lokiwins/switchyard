import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createSwrCache } from '../src/cache.js';
import { createStateService } from '../src/state.js';
import { createStatusTracker } from '../src/status-tracker.js';

// A real repo with a linked worktree on "feat" and a GitHub remote; GitHub itself is faked.
let root;
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { stdio: 'pipe' });

before(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'switchyard-state-')));
  execFileSync('git', ['init', '-q', '-b', 'main', join(root, 'web')]);
  git(join(root, 'web'), 'commit', '-q', '--allow-empty', '-m', 'init');
  git(join(root, 'web'), 'remote', 'add', 'origin', 'git@github.com:acme/web.git');
  git(join(root, 'web'), 'worktree', 'add', '-q', join(root, 'web-feat'), '-b', 'feat');
});
after(() => rm(root, { recursive: true, force: true }));

const claude = {
  liveSessions: async () => [],
  latestSession: async () => null,
  recentSessions: async () => [],
  endedSessions: async () => [],
};
const openPr = { number: 5, state: 'OPEN', headRefName: 'feat', title: 'Feat', url: 'https://github.com/acme/web/pull/5', updatedAt: '2026-11-01T00:00:00Z' };

function setup({ synced = true, now = Date.now } = {}) {
  const calls = { branchPrs: [], details: [] };
  const tracker = createStatusTracker();
  const service = createStateService({
    config: { roots: [root] },
    claude,
    cache: createSwrCache({ now }),
    statusTracker: tracker,
    github: {
      fetchBranchPrs: async (requests) => { calls.branchPrs.push(requests); return { byRepo: { 'acme/web': [openPr] }, errors: [] }; },
      fetchPrDetails: async (refs) => { calls.details.push(refs); return [{ checks: { state: 'pending' }, mergeStateStatus: 'BLOCKED' }]; },
    },
    prSnapshot: () => ({
      loaded: true,
      authored: [{ number: 5, url: openPr.url, repository: { nameWithOwner: 'acme/web' } }],
      entries: new Map(synced
        ? [['acme/web#5', { pr: { checks: { state: 'failing' }, mergeStateStatus: 'CLEAN', reviewDecision: 'APPROVED', isDraft: false } }]]
        : []),
    }),
  });
  return { service, calls, close: () => tracker.close() };
}

const featWorktree = (state) => state.repos[0].worktrees.find((w) => w.branch === 'feat');

test("one batched query finds every branch's PR, and the PR sync supplies its checks", async () => {
  const { service, calls, close } = setup();
  const state = await service.getState();
  close();
  assert.deepEqual(calls.branchPrs, [[{ repo: 'acme/web', branches: ['feat'] }]]);
  assert.deepEqual(calls.details, []);
  const pr = featWorktree(state).pr;
  assert.equal(pr.number, 5);
  assert.equal(pr.checks.state, 'failing');
  assert.equal(pr.reviewDecision, 'APPROVED');
  assert.ok(featWorktree(state).flags.includes('checks-failing'));
});

test("a PR the sync doesn't track (someone else's) still gets its checks fetched", async () => {
  const { service, calls, close } = setup({ synced: false });
  const state = await service.getState();
  close();
  assert.deepEqual(calls.details, [[{ repo: 'acme/web', number: 5 }]]);
  assert.equal(featWorktree(state).pr.checks.state, 'pending');
});

const waitFor = async (condition) => {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((r) => setTimeout(r, 20));
};

test('once a new worktree shows up, its branch is looked up right away instead of after the PR cache expires', async () => {
  let time = 0;
  const { service, calls, close } = setup({ now: () => time });
  await service.getState();
  git(join(root, 'web'), 'worktree', 'add', '-q', join(root, 'web-fix'), '-b', 'fix');

  // Everything is stale: this rebuild still sees the old repo list but refreshes it (and the PRs) in the background.
  time += 61_000;
  await service.getState();
  await waitFor(() => calls.branchPrs.length >= 2);
  await new Promise((r) => setTimeout(r, 50));

  // A few seconds later the PR data is fresh, but the branch list has changed, so it is fetched again now.
  time += 4_000;
  await service.getState();
  await waitFor(() => calls.branchPrs.length >= 3);
  close();
  assert.deepEqual(calls.branchPrs.at(-1), [{ repo: 'acme/web', branches: ['feat', 'fix'] }]);
});
