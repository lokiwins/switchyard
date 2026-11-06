import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCleanupService } from '../src/cleanup.js';

const MAIN = '/w/my-repo';
const TREE = '/w/my-repo-login';
const PR_HEAD = 'a'.repeat(40);

function setup({
  pr = { state: 'MERGED', headRefOid: PR_HEAD }, branch = 'fix/login', live = [], status = '', head = PR_HEAD,
  ancestor = false, unpushed = 0, removeFails = null, isMain = false,
} = {}) {
  const calls = [];
  const worktree = { path: TREE, branch, pr, isMain, prunable: false };
  const state = { repos: [{ name: 'my-repo', mainPath: MAIN, worktrees: [{ path: MAIN, isMain: true }, worktree] }] };
  const git = async (args) => {
    calls.push(args.join(' '));
    const command = args[2];
    if (command === 'status') return status;
    if (command === 'rev-parse') return `${head}\n`;
    if (command === 'merge-base') {
      if (!ancestor) throw new Error('not an ancestor');
      return '';
    }
    if (command === 'rev-list') return `${unpushed}\n`;
    if (command === 'worktree' && removeFails) throw new Error(removeFails);
    return '';
  };
  const cleanup = createCleanupService({
    stateService: { getState: async () => state, getSessions: async () => ({ liveSessions: live }) },
    git,
  });
  return { cleanup, calls };
}

const rejectsWith = (promise, status, pattern) => assert.rejects(promise, (error) => error.status === status && (!pattern || pattern.test(error.message)));

test('a merged worktree whose tip is the PR\'s last commit is removed with its branch', async () => {
  const { cleanup, calls } = setup();
  assert.deepEqual(await cleanup.cleanUpWorktree({ path: TREE }), { removed: TREE, deletedBranch: 'fix/login' });
  assert.deepEqual(calls.slice(-2), [`-C ${MAIN} worktree remove ${TREE}`, `-C ${MAIN} branch -D fix/login`]);
  assert.ok(!calls.some((c) => c.includes('--force')));
});

test('a closed, unmerged PR keeps its branch', async () => {
  const { cleanup, calls } = setup({ pr: { state: 'CLOSED', headRefOid: PR_HEAD } });
  assert.deepEqual(await cleanup.cleanUpWorktree({ path: TREE }), { removed: TREE, deletedBranch: null });
  assert.ok(!calls.some((c) => c.includes('branch -D')));
});

test('a branch behind the PR, or fully on a remote, counts as saved', async () => {
  assert.equal((await setup({ head: 'b'.repeat(40), ancestor: true }).cleanup.cleanUpWorktree({ path: TREE })).removed, TREE);
  assert.equal((await setup({ head: 'b'.repeat(40), unpushed: 0 }).cleanup.cleanUpWorktree({ path: TREE })).removed, TREE);
});

test('commits that are in neither the PR nor a remote stop the clean up', async () => {
  const { cleanup, calls } = setup({ head: 'b'.repeat(40), unpushed: 2 });
  await rejectsWith(cleanup.cleanUpWorktree({ path: TREE }), 409, /2 commits that aren't in the PR or on origin/);
  assert.ok(!calls.some((c) => c.includes('worktree remove')));
});

test('uncommitted or untracked files stop the clean up', async () => {
  await rejectsWith(setup({ status: ' M src/a.js\n?? notes.txt\n' }).cleanup.cleanUpWorktree({ path: TREE }), 409, /2 uncommitted or untracked files/);
});

test('a running session in the worktree, or below it, stops the clean up', async () => {
  await rejectsWith(setup({ live: [{ cwd: `${TREE}/src` }] }).cleanup.cleanUpWorktree({ path: TREE }), 409, /session is still running/);
  assert.equal((await setup({ live: [{ cwd: `${TREE}-other` }] }).cleanup.cleanUpWorktree({ path: TREE })).removed, TREE);
});

test('only worktrees with a merged or closed PR, never the main checkout or unknown folders', async () => {
  await rejectsWith(setup({ pr: { state: 'OPEN' } }).cleanup.cleanUpWorktree({ path: TREE }), 409);
  await rejectsWith(setup({ pr: null }).cleanup.cleanUpWorktree({ path: TREE }), 409);
  await rejectsWith(setup().cleanup.cleanUpWorktree({ path: MAIN }), 400);
  await rejectsWith(setup().cleanup.cleanUpWorktree({ path: '/etc' }), 404);
  await rejectsWith(setup().cleanup.cleanUpWorktree({}), 400);
});

test('git refusing to remove the worktree is reported, and the branch is kept', async () => {
  const { cleanup, calls } = setup({ removeFails: "'/w/my-repo-login' contains modified or untracked files" });
  await rejectsWith(cleanup.cleanUpWorktree({ path: TREE }), 409, /git refused/);
  assert.ok(!calls.some((c) => c.includes('branch -D')));
});
