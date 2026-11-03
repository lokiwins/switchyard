import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStatusTracker } from '../src/status-tracker.js';

const MAIN = '/w/app';
const FEAT = '/w/app-feat';
const OTHER = '/w/other';

const repos = [
  { mainPath: MAIN, worktrees: [{ path: MAIN }, { path: FEAT }] },
  { mainPath: OTHER, worktrees: [{ path: OTHER }] },
];
const allWorktrees = repos.flatMap((r) => r.worktrees);

/** A fake fs.watch: tests fire events at a watched root by hand. */
function fakeFs() {
  const watchers = new Map();
  const watch = (root, options, listener) => {
    if (root === '/w/missing') throw new Error('ENOENT');
    const handlers = {};
    const watcher = {
      closed: false,
      close() { this.closed = true; watchers.delete(root); },
      on(event, handler) { handlers[event] = handler; return this; },
      unref() {},
    };
    watchers.set(root, { watcher, listener, handlers, options });
    return watcher;
  };
  const fire = (root, filename) => watchers.get(root).listener('change', filename);
  const fail = (root) => watchers.get(root).handlers.error(new Error('watch died'));
  return { watch, watchers, fire, fail };
}

function setup({ recheckMs = 60_000 } = {}) {
  const fs = fakeFs();
  let time = 1000;
  const scanned = [];
  const tracker = createStatusTracker({
    watch: fs.watch,
    readGitFile: async (path) => {
      if (path === `${FEAT}/.git`) return `gitdir: ${MAIN}/.git/worktrees/app-feat\n`;
      throw new Error('EISDIR');
    },
    getStatuses: async (worktrees) => {
      scanned.push(...worktrees.map((w) => w.path));
      return worktrees.map((w) => ({ path: w.path, at: time }));
    },
    now: () => time,
    recheckMs,
  });
  const scan = async () => {
    scanned.length = 0;
    await tracker.track(repos);
    const statuses = await tracker.statuses(allWorktrees);
    return { statuses, scanned: [...scanned] };
  };
  return { tracker, fs, scan, advance: (ms) => { time += ms; } };
}

test('the first scan runs git status everywhere and watches each worktree', async () => {
  const { fs, scan } = setup();
  const { statuses, scanned } = await scan();
  assert.deepEqual(scanned, [MAIN, FEAT, OTHER]);
  assert.deepEqual(statuses.map((s) => s.path), [MAIN, FEAT, OTHER]);
  assert.deepEqual([...fs.watchers.keys()].sort(), [MAIN, FEAT, OTHER].sort());
  assert.equal(fs.watchers.get(MAIN).options.recursive, true);
});

test('worktrees with no file changes reuse their last status', async () => {
  const { scan, advance } = setup();
  const first = await scan();
  advance(5000);
  const second = await scan();
  assert.deepEqual(second.scanned, []);
  assert.deepEqual(second.statuses, first.statuses);
});

test('a file change rescans only the worktree it happened in', async () => {
  const { fs, scan } = setup();
  await scan();
  fs.fire(FEAT, 'src/index.js');
  assert.deepEqual((await scan()).scanned, [FEAT]);
  assert.deepEqual((await scan()).scanned, []);
});

test("git data under the main checkout's .git is routed to the worktree it belongs to", async () => {
  const { fs, scan } = setup();
  await scan();
  fs.fire(MAIN, '.git/worktrees/app-feat/index');
  assert.deepEqual((await scan()).scanned, [FEAT]);
  fs.fire(MAIN, '.git/index');
  assert.deepEqual((await scan()).scanned, [MAIN]);
});

test('a ref change rescans every worktree of that repo, since ahead/behind may move', async () => {
  const { fs, scan } = setup();
  await scan();
  fs.fire(MAIN, '.git/refs/remotes/origin/feat');
  assert.deepEqual((await scan()).scanned, [MAIN, FEAT]);
  fs.fire(MAIN, '.git/packed-refs');
  assert.deepEqual((await scan()).scanned, [MAIN, FEAT]);
});

test('git writes that cannot change status, and watchman cookies, never trigger a rescan', async () => {
  const { fs, scan } = setup();
  await scan();
  fs.fire(MAIN, '.git/objects/ab/cdef');
  fs.fire(MAIN, '.git/logs/HEAD');
  fs.fire(MAIN, '.git/worktrees/app-feat/index.lock');
  fs.fire(MAIN, '.git/worktrees/app-feat/logs/HEAD');
  fs.fire(MAIN, '.git/.watchman-cookie-host-1-2');
  fs.fire(MAIN, '.git/FETCH_HEAD');
  fs.fire(FEAT, '.watchman-cookie-host-1-3');
  assert.deepEqual((await scan()).scanned, []);
});

test('a change that lands while git status is running is picked up by the next scan', async () => {
  const fs = fakeFs();
  let time = 1000;
  const scanned = [];
  const tracker = createStatusTracker({
    watch: fs.watch,
    readGitFile: async () => { throw new Error('EISDIR'); },
    getStatuses: async (worktrees) => {
      scanned.push(...worktrees.map((w) => w.path));
      time += 10;
      fs.fire(OTHER, 'mid-scan.txt');
      return worktrees.map(() => ({}));
    },
    now: () => time,
  });
  const only = [{ mainPath: OTHER, worktrees: [{ path: OTHER }] }];
  await tracker.track(only);
  await tracker.statuses(only[0].worktrees);
  scanned.length = 0;
  await tracker.statuses(only[0].worktrees);
  assert.deepEqual(scanned, [OTHER]);
});

test('every worktree is rechecked once its status is older than the recheck interval', async () => {
  const { scan, advance } = setup({ recheckMs: 60_000 });
  await scan();
  advance(61_000);
  assert.deepEqual((await scan()).scanned, [MAIN, FEAT, OTHER]);
});

test('a watcher that fails is dropped, so its worktrees are scanned until it is re-created', async () => {
  const { fs, scan } = setup();
  await scan();
  fs.fail(OTHER);
  assert.equal(fs.watchers.has(OTHER), false);
  assert.deepEqual((await scan()).scanned, [OTHER]);
  assert.equal(fs.watchers.has(OTHER), true);
});

test('a folder that cannot be watched is simply scanned every time', async () => {
  const fs = fakeFs();
  const scanned = [];
  const tracker = createStatusTracker({
    watch: fs.watch,
    readGitFile: async () => { throw new Error('ENOENT'); },
    getStatuses: async (worktrees) => { scanned.push(...worktrees.map((w) => w.path)); return worktrees.map(() => ({})); },
  });
  const missing = [{ mainPath: '/w/missing', worktrees: [{ path: '/w/missing' }] }];
  await tracker.track(missing);
  await tracker.statuses(missing[0].worktrees);
  await tracker.statuses(missing[0].worktrees);
  assert.deepEqual(scanned, ['/w/missing', '/w/missing']);
});

test('worktrees that disappear stop being watched', async () => {
  const { tracker, fs, scan } = setup();
  await scan();
  await tracker.track([repos[1]]);
  assert.deepEqual([...fs.watchers.keys()], [OTHER]);
});

test('an event without a file name rescans everything under that watcher', async () => {
  const { fs, scan } = setup();
  await scan();
  fs.fire(MAIN, null);
  assert.deepEqual((await scan()).scanned, [MAIN, FEAT]);
});
