import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProcessStarts, parseProcessStarts, startTimesMatch } from '../src/agents/process.js';

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

/** A process-start lookup that records which pids it was asked for. */
function startsSetup({ starts = { 1: 100, 2: 200, 3: 300 }, ttlMs = 60_000 } = {}) {
  let time = 0;
  const asked = [];
  const list = async (pids) => { asked.push([...pids]); return new Map(pids.filter((p) => p in starts).map((p) => [p, starts[p]])); };
  const processStarts = createProcessStarts({ list, now: () => time, ttlMs });
  return { processStarts, asked, starts, advance: (ms) => { time += ms; } };
}

test('createProcessStarts: asks ps only for pids it has not seen, and remembers the rest', async () => {
  const { processStarts, asked } = startsSetup();
  assert.deepEqual([...await processStarts([1, 2])], [[1, 100], [2, 200]]);
  assert.deepEqual([...await processStarts([1, 2])], [[1, 100], [2, 200]]);
  assert.deepEqual([...await processStarts([1, 2, 3])], [[1, 100], [2, 200], [3, 300]]);
  assert.deepEqual(asked, [[1, 2], [3]]);
});

test('createProcessStarts: each pid is checked again once a minute, so a reused pid is caught', async () => {
  const { processStarts, asked, starts, advance } = startsSetup();
  await processStarts([1]);
  starts[1] = 999; // pid 1 died and was reused
  advance(30_000);
  assert.equal((await processStarts([1])).get(1), 100);
  advance(31_000);
  assert.equal((await processStarts([1])).get(1), 999);
  assert.deepEqual(asked, [[1], [1]]);
});

test('createProcessStarts: pids no longer asked about are forgotten, so a reused one is looked up afresh', async () => {
  const { processStarts, asked } = startsSetup();
  await processStarts([1, 2]);
  await processStarts([2]);
  await processStarts([1, 2]);
  assert.deepEqual(asked, [[1, 2], [1]]);
});

test('createProcessStarts: a pid ps has no start for (gone) is not remembered', async () => {
  const { processStarts, asked } = startsSetup();
  assert.equal((await processStarts([7])).has(7), false);
  await processStarts([7]);
  assert.deepEqual(asked, [[7], [7]]);
});

test('createProcessStarts: nothing to look up, nothing asked', async () => {
  const { processStarts, asked } = startsSetup();
  assert.equal((await processStarts([])).size, 0);
  assert.deepEqual(asked, []);
});
