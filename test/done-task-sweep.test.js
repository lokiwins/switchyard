import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJsonFile } from '../src/json-store.js';
import { createTaskHub } from '../src/task-hub.js';
import { createDoneTaskSweep } from '../src/done-task-sweep.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 1, 12);

async function setup({ autoDeleteDone = true, days = 7 } = {}) {
  let t = T0;
  let n = 0;
  const hub = createTaskHub({
    file: createJsonFile(mkdtempSync(join(tmpdir(), 'switchyard-sweep-')), 'tasks.json'),
    now: () => t,
    newId: () => `sy-task0${(n += 1)}`,
  });
  // The merged one's worktree: branch named after the task, its PR merged.
  const repos = [{
    name: 'shop', mainPath: '/r/shop',
    worktrees: [{ path: '/r/shop-sy-task03', branch: 'sy-task03-x', pr: { number: 3, state: 'MERGED' }, agents: { live: [], recent: [] } }],
  }];
  const deleted = [];
  const sweep = createDoneTaskSweep({
    taskHub: hub,
    getSessions: async () => ({ repos }),
    settings: () => ({ autoDeleteDone, deleteDoneAfterMs: days * DAY }),
    deleteTask: async (id) => {
      deleted.push(id);
      await hub.remove({ id });
    },
    now: () => t,
  });
  const done = await hub.create({ title: 'Marked done' });
  const dropped = await hub.create({ title: 'Dropped' });
  const merged = await hub.create({ title: 'Its PR merged' });
  const open = await hub.create({ title: 'Still open' });
  await hub.close({ id: done.id, as: 'done' });
  await hub.close({ id: dropped.id, as: 'dropped' });
  return { sweep, hub, deleted, at: (ms) => { t = ms; }, ids: { done: done.id, dropped: dropped.id, merged: merged.id, open: open.id } };
}

test('nothing is deleted while the setting is off', async () => {
  const { sweep, at, deleted } = await setup({ autoDeleteDone: false });
  at(T0 + 30 * DAY);
  assert.deepEqual(await sweep.run(), { deleted: [], errors: [] });
  assert.deepEqual(deleted, []);
});

test('a done or dropped task is deleted once it has been closed that many days, not before', async () => {
  const { sweep, at, deleted, ids } = await setup();
  at(T0 + 7 * DAY - 1);
  await sweep.run();
  assert.deepEqual(deleted, []);
  at(T0 + 7 * DAY);
  await sweep.run();
  assert.deepEqual(deleted.sort(), [ids.done, ids.dropped].sort());
});

test('a task done because its PR merged counts from when switchyard first saw it done', async () => {
  const { sweep, at, deleted, ids, hub } = await setup();
  at(T0 + 3 * DAY);
  await sweep.run();
  assert.equal((await hub.list()).find((t) => t.id === ids.merged).doneSeenAt, T0 + 3 * DAY);
  at(T0 + 10 * DAY - 1);
  await sweep.run();
  assert.equal(deleted.includes(ids.merged), false);
  at(T0 + 10 * DAY);
  await sweep.run();
  assert.equal(deleted.includes(ids.merged), true);
});

test('open tasks are never deleted', async () => {
  const { sweep, at, deleted, ids } = await setup({ days: 1 });
  at(T0 + 365 * DAY);
  await sweep.run();
  await sweep.run();
  assert.equal(deleted.includes(ids.open), false);
});

test('one task that fails to delete doesn\'t stop the others', async () => {
  const { sweep, at, hub, ids } = await setup();
  const failing = createDoneTaskSweep({
    taskHub: hub,
    getSessions: async () => ({ repos: [] }),
    settings: () => ({ autoDeleteDone: true, deleteDoneAfterMs: DAY }),
    deleteTask: async (id) => {
      if (id === ids.done) throw new Error('disk full');
      await hub.remove({ id });
    },
    now: () => T0 + 2 * DAY,
  });
  at(T0 + 2 * DAY);
  const result = await failing.run();
  assert.deepEqual(result.deleted, [ids.dropped]);
  assert.match(result.errors.join(' '), /disk full/);
  void sweep;
});
