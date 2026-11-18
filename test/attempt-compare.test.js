import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAttemptCompare } from '../src/attempt-compare.js';

const NOW = Date.UTC(2026, 10, 18, 12);
const MAIN = '/r/shop';
const BASE = 'sy-abc123-fix-cart';
const path = (n) => `/r/shop-${BASE}-try${n}`;
const GROUP = { provider: 'claude', repo: MAIN, branches: [1, 2, 3].map((n) => `${BASE}-try${n}`), startedAt: NOW - 3_600_000 };
const TASK = { id: 'sy-abc123', title: 'Fix the cart', links: [], attempts: GROUP };

function world() {
  const wt = (n, extra = {}) => ({
    path: path(n), isMain: false, branch: `${BASE}-try${n}`, pr: null, lastActivityAt: NOW - n * 60_000, agents: { live: [], recent: [] }, ...extra,
  });
  return {
    repos: [{
      name: 'shop',
      mainPath: MAIN,
      worktrees: [
        { path: MAIN, isMain: true, branch: 'main', agents: { live: [], recent: [] } },
        wt(1, { agents: { live: [{ sessionId: 's1', status: 'busy', needsYou: false, transcript: { contextTokens: 31000 } }], recent: [] } }),
        wt(2, { pr: { number: 7, url: 'https://github.com/o/shop/pull/7', state: 'OPEN' }, agents: { live: [{ sessionId: 's2', status: 'idle', needsYou: true, transcript: { contextTokens: 12000 } }], recent: [] } }),
        // Attempt 3's worktree is gone (deleted), its branch left.
      ],
    }],
  };
}

const GIT = {
  [`-C ${path(1)} merge-base HEAD main`]: 'b0\n',
  [`-C ${path(1)} diff --numstat b0`]: '10\t2\tsrc/cart.js\n-\t-\tlogo.png\n',
  [`-C ${path(1)} status --porcelain --untracked-files=all`]: ' M src/cart.js\n?? notes.md\n',
  [`-C ${path(1)} rev-list --count b0..HEAD`]: '2\n',
  [`-C ${path(2)} merge-base HEAD main`]: 'b0\n',
  [`-C ${path(2)} diff --numstat b0`]: '',
  [`-C ${path(2)} status --porcelain --untracked-files=all`]: '',
  [`-C ${path(2)} rev-list --count b0..HEAD`]: '0\n',
};

function setup({ task = TASK, git = GIT, cleanupResult = { ended: ['s2'], hidden: 1, removed: [path(2)], choices: [], errors: [] } } = {}) {
  const recorded = [];
  const putAway = [];
  const tasks = [task];
  const compare = createAttemptCompare({
    taskHub: { list: async () => tasks, recordAttempts: async (id, group) => { recorded.push([id, group]); } },
    getState: async () => world(),
    putAwayWorktrees: async (t, options) => { putAway.push([t.id, options]); return cleanupResult; },
    git: async (args) => {
      const key = args.join(' ');
      if (git[key] instanceof Error) throw git[key];
      if (key in git) return git[key];
      throw new Error(`unexpected git ${key}`);
    },
    now: () => NOW,
  });
  return { compare, recorded, putAway };
}

test('each attempt: what it changed against main, its commits, PR, session, activity and context', async () => {
  const { compare } = setup();
  const result = await compare.compare({ id: TASK.id });
  assert.equal(result.picked, null);
  const [one, two, three] = result.attempts;
  assert.deepEqual(one, {
    n: 1, branch: `${BASE}-try1`, path: path(1), present: true,
    state: 'working', pr: null, lastActivityAt: NOW - 60_000, contextTokens: 31000, commits: 2, check: null,
    changes: {
      files: [{ path: 'src/cart.js', added: 10, removed: 2 }, { path: 'logo.png', added: null, removed: null }, { path: 'notes.md', added: null, removed: null, untracked: true }],
      added: 10, removed: 2,
    },
  });
  assert.equal(two.state, 'needs-you');
  assert.deepEqual(two.pr, { number: 7, url: 'https://github.com/o/shop/pull/7', state: 'OPEN' });
  assert.deepEqual(two.changes, { files: [], added: 0, removed: 0 });
  assert.deepEqual(three, { n: 3, branch: `${BASE}-try3`, path: null, present: false });
});

test('an attempt whose session ended is idle, one with none is not running; a git failure leaves just its numbers out', async () => {
  const git = { ...GIT, [`-C ${path(2)} merge-base HEAD main`]: new Error('no merge base') };
  const { compare } = setup({ git });
  const [, two] = (await compare.compare({ id: TASK.id })).attempts;
  assert.equal(two.changes, null);
  assert.equal(two.commits, null);
  assert.equal(two.state, 'needs-you');
});

test('compare is a 404 for a task that is gone or never started as attempts', async () => {
  await assert.rejects(setup().compare.compare({ id: 'sy-gone00' }), (e) => e.status === 404);
  await assert.rejects(setup({ task: { ...TASK, attempts: undefined } }).compare.compare({ id: TASK.id }), (e) => e.status === 404 && /attempts/.test(e.message));
});

test('Pick keeps one attempt, puts the others away, and records the pick', async () => {
  const { compare, recorded, putAway } = setup();
  const result = await compare.pick({ id: TASK.id, branch: `${BASE}-try1` });
  assert.deepEqual(putAway, [[TASK.id, { branches: [`${BASE}-try2`, `${BASE}-try3`] }]]);
  assert.deepEqual(recorded, [[TASK.id, { ...GROUP, picked: `${BASE}-try1`, pickedAt: NOW }]]);
  assert.equal(result.picked, `${BASE}-try1`);
  assert.deepEqual(result.cleanup.removed, [path(2)]);
});

test('Pick refuses a branch that is not one of the attempts, a missing branch, or a second pick', async () => {
  await assert.rejects(setup().compare.pick({ id: TASK.id, branch: 'main' }), (e) => e.status === 400);
  await assert.rejects(setup().compare.pick({ id: TASK.id }), (e) => e.status === 400);
  const picked = { ...TASK, attempts: { ...GROUP, picked: `${BASE}-try2`, pickedAt: NOW } };
  const { compare, putAway } = setup({ task: picked });
  await assert.rejects(compare.pick({ id: TASK.id, branch: `${BASE}-try1` }), (e) => e.status === 409 && /already/.test(e.message));
  assert.deepEqual(putAway, []);
});

test('Pick refuses an attempt whose worktree is gone', async () => {
  const { compare, putAway } = setup();
  await assert.rejects(compare.pick({ id: TASK.id, branch: `${BASE}-try3` }), (e) => e.status === 409 && /worktree/.test(e.message));
  assert.deepEqual(putAway, []);
});

test('an attempt counts as active no earlier than when the attempts started, not when its base commit was made', async () => {
  const { compare } = setup();
  const [one] = (await compare.compare({ id: TASK.id })).attempts;
  assert.equal(one.lastActivityAt, NOW - 60_000);
  const old = createAttemptCompareWith({ lastActivityAt: NOW - 10 * 86_400_000 });
  const [stale] = (await old.compare({ id: TASK.id })).attempts;
  assert.equal(stale.lastActivityAt, GROUP.startedAt);
});

function createAttemptCompareWith(worktreeExtra) {
  const base = world();
  base.repos[0].worktrees[1] = { ...base.repos[0].worktrees[1], ...worktreeExtra };
  return createAttemptCompare({
    taskHub: { list: async () => [TASK], recordAttempts: async () => {} },
    getState: async () => base,
    putAwayWorktrees: async () => ({}),
    git: async (args) => GIT[args.join(' ')] ?? '',
    now: () => NOW,
  });
}

test('each attempt carries its latest check, and whether its repo has a check command', async () => {
  const checked = createAttemptCompare({
    taskHub: { list: async () => [TASK], recordAttempts: async () => {} },
    getState: async () => world(),
    putAwayWorktrees: async () => ({}),
    git: async (args) => GIT[args.join(' ')] ?? '',
    checks: {
      results: async ({ repos }) => (repos[0].name === 'shop' ? { [path(1)]: { state: 'failed', exitCode: 1, outOfDate: false } } : {}),
      repos: () => ['shop'],
    },
    now: () => NOW,
  });
  const result = await checked.compare({ id: TASK.id });
  assert.equal(result.canCheck, true);
  assert.deepEqual(result.attempts[0].check, { state: 'failed', exitCode: 1, outOfDate: false });
  assert.equal(result.attempts[1].check, null);
  assert.equal(result.attempts[2].check, undefined, 'a gone attempt has nothing to check');
  assert.equal((await setup().compare.compare({ id: TASK.id })).canCheck, false);
});
