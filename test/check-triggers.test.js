import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCheckTriggers } from '../src/check-triggers.js';

const MAIN = '/r/shop';
const WT = '/r/shop-sy-abc123-fix';
const OTHER = '/r/shop-unrelated';
const TASKS = [{ id: 'sy-abc123', title: 'Fix the cart', links: [], closedAs: null }];

/** The sessions view the agent feed publishes, with the task's worktree busy or not. */
function data({ busy = false, needsYou = false, otherBusy = false } = {}) {
  const live = (on, extra = {}) => (on ? [{ sessionId: 's', status: 'busy', needsYou: false, ...extra }] : []);
  return {
    repos: [{
      name: 'shop',
      mainPath: MAIN,
      worktrees: [
        { path: MAIN, isMain: true, branch: 'main', agents: { live: [] } },
        { path: WT, isMain: false, branch: 'sy-abc123-fix', agents: { live: needsYou ? [{ sessionId: 's', status: 'idle', needsYou: true }] : live(busy) } },
        { path: OTHER, isMain: false, branch: 'unrelated', agents: { live: live(otherBusy) } },
      ],
    }],
  };
}

function setup({ watchedRepos = ['shop'], tasks = TASKS } = {}) {
  const runs = [];
  const heads = new Map([[WT, 'h1'], [OTHER, 'o1']]);
  const triggers = createCheckTriggers({
    checks: { watchedRepos: () => watchedRepos, autoRun: async (args) => { runs.push(args); return []; } },
    listTasks: async () => tasks,
    headOf: async (path) => heads.get(path),
  });
  return { triggers, runs, heads };
}

test('a turn ending in a task\'s worktree (busy, then not) runs its after-turn checks', async () => {
  const { triggers, runs } = setup();
  await triggers.seen(data({ busy: true }));
  await triggers.seen(data({ busy: true }));
  assert.deepEqual(runs, [], 'still working');
  await triggers.seen(data({ busy: false }));
  assert.deepEqual(runs, [{ path: WT, trigger: 'after-turn' }]);
  await triggers.seen(data({ busy: false }));
  assert.equal(runs.length, 1, 'once per turn');
});

test('a turn ending by asking you something counts too; a worktree no task has is never watched', async () => {
  const { triggers, runs } = setup();
  await triggers.seen(data({ busy: true, otherBusy: true }));
  await triggers.seen(data({ needsYou: true, otherBusy: false }));
  assert.deepEqual(runs, [{ path: WT, trigger: 'after-turn' }]);
});

test('the first look only learns what is going on; it starts nothing', async () => {
  const { triggers, runs } = setup();
  await triggers.seen(data({ busy: false }));
  await triggers.refsChanged(MAIN);
  assert.deepEqual(runs, []);
});

test('a new commit in a task\'s worktree runs its on-commit checks; a ref change that leaves HEAD alone does not', async () => {
  const { triggers, runs, heads } = setup();
  await triggers.seen(data());
  await triggers.refsChanged(MAIN);
  assert.deepEqual(runs, [], 'HEAD is where it was');
  heads.set(WT, 'h2');
  heads.set(OTHER, 'o2');
  await triggers.refsChanged(MAIN);
  assert.deepEqual(runs, [{ path: WT, trigger: 'on-commit' }]);
  await triggers.refsChanged('/r/elsewhere');
  assert.equal(runs.length, 1);
});

test('nothing is watched in repos without a check that runs by itself, or for closed tasks', async () => {
  for (const options of [{ watchedRepos: [] }, { tasks: [{ ...TASKS[0], closedAs: 'done' }] }]) {
    const { triggers, runs, heads } = setup(options);
    await triggers.seen(data({ busy: true }));
    await triggers.seen(data({ busy: false }));
    heads.set(WT, 'h2');
    await triggers.refsChanged(MAIN);
    assert.deepEqual(runs, [], JSON.stringify(options));
  }
});

test('events are handled one at a time, in order', async () => {
  const { triggers, runs, heads } = setup();
  await triggers.seen(data({ busy: true }));
  heads.set(WT, 'h2');
  // Both arrive before either is handled: the turn's end, then the commit.
  await Promise.all([triggers.seen(data({ busy: false })), triggers.refsChanged(MAIN)]);
  assert.deepEqual(runs.map((r) => r.trigger), ['after-turn', 'on-commit']);
});
