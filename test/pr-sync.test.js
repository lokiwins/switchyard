import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BACKGROUND_FACTOR, PACE, RETURN_FRESH_MS, createPrSync, duePrKeys, prInterval } from '../src/pr-sync.js';
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

test('the Worktrees page counts as an active viewer, and can read the sync without waiting on it', async () => {
  const { github } = fakeGithub();
  const c = clock();
  const sync = createPrSync({ ...github, now: c.now });
  const service = createPrService({ getLocalIndex: async () => new Map(), sync, now: c.now });

  assert.equal(service.syncSnapshot().loaded, false);
  service.markActive();
  assert.equal(service.pace(), 1);
  await sync.ensureLoaded();
  assert.equal(service.syncSnapshot().loaded, true);
  assert.equal(service.syncSnapshot().entries.size > 0, true);
  c.advance(60_000);
  assert.equal(service.pace(), BACKGROUND_FACTOR);
  c.advance(3 * 60_000);
  assert.equal(service.pace(), null);
});

const updated = (it, at) => ({ ...it, updatedAt: at });

test('the lists are searched often enough to catch a change within half a minute, inside GitHub\'s 30 searches a minute', () => {
  assert.ok(PACE.searchMs <= 30_000);
  // While the page is open: the two main lists each searchMs, the team list each teamSearchMs.
  const perMinute = 2 * (60_000 / PACE.searchMs) + 60_000 / PACE.teamSearchMs;
  assert.ok(perMinute <= 10, `${perMinute} searches a minute`);
});

test('a PR the list shows as updated (a push, review or comment) is fetched again at once, not at its next turn', async () => {
  const { github, calls } = fakeGithub({ authored: [updated(item(1), 't0'), updated(item(2), 't0')], details: { 1: pr(1, settled), 2: pr(2, settled) } });
  const c = clock();
  const sync = createPrSync({ ...github, now: c.now });
  await sync.ensureLoaded();
  calls.full.length = 0;

  github.lists.authored = [updated(item(1), 't0'), updated(item(2), 't1')];
  c.advance(PACE.searchMs);
  await sync.tick();

  assert.deepEqual(calls.full, [2]);
  // And it isn't fetched again for the same update.
  c.advance(PACE.searchMs);
  await sync.tick();
  assert.deepEqual(calls.full, [2]);
});

test('coming back to the page re-checks lists and PRs older than a few seconds, so changes made elsewhere show at once', async () => {
  const { github, calls } = fakeGithub({ details: { 1: pr(1, settled), 2: pr(2, settled) } });
  const c = clock();
  const sync = createPrSync({ ...github, now: c.now });
  await sync.ensureLoaded();
  calls.search = 0;
  calls.full.length = 0;

  // Just checked: nothing asked again.
  c.advance(RETURN_FRESH_MS - 1);
  await sync.tick({ freshWithin: RETURN_FRESH_MS });
  assert.equal(calls.search, 0);
  assert.deepEqual(calls.full, []);

  // A little older (well inside every regular interval): all of it is asked again.
  c.advance(1);
  await sync.tick({ freshWithin: RETURN_FRESH_MS });
  assert.equal(calls.search, 3);
  assert.deepEqual(calls.full.sort(), [1, 2]);
});

test('opening the PR page re-checks what is older than a few seconds', async () => {
  const { github, calls } = fakeGithub({ details: { 1: pr(1, settled), 2: pr(2, settled) } });
  const c = clock();
  const sync = createPrSync({ ...github, now: c.now });
  const service = createPrService({ getLocalIndex: async () => new Map(), sync, now: c.now });
  await service.getPrs();
  calls.full.length = 0;

  c.advance(RETURN_FRESH_MS);
  const unsubscribe = service.subscribe(() => {});
  await new Promise((resolve) => { setTimeout(resolve, 20); });
  unsubscribe();
  assert.deepEqual(calls.full.sort(), [1, 2]);
});

test('coming back while a regular check is running re-checks once that one finishes', async () => {
  const { github, calls } = fakeGithub({ details: { 1: pr(1, settled), 2: pr(2, settled) } });
  const c = clock();
  const sync = createPrSync({ ...github, now: c.now });
  await sync.ensureLoaded();
  calls.full.length = 0;

  c.advance(PACE.searchMs);
  const regular = sync.tick();
  await sync.tick({ freshWithin: RETURN_FRESH_MS });
  await regular;
  assert.deepEqual(calls.full.sort(), [1, 2]);
});

test('PRs awaiting your review carry their review agent\'s status, whether their repo is cloned here, and whether the PR moved on since', async () => {
  const { github } = fakeGithub({ details: { 1: pr(1, settled), 2: pr(2, settled), 5: pr(5, settled), 3: { ...pr(3, settled), repo: 'acme/other', headRefOid: 'new' } } });
  github.lists.direct = [item(5), item(3, 'acme/other')];
  const c = clock();
  const sync = createPrSync({ ...github, now: c.now });
  const review = { state: 'changes', headSha: 'old' };
  const agentReviews = async () => ({
    statusOf: (key) => ({ 'acme/app#5': review, 'acme/other#3': review })[key] ?? null,
    canReview: (repo) => repo === 'acme/app',
  });
  const service = createPrService({ getLocalIndex: async () => new Map(), sync, now: c.now, agentReviews });
  const page = await service.getPrs();

  const [five, three] = [5, 3].map((n) => page.reviewRequested.find((p) => p.number === n));
  assert.deepEqual([five.number, five.canAgentReview, five.agentReview.state, five.agentReview.outdated], [5, true, 'changes', false]);
  assert.deepEqual([three.number, three.canAgentReview, three.agentReview.outdated], [3, false, true]);
  assert.ok(page.authored.every((p) => p.agentReview === undefined), 'your own PRs have no Review');
});

test('a failure to read the reviews is an error on the page, not a broken page', async () => {
  const { github } = fakeGithub();
  github.lists.direct = [item(3)];
  const sync = createPrSync({ ...github, now: clock().now });
  const service = createPrService({ getLocalIndex: async () => new Map(), sync, agentReviews: async () => { throw new Error('disk full'); } });
  const page = await service.getPrs();
  assert.deepEqual(page.errors, [{ source: 'reviews', message: 'disk full' }]);
  assert.equal(page.reviewRequested[0].agentReview, null);
});

test('reviewsChanged pushes the page to its streams, and does nothing with none open', async () => {
  const { github } = fakeGithub();
  const sync = createPrSync({ ...github, now: clock().now });
  let reads = 0;
  const service = createPrService({ getLocalIndex: async () => new Map(), sync, agentReviews: async () => { reads += 1; return { statusOf: () => null, canReview: () => false }; } });
  await service.reviewsChanged();
  assert.equal(reads, 0);
  const pages = [];
  service.subscribe((page) => pages.push(page));
  await service.reviewsChanged();
  assert.equal(pages.length, 1);
});

test('a burst of changes builds the page once, then once more for the changes made while it built', async () => {
  const { github } = fakeGithub();
  const sync = createPrSync({ ...github, now: clock().now });
  let reads = 0;
  const service = createPrService({ getLocalIndex: async () => new Map(), sync, agentReviews: async () => { reads += 1; return { statusOf: () => null, canReview: () => false }; } });
  const pages = [];
  service.subscribe((page) => pages.push(page));
  await Promise.all(Array.from({ length: 10 }, () => service.reviewsChanged()));
  assert.equal(reads, 2);
  assert.equal(pages.length, 2);
});
