import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sessionToJump } from '../public/task-views.js';

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
