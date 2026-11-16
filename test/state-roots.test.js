import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createSwrCache } from '../src/cache.js';
import { createStateService } from '../src/state.js';
import { createStatusTracker } from '../src/status-tracker.js';

// Real repos in a temporary root; the root's folder events are fired by hand.
let base;
const claude = {
  liveSessions: async () => [], latestSession: async () => null, recentSessions: async () => [], endedSessions: async () => [],
};
const newRepo = (dir) => {
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
};

before(async () => { base = await realpath(await mkdtemp(join(tmpdir(), 'switchyard-roots-'))); });
after(() => rm(base, { recursive: true, force: true }));

let rootCount = 0;
async function setup({ watchable = true } = {}) {
  rootCount += 1;
  const root = join(base, `root${rootCount}`);
  newRepo(join(root, 'first'));
  let time = 1_000_000;
  const watched = new Map();
  const watchRoot = (dir, listener) => {
    if (!watchable) throw new Error('EPERM');
    const watcher = { on() { return this; }, close() { watched.delete(dir); }, unref() {} };
    watched.set(dir, listener);
    return watcher;
  };
  const service = createStateService({
    config: { roots: [root] },
    claude,
    cache: createSwrCache({ now: () => time }),
    statusTracker: createStatusTracker({ watch: () => { throw new Error('not watched in this test'); } }),
    watchRoot,
    now: () => time,
  });
  const names = async () => {
    // A rediscovery runs in the background (the cached list answers meanwhile); give it a moment.
    await service.refreshSessions();
    await new Promise((resolve) => setTimeout(resolve, 300));
    return (await service.refreshSessions()).repos.map((r) => r.name).sort();
  };
  return { root, service, watched, names, advance: (ms) => { time += ms; } };
}

test('roots: a repo added under a root is found once the root folder reports a change', async () => {
  const { root, watched, names } = await setup();
  assert.deepEqual(await names(), ['first']);
  assert.equal(watched.has(root), true);
  newRepo(join(root, 'second'));
  assert.deepEqual(await names(), ['first'], 'no folder event yet: the cached list is used');
  watched.get(root)('rename', 'second');
  assert.deepEqual(await names(), ['first', 'second']);
});

test('roots: with a watched root, the repo list is not looked for again every minute', async () => {
  const { root, names, advance } = await setup();
  await names();
  newRepo(join(root, 'second'));
  advance(61_000);
  assert.deepEqual(await names(), ['first']);
  advance(10 * 60_000);
  assert.deepEqual(await names(), ['first', 'second'], 'the 10-minute safety net still finds it');
});

test('roots: a root that cannot be watched is looked through again every minute, as before', async () => {
  const { root, watched, names, advance } = await setup({ watchable: false });
  await names();
  assert.equal(watched.size, 0);
  newRepo(join(root, 'second'));
  advance(61_000);
  assert.deepEqual(await names(), ['first', 'second']);
});
