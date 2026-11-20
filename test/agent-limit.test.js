import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAgentLimit } from '../src/agent-limit.js';

const limit = (max, running) => createAgentLimit({ maxRunning: () => max, countRunning: async () => running });

test('with no limit set (0), every start goes ahead', async () => {
  await limit(0, 50).check();
});

test('under the limit, a start goes ahead; at it, it is refused, saying why and what to do', async () => {
  await limit(3, 2).check();
  await assert.rejects(limit(3, 3).check(), (error) => error.status === 409
    && error.message === '3 agents are running, and Settings › Agents allows 3 at once; end one to start another');
  await assert.rejects(limit(1, 1).check(), (error) => error.message.startsWith('1 agent is running, and Settings › Agents allows 1 at once'));
});

test('the limit is read each time, so a saved change applies to the next start', async () => {
  let max = 1;
  const live = createAgentLimit({ maxRunning: () => max, countRunning: async () => 1 });
  await assert.rejects(live.check());
  max = 2;
  await live.check();
});

test('it isn\'t counted at all when there is no limit', async () => {
  let counted = 0;
  await createAgentLimit({ maxRunning: () => 0, countRunning: async () => { counted += 1; return 0; } }).check();
  assert.equal(counted, 0);
});
