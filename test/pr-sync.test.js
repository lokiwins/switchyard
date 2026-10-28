import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BACKGROUND_FACTOR, PACE, createPrSync, duePrKeys, prInterval } from '../src/pr-sync.js';
import { createPrService } from '../src/prs.js';

const item = (number, repo = 'acme/app') => ({ number, repository: { nameWithOwner: repo }, url: `https://x/${number}`, title: `PR ${number}` });
const pr = (number, checks) => ({ repo: 'acme/app', number, url: `https://x/${number}`, title: `PR ${number}`, checks, headRefName: `b${number}` });
const running = { state: 'pending', pending: 2, passing: 1, failing: 0 };
const settled = { state: 'passing', pending: 0, passing: 3, failing: 0 };

function fakeGithub({ authored = [item(1), item(2)], details = { 1: pr(1, running), 2: pr(2, settled) } } = {}) {
  const calls = { search: 0, full: [] };
  const github = {
    lists: { authored, direct: [], team: [] },
    details,
    failing: new Set(),
    search: async (args) => {
      calls.search += 1;
      if (args[0] === '--author=@me') return github.lists.authored;
      return args[0] === 'user-review-requested:@me' ? github.lists.direct : github.lists.team;
    },
    fetchFull: async ({ number }) => {
      calls.full.push(number);
      if (github.failing.has(number)) throw new Error('HTTP 502');
      return github.details[number];
    },
  };
  return { github, calls };
}

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('PRs with running checks refresh fast, settled ones slowly, failed ones in between', () => {
  assert.equal(prInterval({ pr: pr(1, running) }), PACE.activePrMs);
  assert.equal(prInterval({ pr: pr(1, settled) }), PACE.idlePrMs);
  assert.equal(prInterval({ pr: null, error: 'boom' }), PACE.failedPrMs);
  const entries = new Map([['a', { pr: pr(1, running), fetchedAt: 0 }], ['b', { pr: pr(2, settled), fetchedAt: 0 }]]);
  assert.deepEqual(duePrKeys(entries, PACE.activePrMs), ['a']);
  assert.deepEqual(duePrKeys(entries, PACE.activePrMs, { factor: BACKGROUND_FACTOR }), []);
});

test('the first load fetches every list and PR and reports a change', async () => {
  const { github, calls } = fakeGithub();
  let changes = 0;
  const sync = createPrSync({ ...github, now: clock().now, onUpdate: () => { changes += 1; } });

  await sync.ensureLoaded();
  await sync.ensureLoaded();

  assert.equal(calls.search, 3);
  assert.deepEqual(calls.full.sort(), [1, 2]);
  assert.equal(changes, 1);
  assert.equal(sync.snapshot().entries.size, 2);
});

test('ticks only ask GitHub for what is due, and only then report an update', async () => {
  const { github, calls } = fakeGithub();
  const c = clock();
  let updates = 0;
  const sync = createPrSync({ ...github, now: c.now, onUpdate: () => { updates += 1; } });
  await sync.ensureLoaded();
  const loadedAt = sync.snapshot().syncedAt;
  calls.full.length = 0;

  c.advance(5_000);
  await sync.tick();
  assert.deepEqual(calls.full, []);
  assert.equal(updates, 1);
  assert.equal(sync.snapshot().syncedAt, loadedAt);

  c.advance(PACE.activePrMs);
  await sync.tick();
  assert.deepEqual(calls.full, [1]);
  assert.equal(updates, 2);
  assert.equal(sync.snapshot().syncedAt, c.now());
});

test('a new PR in the list is fetched on the next tick, and a dropped one is forgotten', async () => {
  const { github, calls } = fakeGithub();
  const c = clock();
  const sync = createPrSync({ ...github, now: c.now });
  await sync.ensureLoaded();
  calls.full.length = 0;

  github.lists.authored = [item(2), item(3)];
  github.details[3] = pr(3, settled);
  c.advance(PACE.searchMs);
  await sync.tick();

  assert.ok(calls.full.includes(3));
  assert.deepEqual([...sync.snapshot().entries.keys()].sort(), ['acme/app#2', 'acme/app#3']);
});

test('a failed refresh keeps the last good details and records the error', async () => {
  const { github } = fakeGithub();
  const c = clock();
  const sync = createPrSync({ ...github, now: c.now });
  await sync.ensureLoaded();

  github.failing.add(1);
  c.advance(PACE.activePrMs);
  await sync.tick();

  const entry = sync.snapshot().entries.get('acme/app#1');
  assert.equal(entry.pr.number, 1);
  assert.equal(entry.error, 'HTTP 502');
});

test('the service paces refreshes by audience: streams, recent requests, then nothing', async () => {
  const { github } = fakeGithub();
  const c = clock();
  const sync = createPrSync({ ...github, now: c.now });
  const service = createPrService({ getLocalIndex: async () => new Map(), sync, now: c.now });

  assert.equal(service.pace(), null);
  await service.getPrs();
  assert.equal(service.pace(), BACKGROUND_FACTOR);
  const unsubscribe = service.subscribe(() => {});
  assert.equal(service.pace(), 1);
  unsubscribe();
  c.advance(3 * 60_000);
  assert.equal(service.pace(), null);
});

test('the page shows when each PR was checked and flags failed refreshes', async () => {
  const { github } = fakeGithub();
  const c = clock();
  const sync = createPrSync({ ...github, now: c.now });
  const service = createPrService({ getLocalIndex: async () => new Map(), sync, now: c.now });
  await service.getPrs();
  github.failing.add(2);
  c.advance(PACE.idlePrMs);
  await sync.tick();

  const page = await service.getPrs();
  const two = page.authored.find((p) => p.number === 2);
  assert.equal(two.refreshError, 'HTTP 502');
  assert.equal(two.stage, 'awaiting-review');
  assert.equal(page.syncedAt, c.now());
  assert.ok(page.authored.every((p) => Number.isFinite(p.fetchedAt)));
});
