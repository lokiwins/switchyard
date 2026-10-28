import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseBranchRefs, parseStatusV2, parseWorktreePorcelain } from '../src/git.js';

test('parseWorktreePorcelain reads main, linked, detached and prunable worktrees', () => {
  const output = [
    'worktree /repo', 'HEAD aaa', 'branch refs/heads/main', '',
    'worktree /repo-feature', 'HEAD bbb', 'branch refs/heads/feature/x', 'locked', '',
    'worktree /repo-detached', 'HEAD ccc', 'detached', '',
    'worktree /gone', 'HEAD ddd', 'branch refs/heads/old', 'prunable gitdir file points to non-existent location', '',
  ].join('\n');

  const worktrees = parseWorktreePorcelain(output);

  assert.equal(worktrees.length, 4);
  assert.deepEqual(worktrees[0], {
    path: '/repo', head: 'aaa', branch: 'main', detached: false, bare: false, locked: false, prunable: false,
  });
  assert.equal(worktrees[1].branch, 'feature/x');
  assert.equal(worktrees[1].locked, true);
  assert.equal(worktrees[2].detached, true);
  assert.equal(worktrees[2].branch, null);
  assert.equal(worktrees[3].prunable, true);
});

test('parseWorktreePorcelain keeps paths that contain spaces', () => {
  const [worktree] = parseWorktreePorcelain('worktree /Users/me/my repo\nHEAD aaa\nbranch refs/heads/main\n');
  assert.equal(worktree.path, '/Users/me/my repo');
});

test('parseStatusV2 counts changes and reads ahead/behind', () => {
  const output = [
    '# branch.oid abc',
    '# branch.head feature',
    '# branch.upstream origin/feature',
    '# branch.ab +2 -5',
    '1 .M N... 100644 100644 100644 a b src/a.js',
    '2 R. N... 100644 100644 100644 a b R100 new.js\told.js',
    'u UU N... 100644 100644 100644 100644 a b c conflict.js',
    '? scratch.txt',
    '? other.txt',
  ].join('\n');

  assert.deepEqual(parseStatusV2(output), {
    upstream: 'origin/feature', ahead: 2, behind: 5, changed: 2, untracked: 2, conflicted: 1,
  });
});

test('parseStatusV2 reports no upstream for unpushed branches', () => {
  const status = parseStatusV2('# branch.oid abc\n# branch.head local-only\n');
  assert.equal(status.upstream, null);
  assert.equal(status.ahead, 0);
});

test('parseBranchRefs maps branch to commit time and subject', () => {
  const refs = parseBranchRefs('main\t1700000000\tInitial commit\nfeat\t1700000600\tfix: a\tb\n');
  assert.deepEqual(refs.get('main'), { committedAt: 1_700_000_000_000, subject: 'Initial commit' });
  assert.equal(refs.get('feat').subject, 'fix: a\tb');
});
