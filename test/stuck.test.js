import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sessionAlerts } from '../src/stuck.js';

const MIN = 60_000;
const SETTINGS = { stuckAfterMs: 30 * MIN, contextAlertTokens: 150_000 };
const busy = (overrides = {}) => ({
  status: 'busy', needsYou: false, inBackground: false, statusUpdatedAt: 1_000_000, transcript: { lastActivityAt: 1_200_000, contextTokens: 40_000 }, ...overrides,
});

test('a working session counts as stuck once nothing has happened for the set time: from its last activity', () => {
  assert.deepEqual(sessionAlerts(busy(), SETTINGS), { stuckAt: 1_200_000 + 30 * MIN, lastActivityAt: 1_200_000, contextHigh: false });
});

test('the last activity is the later of the transcript time and the status time', () => {
  assert.equal(sessionAlerts(busy({ statusUpdatedAt: 2_000_000 }), SETTINGS).stuckAt, 2_000_000 + 30 * MIN);
  assert.equal(sessionAlerts(busy({ transcript: {} }), SETTINGS).stuckAt, 1_000_000 + 30 * MIN);
});

test('only a session working in the foreground can be stuck: not idle, asking, running something in the background, or with the alert off', () => {
  for (const session of [busy({ status: 'idle' }), busy({ needsYou: true }), busy({ inBackground: true }), busy({ statusUpdatedAt: null, transcript: {} })]) {
    assert.equal(sessionAlerts(session, SETTINGS).stuckAt, null, JSON.stringify(session));
  }
  assert.equal(sessionAlerts(busy(), { ...SETTINGS, stuckAfterMs: 0 }).stuckAt, null);
});

test('context over the set size is flagged, whatever the session is doing; 0 is off', () => {
  assert.equal(sessionAlerts(busy({ status: 'idle', transcript: { contextTokens: 160_000 } }), SETTINGS).contextHigh, true);
  assert.equal(sessionAlerts(busy({ transcript: { contextTokens: 149_999 } }), SETTINGS).contextHigh, false);
  assert.equal(sessionAlerts(busy({ transcript: { contextTokens: 900_000 } }), { ...SETTINGS, contextAlertTokens: 0 }).contextHigh, false);
});
