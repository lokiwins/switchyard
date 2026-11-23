import { expect, test } from 'vitest';
import { sessionToJump } from './task-views';

test('Jump and Terminal go to the session that most needs you, then the latest active one', () => {
  const busy = { sessionId: 'b', status: 'busy', statusUpdatedAt: 3 };
  const waiting = { sessionId: 'w', status: 'idle', statusUpdatedAt: 2 };
  const asking = { sessionId: 'a', status: 'idle', needsYou: true, statusUpdatedAt: 1 };
  const parked = { sessionId: 'p', status: 'idle', parked: true, statusUpdatedAt: 4 };
  const later = { sessionId: 'l', status: 'busy', statusUpdatedAt: 9 };
  expect(sessionToJump({ live: [] })).toBe(null);
  expect(sessionToJump({ live: [busy, waiting, asking] })).toBe(asking);
  expect(sessionToJump({ live: [busy, later] })).toBe(later);
  expect(sessionToJump({ live: [parked, waiting] })).toBe(waiting);
  expect(sessionToJump({ live: [parked] })).toBe(parked);
});
