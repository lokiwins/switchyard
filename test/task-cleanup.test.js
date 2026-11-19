import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTaskCleanup } from '../src/task-cleanup.js';

const NOW = Date.UTC(2026, 10, 18, 12);
const MAIN = '/r/shop';
const FIX = '/r/shop-sy-abc123-fix';
const WIP = '/r/shop-sy-abc123-wip';
const OTHER = '/r/shop-other';
const TASK = { id: 'sy-abc123', title: 'Fix the cart', links: [] };

function world() {
  return {
    repos: [{
      name: 'shop',
      mainPath: MAIN,
      worktrees: [
        { path: MAIN, isMain: true, branch: 'main', agents: { live: [{ sessionId: 'main-live', cwd: MAIN }], recent: [] } },
        {
          path: FIX, isMain: false, branch: 'sy-abc123-fix', pr: { number: 1, state: 'MERGED', headRefOid: 'h1' },
          agents: { live: [{ sessionId: 'fix-live', cwd: FIX }], recent: [] },
        },
        { path: WIP, isMain: false, branch: 'sy-abc123-wip', pr: null, agents: { live: [], recent: [] } },
        { path: OTHER, isMain: false, branch: 'other-work', pr: null, agents: { live: [], recent: [] } },
      ],
    }],
    endedSessions: [
      { sessionId: 'fix-old', worktreePath: FIX, endedAt: NOW - 5000 },
      { sessionId: 'main-old', worktreePath: MAIN, endedAt: NOW - 5000 },
      { sessionId: 'other-old', worktreePath: OTHER, endedAt: NOW - 5000 },
    ],
    liveSessions: [{ sessionId: 'main-live', cwd: MAIN }, { sessionId: 'fix-live', cwd: FIX }],
  };
}

// git as the fake world has it: FIX is clean and merged, WIP has changes and commits main doesn't.
const GIT = {
  [`-C ${FIX} status --porcelain --untracked-files=all`]: '',
  [`-C ${FIX} rev-parse HEAD`]: 'h1\n',
  [`-C ${WIP} status --porcelain --untracked-files=all`]: ' M cart.js\n?? notes.txt\n',
  [`-C ${WIP} rev-parse HEAD`]: 'h2\n',
  [`-C ${WIP} rev-parse --verify --quiet refs/remotes/origin/main`]: 'r1\n',
  [`-C ${WIP} rev-list --count HEAD --not main refs/remotes/origin/main`]: '2\n',
};

function setup({ git = GIT, state = world(), endFails = new Set(), sessionsAfter = null } = {}) {
  const calls = [];
  const ended = [];
  const forgotten = [];
  const cleanup = createTaskCleanup({
    getState: async () => state,
    getSessions: async () => sessionsAfter ?? { liveSessions: state.liveSessions.filter((s) => !ended.includes(s.sessionId)) },
    endSession: async ({ sessionId }) => {
      if (endFails.has(sessionId)) throw new Error('tmux is gone');
      ended.push(sessionId);
      return { ended: true };
    },
    forgetSessions: async (sessions) => { forgotten.push(...sessions); },
    git: async (args) => {
      const key = args.join(' ');
      calls.push(key);
      if (git[key] instanceof Error) throw git[key];
      if (key in git) return git[key];
      if (/ worktree remove | branch -D /.test(` ${key} `)) return '';
      throw new Error(`unexpected git ${key}`);
    },
    now: () => NOW,
  });
  return { cleanup, calls, ended, forgotten };
}

test('closing a task ends its running sessions, but not ones on main it was never saved with', async () => {
  const { cleanup, ended } = setup();
  const result = await cleanup.afterClose(TASK);
  assert.deepEqual(ended, ['fix-live']);
  assert.deepEqual(result.ended, ['fix-live']);
});

test('its ended sessions, and the ones just ended, come off the lists; other worktrees\' stay', async () => {
  const { cleanup, forgotten } = setup();
  const result = await cleanup.afterClose(TASK);
  assert.deepEqual(forgotten.map((s) => s.sessionId).sort(), ['fix-live', 'fix-old']);
  assert.equal(forgotten.find((s) => s.sessionId === 'fix-old').endedAt, NOW - 5000);
  assert.equal(forgotten.find((s) => s.sessionId === 'fix-live').endedAt, NOW);
  assert.equal(result.hidden, 2);
});

test('a clean, merged worktree is removed without --force, and its merged branch deleted', async () => {
  const { cleanup, calls } = setup();
  const result = await cleanup.afterClose(TASK);
  assert.ok(calls.includes(`-C ${MAIN} worktree remove ${FIX}`));
  assert.ok(calls.includes(`-C ${MAIN} branch -D sy-abc123-fix`));
  assert.deepEqual(result.removed, [FIX]);
  assert.equal(calls.some((c) => c.includes('--force')), false);
});

test('a worktree with uncommitted changes or unmerged commits is left for you to choose, never removed', async () => {
  const { cleanup, calls } = setup();
  const result = await cleanup.afterClose(TASK);
  assert.equal(calls.some((c) => c.includes(`worktree remove ${WIP}`)), false);
  assert.deepEqual(result.choices, [{
    path: WIP, repoName: 'shop', branch: 'sy-abc123-wip', taskId: TASK.id, taskTitle: TASK.title, changes: 2, unmerged: 2,
  }]);
  assert.deepEqual(cleanup.pending(), result.choices);
});

test('the main checkout and other tasks\' worktrees are never touched', async () => {
  const { cleanup, calls } = setup();
  await cleanup.afterClose(TASK);
  assert.equal(calls.some((c) => c.includes(`-C ${OTHER}`) || c.endsWith(`remove ${MAIN}`) || c.includes(`-C ${MAIN} status`)), false);
});

test('a session saved on the task (on main) is ended and taken off the lists, but main stays', async () => {
  const state = world();
  const { cleanup, ended, forgotten, calls } = setup({ state });
  await cleanup.afterClose({ ...TASK, id: 'sy-zzz999', attached: [{ sessionId: 'main-live' }, { sessionId: 'main-old' }] });
  assert.deepEqual(ended, ['main-live']);
  assert.deepEqual(forgotten.map((s) => s.sessionId).sort(), ['main-live', 'main-old']);
  assert.equal(calls.some((c) => c.includes('worktree remove')), false);
});

test('a worktree whose session would not end is kept, and says why', async () => {
  const { cleanup, calls } = setup({ endFails: new Set(['fix-live']) });
  const result = await cleanup.afterClose(TASK);
  assert.equal(calls.some((c) => c.includes(`worktree remove ${FIX}`)), false);
  assert.match(result.errors.join(' '), /tmux is gone/);
});

test('a worktree whose branch has unpushed commits main lacks counts as unmerged even with no changes', async () => {
  const git = {
    ...GIT,
    [`-C ${WIP} status --porcelain --untracked-files=all`]: '',
    [`-C ${WIP} rev-parse --verify --quiet refs/remotes/origin/main`]: new Error('no ref'),
    [`-C ${WIP} rev-list --count HEAD --not main`]: '1\n',
  };
  const { cleanup } = setup({ git });
  const result = await cleanup.afterClose(TASK);
  assert.deepEqual(result.choices.map((c) => [c.path, c.changes, c.unmerged]), [[WIP, 0, 1]]);
});

test('Keep forgets the choice and leaves the worktree', async () => {
  const { cleanup, calls } = setup();
  await cleanup.afterClose(TASK);
  assert.deepEqual(await cleanup.choose({ path: WIP, keep: true }), { kept: WIP });
  assert.deepEqual(cleanup.pending(), []);
  assert.equal(calls.some((c) => c.includes(`worktree remove`) && c.includes(WIP)), false);
});

test('Delete removes the worktree with its changes, keeping the branch', async () => {
  const { cleanup, calls } = setup();
  await cleanup.afterClose(TASK);
  assert.deepEqual(await cleanup.choose({ path: WIP, keep: false }), { removed: WIP });
  assert.ok(calls.includes(`-C ${MAIN} worktree remove --force ${WIP}`));
  assert.equal(calls.some((c) => c.includes('branch -D sy-abc123-wip')), false);
  assert.deepEqual(cleanup.pending(), []);
});

test('Delete is refused for a worktree nobody asked about, or one a session is running in again', async () => {
  const state = world();
  const { cleanup } = setup({ state, sessionsAfter: { liveSessions: [{ sessionId: 'new', cwd: `${WIP}/src` }] } });
  await cleanup.afterClose(TASK);
  await assert.rejects(cleanup.choose({ path: OTHER, keep: false }), (e) => e.status === 404);
  await assert.rejects(cleanup.choose({ path: WIP, keep: false }), (e) => e.status === 409 && /running/.test(e.message));
  await assert.rejects(cleanup.choose({ path: 42 }), (e) => e.status === 400);
  // Delete is never what a missing answer means.
  await assert.rejects(cleanup.choose({ path: WIP }), (e) => e.status === 400);
});
