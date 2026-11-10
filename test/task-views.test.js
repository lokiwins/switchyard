import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dueLabel, matchesTask } from '../public/task-views.js';

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
