import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDue } from '../public/alert-time.js';

test('an alert set for a time shows from then on; one with no time never does', () => {
  assert.equal(isDue(1000, 999), false);
  assert.equal(isDue(1000, 1000), true);
  assert.equal(isDue(1000, 5000), true);
  for (const none of [null, undefined, '', 0, 'x']) assert.equal(isDue(none, 5000), false, String(none));
});
