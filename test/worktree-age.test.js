import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RECENT_MS, isRecent, nextAgeOut } from '../public/worktree-age.js';

const HOUR = 60 * 60 * 1000;
const NOW = 100 * 24 * HOUR;
const stateWith = (...times) => ({ repos: [{ worktrees: times.map((lastActivityAt) => ({ lastActivityAt })) }] });

test('isRecent: active in the last three days', () => {
  assert.equal(isRecent({ lastActivityAt: NOW - HOUR }, NOW), true);
  assert.equal(isRecent({ lastActivityAt: NOW - RECENT_MS - 1 }, NOW), false);
  assert.equal(isRecent({ lastActivityAt: null }, NOW), false);
});

test('nextAgeOut: when the next worktree stops counting as recent', () => {
  const soonest = NOW - RECENT_MS + HOUR;
  assert.equal(nextAgeOut(stateWith(NOW - HOUR, soonest, NOW - RECENT_MS - HOUR, null), NOW), soonest + RECENT_MS);
});

test('nextAgeOut: never, when no worktree is recent', () => {
  assert.equal(nextAgeOut(stateWith(NOW - RECENT_MS - 1, null), NOW), Infinity);
  assert.equal(nextAgeOut({ repos: [] }, NOW), Infinity);
});
