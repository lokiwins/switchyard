import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSwrCache } from '../src/cache.js';

function fakeClock(start = 0) {
  let time = start;
  return { now: () => time, advance: (ms) => { time += ms; } };
}

test('returns the cached value while fresh and dedupes concurrent loads', async () => {
  const cache = createSwrCache({ now: fakeClock().now });
  let calls = 0;
  const load = async () => ++calls;

  const [a, b] = await Promise.all([cache.get('k', 1000, load), cache.get('k', 1000, load)]);

  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(await cache.get('k', 1000, load), 1);
  assert.equal(calls, 1);
});

test('serves stale values immediately and refreshes in the background', async () => {
  const clock = fakeClock();
  const cache = createSwrCache({ now: clock.now });
  let calls = 0;
  const load = async () => ++calls;

  await cache.get('k', 1000, load);
  clock.advance(1001);

  assert.equal(await cache.get('k', 1000, load), 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await cache.get('k', 1000, load), 2);
});

test('keeps the last good value when a refresh fails and records the error', async () => {
  const cache = createSwrCache({ now: fakeClock().now });
  await cache.get('k', 1000, async () => 'good');

  const value = await cache.get('k', 1000, async () => { throw new Error('boom'); }, { force: true });

  assert.equal(value, 'good');
  assert.equal(cache.lastError('k').message, 'boom');
});

test('propagates the error when there is no previous value', async () => {
  const cache = createSwrCache();
  await assert.rejects(cache.get('k', 1000, async () => { throw new Error('first'); }), /first/);
});
