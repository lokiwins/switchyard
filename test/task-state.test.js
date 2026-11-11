import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  dueOnLabel, groupTasks, matchesHubTask, taskState, ticketLabel,
} from '../public/task-state.js';

// Tuesday 10 Nov 2026, mid-morning local time.
const NOW = new Date(2026, 10, 10, 10, 0).getTime();

const task = (overrides = {}) => ({
  id: 'sy-aaaaaa', title: 'A task', notes: '', dueOn: null, links: [], createdAt: 1, closedAs: null, work: [], ...overrides,
});
const work = (overrides = {}) => ({ repoName: 'shop', path: '/code/shop-x', branch: 'sy-aaaaaa-x', pr: null, live: [], recent: [], ...overrides });
const session = (overrides = {}) => ({ sessionId: 's', status: 'busy', needsYou: false, parked: false, ...overrides });

test('a task with no work has not started', () => {
  assert.equal(taskState(task()), 'not-started');
});

test('a task whose Claude is busy is working', () => {
  assert.equal(taskState(task({ work: [work({ live: [session()] })] })), 'working');
});

test('a task whose Claude asks something, or waits for your next message, needs you', () => {
  assert.equal(taskState(task({ work: [work({ live: [session({ status: 'idle', needsYou: true })] })] })), 'needs-you');
  assert.equal(taskState(task({ work: [work({ live: [session({ status: 'idle' })] })] })), 'needs-you');
});

test('needing you wins over working, across worktrees', () => {
  const t = task({ work: [work({ live: [session()] }), work({ live: [session({ status: 'idle', needsYou: true })] })] });
  assert.equal(taskState(t), 'needs-you');
});

test('a session idle for over a day (parked) does not need you', () => {
  assert.equal(taskState(task({ work: [work({ live: [session({ status: 'idle', parked: true })] })] })), 'paused');
});

test('an open PR with nothing running is in review; a merged one is done', () => {
  assert.equal(taskState(task({ work: [work({ pr: { number: 4, state: 'OPEN' } })] })), 'in-review');
  assert.equal(taskState(task({ work: [work({ pr: { number: 4, state: 'MERGED' } })] })), 'done');
});

test('a worktree with nothing running and no PR is paused', () => {
  assert.equal(taskState(task({ work: [work()] })), 'paused');
});

test('done or dropped by hand wins over everything', () => {
  assert.equal(taskState(task({ closedAs: 'dropped', work: [work({ live: [session()] })] })), 'dropped');
  assert.equal(taskState(task({ closedAs: 'done' })), 'done');
});

test('dueOnLabel: overdue, today, tomorrow, or the date, by your local day', () => {
  assert.deepEqual(dueOnLabel('2026-11-08', NOW), { text: 'Overdue 2d', tone: 'red' });
  assert.deepEqual(dueOnLabel('2026-11-10', NOW), { text: 'Due today', tone: 'amber' });
  assert.deepEqual(dueOnLabel('2026-11-11', NOW), { text: 'Due tomorrow', tone: 'amber' });
  assert.deepEqual(dueOnLabel('2026-11-20', NOW), { text: 'Due Nov 20', tone: null });
  assert.equal(dueOnLabel(null, NOW), null);
});

test('groupTasks: needs you first, then by when it is due, then done; empty groups left out', () => {
  const tasks = [
    task({ id: 'sy-later1', dueOn: '2026-12-01' }),
    task({ id: 'sy-asks01', dueOn: '2026-12-01', work: [work({ live: [session({ status: 'idle', needsYou: true })] })] }),
    task({ id: 'sy-late01', dueOn: '2026-11-09' }),
    task({ id: 'sy-today1', dueOn: '2026-11-10' }),
    task({ id: 'sy-week01', dueOn: '2026-11-16' }),
    task({ id: 'sy-nodue1' }),
    task({ id: 'sy-done01', closedAs: 'done' }),
    task({ id: 'sy-merged', work: [work({ pr: { number: 1, state: 'MERGED' } })] }),
  ];
  const groups = groupTasks(tasks, NOW);
  assert.deepEqual(groups.map((g) => [g.key, g.tasks.map((t) => t.id)]), [
    ['needs-you', ['sy-asks01']],
    ['overdue', ['sy-late01']],
    ['today', ['sy-today1']],
    ['week', ['sy-week01']],
    ['later', ['sy-later1']],
    ['no-date', ['sy-nodue1']],
    ['done', ['sy-done01', 'sy-merged']],
  ]);
  assert.deepEqual(groups.map((g) => g.label), ['Needs you', 'Overdue', 'Today', 'This week', 'Later', 'No date', 'Done']);
  assert.equal(groups.find((g) => g.key === 'week').tasks[0].state, 'not-started', 'each task carries its state');
});

test('this week runs to six days ahead; a week away is later', () => {
  const keys = (dueOn) => groupTasks([task({ dueOn })], NOW)[0].key;
  assert.equal(keys('2026-11-16'), 'week');
  assert.equal(keys('2026-11-17'), 'later');
});

test('within a group: soonest due first, then work under way before work not started, then newest', () => {
  const tasks = [
    task({ id: 'sy-new001', createdAt: 3 }),
    task({ id: 'sy-old001', createdAt: 1 }),
    task({ id: 'sy-busy01', createdAt: 2, work: [work({ live: [session()] })] }),
    task({ id: 'sy-review', createdAt: 2, work: [work({ pr: { number: 2, state: 'OPEN' } })] }),
  ];
  assert.deepEqual(groupTasks(tasks, NOW)[0].tasks.map((t) => t.id), ['sy-busy01', 'sy-review', 'sy-new001', 'sy-old001']);
  const later = [task({ id: 'sy-dec020', dueOn: '2026-12-20' }), task({ id: 'sy-dec010', dueOn: '2026-12-10' })];
  assert.deepEqual(groupTasks(later, NOW)[0].tasks.map((t) => t.id), ['sy-dec010', 'sy-dec020']);
});

test('matchesHubTask: title, id, notes, links and branches, any case', () => {
  const t = task({ title: 'Email receipts', notes: 'After each charge', links: ['https://app.clickup.com/t/86b1abc2d'], work: [work({ branch: 'sy-aaaaaa-receipts' })] });
  for (const query of ['', 'EMAIL', 'sy-aaaaaa', 'each charge', '86b1abc2d', 'receipts']) assert.equal(matchesHubTask(t, query), true, query);
  assert.equal(matchesHubTask(t, 'invoice'), false);
});

test('ticketLabel names a link by its tracker, or by its site', () => {
  assert.equal(ticketLabel('https://app.clickup.com/t/86b1abc2d'), 'ClickUp 86b1abc2d');
  assert.equal(ticketLabel('https://app.clickup.com/t/9012345/ENG-123'), 'ClickUp ENG-123');
  assert.equal(ticketLabel('https://github.com/acme/shop/issues/42'), 'GitHub #42');
  assert.equal(ticketLabel('https://acme.atlassian.net/browse/SHOP-17'), 'Jira SHOP-17');
  assert.equal(ticketLabel('https://dev.azure.com/acme/shop/_workitems/edit/310'), 'ADO 310');
  assert.equal(ticketLabel('https://www.example.com/specs/checkout'), 'example.com');
  assert.equal(ticketLabel('not a url'), 'link');
});
