import { mapLimit } from './exec.js';
import { fetchPrFull, searchOpenPrs } from './github.js';
import { DEFAULT_SETTINGS } from './settings.js';

/**
 * How often to ask GitHub, when the PR page is open. PRs with checks still
 * running change often; settled PRs rarely do, and when one does (a push, a
 * review, a comment) the list's search shows it updated, so it's fetched then.
 * GitHub allows 30 searches a minute; these use under 10. When only a header
 * badge is watching everything runs BACKGROUND_FACTOR times slower, and
 * nothing is fetched while no page is open at all.
 */
export const PACE = Object.freeze({
  activePrMs: 20_000,
  idlePrMs: 120_000,
  failedPrMs: 60_000,
  searchMs: 30_000,
  teamSearchMs: 300_000,
});
// Coming back to the PR page re-checks anything older than this: you may have changed it on GitHub.
export const RETURN_FRESH_MS = 15_000;
export const BACKGROUND_FACTOR = 3;
const PR_CONCURRENCY = 4;

const SEARCHES = {
  authored: ['--author=@me'],
  direct: ['user-review-requested:@me'],
  team: ['--review-requested=@me'],
};

const prKey = (item) => `${item.repository.nameWithOwner}#${item.number}`;

/** How long a PR's details stay fresh: short while its checks are running. */
export function prInterval(entry, pace = PACE) {
  if (entry.error) return pace.failedPrMs;
  return entry.pr?.checks?.pending > 0 ? pace.activePrMs : pace.idlePrMs;
}

/** Keys of tracked PRs whose details are due for a refresh (none waits longer than `freshWithin`). */
export function duePrKeys(entries, now, { pace = PACE, factor = 1, freshWithin = Infinity } = {}) {
  return [...entries]
    .filter(([, entry]) => now - entry.fetchedAt >= Math.min(prInterval(entry, pace) * factor, freshWithin))
    .map(([key]) => key);
}

/**
 * Keeps an in-memory copy of your PRs and refreshes it on a schedule, calling
 * `onUpdate` after every round that actually asked GitHub something, so the
 * page can show both changes and how recently it was checked.
 */
export function createPrSync({
  settings = DEFAULT_SETTINGS,
  search = searchOpenPrs,
  fetchFull = (ref) => fetchPrFull(ref, settings.ci),
  now = Date.now,
  onUpdate = () => {},
}) {
  const lists = { authored: null, direct: null, team: null };
  const listFetchedAt = { authored: 0, direct: 0, team: 0 };
  const entries = new Map(); // key -> { item, pr, error, fetchedAt }
  const errors = new Map(); // source -> message
  let syncedAt = 0;
  let loading = null;
  let ticking = false;
  // A tick asked for while one runs, run after it (so a return to the page isn't lost).
  let queued = null;

  function tracked() {
    const items = [...(lists.authored ?? []), ...(lists.direct ?? [])];
    return new Map(items.map((item) => [prKey(item), item]));
  }

  async function refreshList(name) {
    try {
      lists[name] = await search(SEARCHES[name]);
      errors.delete(`search:${name}`);
    } catch (error) {
      errors.set(`search:${name}`, error.message);
    } finally {
      listFetchedAt[name] = now();
    }
  }

  async function refreshEntry(key, item) {
    const previous = entries.get(key);
    try {
      const pr = await fetchFull({ repo: item.repository.nameWithOwner, number: item.number });
      entries.set(key, { item, pr, error: null, fetchedAt: now() });
    } catch (error) {
      // Keep the last good details; just note the failure and retry sooner.
      entries.set(key, { item, pr: previous?.pr ?? null, error: error.message, fetchedAt: now() });
    }
  }

  /**
   * Drop PRs that left the lists; start tracking new ones. Returns the keys
   * needing a fetch: new ones, and ones the list shows updated since theirs.
   */
  function reconcile() {
    const current = tracked();
    for (const key of entries.keys()) if (!current.has(key)) entries.delete(key);
    return [...current].filter(([key, item]) => {
      const entry = entries.get(key);
      return !entry || (item.updatedAt !== undefined && item.updatedAt !== entry.item.updatedAt);
    });
  }

  /** Record a round of fetches; rounds where nothing was due change nothing. */
  function finish(fetchedCount) {
    if (fetchedCount === 0) return;
    syncedAt = now();
    onUpdate();
  }

  async function refreshAll() {
    const names = Object.keys(SEARCHES);
    await Promise.all(names.map(refreshList));
    reconcile();
    const items = [...tracked()];
    await mapLimit(items, PR_CONCURRENCY, ([key, item]) => refreshEntry(key, item));
    finish(names.length + items.length);
  }

  /** The first caller waits for a full load; everyone after reads the in-memory copy. */
  function ensureLoaded() {
    loading ??= refreshAll().catch((error) => {
      loading = null;
      throw error;
    });
    return loading;
  }

  /**
   * Refresh whatever is due. `factor` stretches every interval (used when only
   * badges are watching); `freshWithin` caps them (used when the page comes back).
   */
  async function tick({ factor = 1, freshWithin = Infinity } = {}) {
    if (!loading) return;
    if (ticking) {
      queued = { factor: Math.min(factor, queued?.factor ?? factor), freshWithin: Math.min(freshWithin, queued?.freshWithin ?? Infinity) };
      return;
    }
    ticking = true;
    try {
      const t = now();
      const isDue = (name, ms) => t - listFetchedAt[name] >= Math.min(ms * factor, freshWithin);
      const dueLists = ['authored', 'direct'].filter((name) => isDue(name, PACE.searchMs));
      if (isDue('team', PACE.teamSearchMs)) dueLists.push('team');
      await Promise.all(dueLists.map(refreshList));
      const changed = reconcile();
      const changedKeys = new Set(changed.map(([key]) => key));
      const items = tracked();
      const stale = duePrKeys(entries, t, { factor, freshWithin }).filter((key) => !changedKeys.has(key));
      const due = [...changed, ...stale.map((key) => [key, items.get(key)])];
      await mapLimit(due, PR_CONCURRENCY, ([key, item]) => refreshEntry(key, item));
      finish(dueLists.length + due.length);
    } finally {
      ticking = false;
      const next = queued;
      queued = null;
      if (next) await tick(next);
    }
  }

  /** Refresh one PR right away, e.g. after requesting a review on it. */
  async function refreshPr({ repo, number }) {
    const key = `${repo}#${number}`;
    const item = tracked().get(key);
    if (!item) return;
    await refreshEntry(key, item);
    finish(1);
  }

  function snapshot() {
    return {
      // False until the first search returns, so callers can tell "no PRs" from "not loaded yet".
      loaded: lists.authored !== null,
      authored: lists.authored ?? [],
      direct: lists.direct ?? [],
      team: lists.team ?? [],
      entries,
      syncedAt,
      errors: [...errors].map(([source, message]) => ({ source: 'github', message: `${source}: ${message}` })),
    };
  }

  return { ensureLoaded, refreshAll, refreshPr, tick, snapshot };
}
