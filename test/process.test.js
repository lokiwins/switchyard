import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseProcessStarts, startTimesMatch } from '../src/agents/process.js';

test('parseProcessStarts reads pid and local start time from ps output', () => {
  const starts = parseProcessStarts('    1 Mon Oct 19 22:54:21 2026    \n17806 Tue Oct 20 09:30:08 2026\ngarbage\n');
  assert.equal(starts.size, 2);
  assert.equal(starts.get(17806), new Date('Tue Oct 20 09:30:08 2026').getTime());
});

test('startTimesMatch accepts a UTC-recorded start that matches the running process', () => {
  const actual = Date.parse('2026-10-28T17:10:45Z');
  assert.equal(startTimesMatch('Wed Oct 28 17:10:45 2026', actual + 1000), true);
});

test('startTimesMatch rejects a reused pid whose process started at a different time', () => {
  const actual = Date.parse('2026-10-28T19:00:00Z');
  assert.equal(startTimesMatch('Wed Oct 28 17:10:45 2026', actual), false);
});

test('startTimesMatch trusts liveness alone when either start time is missing or unreadable', () => {
  assert.equal(startTimesMatch(undefined, Date.now()), true);
  assert.equal(startTimesMatch('Wed Oct 28 17:10:45 2026', undefined), true);
  assert.equal(startTimesMatch('not a date', Date.now()), true);
});
