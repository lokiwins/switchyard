import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dueLabel, matchesTask, sessionToJump } from '../public/task-views.js';

const DAY = 24 * 60 * 60 * 1000;
// Noon UTC, so "today" is the same date in any timezone the tests run in.
const NOW = Date.UTC(2026, 10, 10, 12);

test('a due date reads as overdue, today, tomorrow, or the date', () => {
  assert.deepEqual(dueLabel(null, NOW), null);
  assert.deepEqual(dueLabel(NOW - 3 * DAY, NOW), { text: 'Overdue 3d', tone: 'red' });
  assert.deepEqual(dueLabel(NOW, NOW), { text: 'Due today', tone: 'amber' });
  assert.deepEqual(dueLabel(NOW + DAY, NOW), { text: 'Due tomorrow', tone: 'amber' });
  assert.equal(dueLabel(NOW + 10 * DAY, NOW).tone, null);
  assert.match(dueLabel(NOW + 10 * DAY, NOW).text, /^Due Nov 20$/);
});

test('the filter matches a task by name, id, custom id, status or where it is', () => {
  const task = { id: '86b1abc', customId: 'SHOP-12', name: 'Show order history', status: { name: 'in progress' }, where: 'Storefront › Sprint 12' };
  for (const query of ['', 'order', 'ORDER HISTORY', '86b1', 'shop-12', 'progress', 'sprint 12']) assert.ok(matchesTask(task, query), query);
  assert.ok(!matchesTask(task, 'invoice'));
  assert.ok(matchesTask({ ...task, customId: null, where: null }, 'show'));
});

test('the filter also matches the branch of a worktree working on the task', () => {
  const task = { id: '86b1abc', name: 'Show order history', status: { name: 'to do' }, links: [{ repoName: 'shop', branch: 'feat/CU-86b1abc-orders' }] };
  assert.ok(matchesTask(task, 'feat/cu-86b1abc'));
  assert.ok(!matchesTask({ ...task, links: [] }, 'feat/'));
});

test('Jump and Terminal go to the session that most needs you, then the latest active one', () => {
  const busy = { sessionId: 'b', status: 'busy', statusUpdatedAt: 3 };
  const waiting = { sessionId: 'w', status: 'idle', statusUpdatedAt: 2 };
  const asking = { sessionId: 'a', status: 'idle', needsYou: true, statusUpdatedAt: 1 };
  const parked = { sessionId: 'p', status: 'idle', parked: true, statusUpdatedAt: 4 };
  const later = { sessionId: 'l', status: 'busy', statusUpdatedAt: 9 };
  assert.equal(sessionToJump({ live: [] }), null);
  assert.equal(sessionToJump({ live: [busy, waiting, asking] }), asking);
  assert.equal(sessionToJump({ live: [busy, later] }), later);
  assert.equal(sessionToJump({ live: [parked, waiting] }), waiting);
  assert.equal(sessionToJump({ live: [parked] }), parked);
});
