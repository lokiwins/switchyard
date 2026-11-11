import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  branchNamesTask, linkHubTasks, linkTasks, tagWorktrees, taskForBranch, ticketKeys,
} from '../src/task-links.js';

const task = (overrides = {}) => ({ id: '86b1abc2d', customId: null, name: 'Email receipts', url: 'https://app.clickup.com/t/86b1abc2d', ...overrides });

const worktree = (overrides = {}) => ({
  path: '/code/shop-receipts',
  branch: 'feat/CU-86b1abc2d-email-receipts',
  isMain: false,
  pr: null,
  agents: { live: [], last: null, recent: [] },
  ...overrides,
});

const repos = (...worktrees) => [{ name: 'shop', worktrees }];

test('a branch names a task by CU-<id>, in any case', () => {
  assert.equal(branchNamesTask('feat/CU-86b1abc2d-email-receipts', task()), true);
  assert.equal(branchNamesTask('cu-86B1ABC2D', task()), true);
});

test('a branch names a task by its bare id, between separators', () => {
  assert.equal(branchNamesTask('86b1abc2d-email-receipts', task()), true);
  assert.equal(branchNamesTask('fix/86b1abc2d', task()), true);
  assert.equal(branchNamesTask('feature/receipts_86b1abc2d', task()), true);
});

test('an id inside a longer word is not a match', () => {
  assert.equal(branchNamesTask('feat/x86b1abc2d', task()), false);
  assert.equal(branchNamesTask('feat/86b1abc2dx', task()), false);
  assert.equal(branchNamesTask('feat/86b1abc2', task()), false);
});

test('a branch names a task by its custom id, whole', () => {
  const custom = task({ customId: 'ENG-123' });
  assert.equal(branchNamesTask('feat/eng-123-receipts', custom), true);
  assert.equal(branchNamesTask('feat/ENG-1234-receipts', custom), false);
});

test('no branch, or a detached worktree, names nothing', () => {
  assert.equal(branchNamesTask(null, task()), false);
  assert.equal(branchNamesTask('', task()), false);
});

test('linkTasks lists each task\'s worktrees with their PR and sessions', () => {
  const live = { sessionId: 's1', pid: 10, status: 'busy', host: { kind: 'tmux', session: 'switchyard', windowName: 'shop' } };
  const recent = { sessionId: 's0', updatedAt: 5 };
  const pr = { number: 42, url: 'https://github.com/o/shop/pull/42', state: 'OPEN', title: 'Email receipts', checks: { state: 'passing' } };
  const linked = linkTasks([task(), task({ id: 'zz9zz9zz9' })], repos(worktree({ pr, agents: { live: [live], last: null, recent: [recent] } })));

  assert.deepEqual(linked[0].links, [{
    repoName: 'shop',
    path: '/code/shop-receipts',
    branch: 'feat/CU-86b1abc2d-email-receipts',
    pr: { number: 42, url: 'https://github.com/o/shop/pull/42', state: 'OPEN' },
    live: [live],
    recent: [recent],
  }]);
  assert.deepEqual(linked[1].links, []);
});

test('linkTasks finds a task in every worktree whose branch names it', () => {
  const linked = linkTasks([task()], [
    { name: 'shop', worktrees: [worktree()] },
    { name: 'api', worktrees: [worktree({ path: '/code/api-receipts', branch: 'CU-86b1abc2d' })] },
  ]);
  assert.deepEqual(linked[0].links.map((l) => l.repoName), ['shop', 'api']);
});

test('linkTasks leaves the tasks as they were', () => {
  const tasks = [task()];
  linkTasks(tasks, repos(worktree()));
  assert.equal('links' in tasks[0], false);
});

test('tagWorktrees marks each worktree with the task its branch names', () => {
  const tagged = tagWorktrees(repos(worktree(), worktree({ path: '/code/shop', branch: 'main', isMain: true })), [task()]);
  assert.deepEqual(tagged[0].worktrees[0].task, {
    id: '86b1abc2d', customId: null, name: 'Email receipts', url: 'https://app.clickup.com/t/86b1abc2d',
  });
  assert.equal(tagged[0].worktrees[1].task, null);
});

test('tagWorktrees with no tasks leaves every worktree untagged', () => {
  const tagged = tagWorktrees(repos(worktree()), []);
  assert.equal(tagged[0].worktrees[0].task, null);
});

test('taskForBranch: the task an ended session\'s branch names, or null', () => {
  assert.equal(taskForBranch([task()], 'CU-86b1abc2d').id, '86b1abc2d');
  assert.equal(taskForBranch([task()], 'main'), null);
  assert.equal(taskForBranch([task()], null), null);
});

const hubTask = (overrides = {}) => ({ id: 'sy-k3x9q2', title: 'Email receipts', links: [], ...overrides });

test('ticketKeys: the ClickUp task id or custom id in a ticket link', () => {
  assert.deepEqual(ticketKeys(['https://app.clickup.com/t/86b1abc2d']), ['86b1abc2d']);
  assert.deepEqual(ticketKeys(['https://app.clickup.com/t/9012345/ENG-123']), ['ENG-123']);
  assert.deepEqual(ticketKeys(['https://github.com/o/r/issues/4', 'https://example.test/t/x']), []);
});

test('linkHubTasks finds a task\'s worktrees by its id in the branch name', () => {
  const [linked] = linkHubTasks([hubTask()], repos(worktree({ branch: 'sy-k3x9q2-email-receipts' }), worktree({ path: '/code/other', branch: 'main' })));
  assert.deepEqual(linked.work.map((w) => w.branch), ['sy-k3x9q2-email-receipts']);
  assert.deepEqual(linked.links, [], 'its ticket links are left as they are');
});

test('linkHubTasks also finds worktrees by a linked ClickUp ticket, as CU-<id> or its custom id', () => {
  const task = hubTask({ links: ['https://app.clickup.com/t/86b1abc2d', 'https://app.clickup.com/t/9012345/ENG-123'] });
  const [linked] = linkHubTasks([task], repos(
    worktree({ path: '/code/a', branch: 'feat/CU-86b1abc2d-receipts' }),
    worktree({ path: '/code/b', branch: 'eng-123-follow-up' }),
    worktree({ path: '/code/c', branch: 'feat/unrelated' }),
  ));
  assert.deepEqual(linked.work.map((w) => w.path), ['/code/a', '/code/b']);
});

test('linkHubTasks: a worktree is listed once even when several keys match it', () => {
  const task = hubTask({ links: ['https://app.clickup.com/t/86b1abc2d'] });
  const [linked] = linkHubTasks([task], repos(worktree({ branch: 'sy-k3x9q2-CU-86b1abc2d' })));
  assert.equal(linked.work.length, 1);
});
