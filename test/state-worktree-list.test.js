import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createSwrCache } from '../src/cache.js';
import { createStateService } from '../src/state.js';
import { createStatusTracker } from '../src/status-tracker.js';

// A real repo with a linked worktree; the tracker's file events are reported by hand.
let root;
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { stdio: 'pipe' });
const claude = {
  liveSessions: async () => [], latestSession: async () => null, recentSessions: async () => [], endedSessions: async () => [],
};

before(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'switchyard-list-')));
  execFileSync('git', ['init', '-q', '-b', 'main', join(root, 'web')]);
  git(join(root, 'web'), 'commit', '-q', '--allow-empty', '-m', 'init');
  git(join(root, 'web'), 'worktree', 'add', '-q', join(root, 'web-feat'), '-b', 'feat');
});
after(() => rm(root, { recursive: true, force: true }));

function setup() {
  const changed = new Set();
  const real = createStatusTracker({ watch: () => { throw new Error('not watched in this test'); } });
  const tracker = {
    ...real,
    takeWorktreeListChanges: () => { const taken = new Set(changed); changed.clear(); return taken; },
  };
  const service = createStateService({ config: { roots: [root] }, claude, cache: createSwrCache(), statusTracker: tracker });
  const branchOf = (data, path) => data.repos.flatMap((r) => r.worktrees).find((w) => w.path === path)?.branch;
  return { service, changed, branchOf };
}

test('a worktree that switched branch shows the new branch on the next build, once its repo is marked changed', async () => {
  const { service, changed, branchOf } = setup();
  const feat = join(root, 'web-feat');
  assert.equal(branchOf(await service.refreshSessions(), feat), 'feat');
  git(feat, 'switch', '-q', '-c', 'feat-2');
  // Nothing reported yet: the worktree list is still the cached one.
  assert.equal(branchOf(await service.refreshSessions(), feat), 'feat');
  changed.add(join(root, 'web'));
  assert.equal(branchOf(await service.refreshSessions(), feat), 'feat-2');
  // …and it stays, in the cached list the next builds use.
  assert.equal(branchOf(await service.refreshSessions(), feat), 'feat-2');
});

test('a worktree added to a repo shows on the next build once its repo is marked changed', async () => {
  const { service, changed } = setup();
  const before = (await service.refreshSessions()).repos.flatMap((r) => r.worktrees.map((w) => w.path));
  const added = join(root, 'web-new');
  git(join(root, 'web'), 'worktree', 'add', '-q', added, '-b', 'new');
  changed.add(join(root, 'web'));
  const after = (await service.refreshSessions()).repos.flatMap((r) => r.worktrees.map((w) => w.path));
  assert.equal(before.includes(added), false);
  assert.equal(after.includes(added), true);
});

test('a changed origin URL shows on the next build once its repo is marked changed', async () => {
  const { service, changed } = setup();
  const web = join(root, 'web');
  git(web, 'remote', 'add', 'origin', 'git@github.com:acme/web.git');
  changed.add(web);
  const githubOf = async () => (await service.refreshSessions()).repos.find((r) => r.mainPath === web).github;
  assert.equal(await githubOf(), 'acme/web');
  git(web, 'remote', 'set-url', 'origin', 'git@github.com:acme/storefront.git');
  assert.equal(await githubOf(), 'acme/web', 'not marked yet: the cached origin');
  changed.add(web);
  assert.equal(await githubOf(), 'acme/storefront');
});
