import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, test } from 'node:test';
import { MAX_COMMITS, gitReport } from '../src/worker-report.js';

/*
 * A real repo: main, a lead branch with one commit, and a worker branched
 * from the lead's with two commits and a file not yet committed.
 */
let lead;
let worker;
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8' });
before(() => {
  const root = mkdtempSync(join(tmpdir(), 'switchyard-worker-'));
  lead = join(root, 'shop');
  worker = join(root, 'shop-worker');
  execFileSync('git', ['init', '-q', '-b', 'main', lead]);
  git(lead, 'commit', '-q', '--allow-empty', '-m', 'start');
  git(lead, 'checkout', '-q', '-b', 'sy-lead01-build');
  writeFileSync(join(lead, 'a.txt'), 'a\n');
  git(lead, 'add', 'a.txt');
  git(lead, 'commit', '-q', '-m', 'Lead work');
  git(lead, 'worktree', 'add', '-q', '-b', 'sy-wrk001-tests', worker, 'sy-lead01-build');
  writeFileSync(join(worker, 'b.txt'), 'one\ntwo\n');
  git(worker, 'add', 'b.txt');
  git(worker, 'commit', '-q', '-m', 'Add the totals tests');
  writeFileSync(join(worker, 'a.txt'), 'a\nmore\n');
  git(worker, 'commit', '-q', '-am', 'Fix the totals');
  writeFileSync(join(worker, 'notes.txt'), 'wip\n');
});

test('a worker\'s branch next to the lead\'s: its own commits, newest first, what they change, and what isn\'t committed', async () => {
  const report = await gitReport({ path: worker, base: 'sy-lead01-build' });
  assert.deepEqual(report.commits.map((c) => c.subject), ['Fix the totals', 'Add the totals tests']);
  assert.match(report.commits[0].sha, /^[0-9a-f]{7,}$/);
  assert.equal(report.moreCommits, false);
  assert.equal(report.base, 'sy-lead01-build');
  assert.deepEqual(report.changes, { files: 2, insertions: 3, deletions: 0 });
  assert.deepEqual(report.uncommitted, ['?? notes.txt']);
});

test('the lead\'s own commits since the worker branched aren\'t counted as the worker\'s', async () => {
  writeFileSync(join(lead, 'c.txt'), 'c\n');
  git(lead, 'add', 'c.txt');
  git(lead, 'commit', '-q', '-m', 'More lead work');
  const report = await gitReport({ path: worker, base: 'sy-lead01-build' });
  assert.deepEqual(report.commits.map((c) => c.subject), ['Fix the totals', 'Add the totals tests']);
  assert.equal(report.changes.files, 2);
});

test('with no lead branch to compare with, it says so and still lists what isn\'t committed', async () => {
  const report = await gitReport({ path: worker, base: null });
  assert.equal(report.base, null);
  assert.equal(report.commits, null);
  assert.equal(report.changes, null);
  assert.deepEqual(report.uncommitted, ['?? notes.txt']);
});

test(`commits are capped at ${MAX_COMMITS}, saying there are more`, async () => {
  for (let i = 0; i < MAX_COMMITS + 1; i += 1) git(worker, 'commit', '-q', '--allow-empty', '-m', `Step ${i}`);
  const report = await gitReport({ path: worker, base: 'sy-lead01-build' });
  assert.equal(report.commits.length, MAX_COMMITS);
  assert.equal(report.moreCommits, true);
});

test('a worktree that\'s gone is reported, not thrown', async () => {
  const report = await gitReport({ path: '/nonexistent/worktree', base: 'main' });
  assert.match(report.error, /git/);
});
