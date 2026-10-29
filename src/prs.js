import { ActionError } from './errors.js';
import { isCopilotLogin, requestCopilotReview } from './github.js';
import { BACKGROUND_FACTOR, createPrSync } from './pr-sync.js';
import { DEFAULT_SETTINGS } from './settings.js';

// How often the scheduler looks for due refreshes, and how long a page or badge
// request keeps it running once no PR page stream is open.
const TICK_MS = 5_000;
const WATCH_GRACE_MS = 2 * 60_000;
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export { ActionError };

/** Most urgent first; the PR page sorts by this. */
export const STAGE_ORDER = [
  'merge-conflict',
  'checks-failing',
  'changes-requested',
  'ready',
  'blocked',
  'needs-update',
  'checks-running',
  'awaiting-review',
  'draft',
  'unknown',
];

/** The single headline status for a PR: the most urgent thing about it. */
export function prStage(pr) {
  if (pr.error) return 'unknown';
  if (pr.isDraft) return 'draft';
  if (pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY') return 'merge-conflict';
  if (pr.checks?.state === 'failing') return 'checks-failing';
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'changes-requested';
  if (pr.checks?.state === 'pending') return 'checks-running';
  if (pr.mergeStateStatus === 'BEHIND') return 'needs-update';
  const approved = pr.reviewDecision === 'APPROVED' || (!pr.reviewDecision && pr.mergeStateStatus === 'CLEAN');
  if (approved) return pr.mergeStateStatus === 'BLOCKED' ? 'blocked' : 'ready';
  return 'awaiting-review';
}

/** Whether Copilot has reviewed this PR and whether a Copilot review is currently requested. */
export function copilotStatus(pr, reviewer = DEFAULT_SETTINGS.github.copilotReviewer) {
  const review = (pr.reviews ?? []).find((r) => isCopilotLogin(r.login, reviewer));
  return {
    requested: (pr.requested ?? []).some((r) => !r.isTeam && isCopilotLogin(r.name, reviewer)),
    lastReviewedAt: review?.submittedAt ?? null,
  };
}

/** Validate an action body: { repo: "owner/name", number: positive integer }. */
export function parsePrRef(body) {
  const repo = typeof body?.repo === 'string' ? body.repo : '';
  const number = Number(body?.number);
  if (!REPO_PATTERN.test(repo) || !Number.isInteger(number) || number <= 0) {
    throw new ActionError(400, 'Expected { repo: "owner/name", number: <positive integer> }');
  }
  return { repo, number };
}

export function sortByStage(prs) {
  const rank = (pr) => STAGE_ORDER.indexOf(pr.stage);
  return [...prs].sort((a, b) => rank(a) - rank(b) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

/** Index local worktrees by "owner/repo#branch" so PRs can link to where they are checked out. */
export function buildLocalIndex(state) {
  const entries = state.repos.flatMap((repo) => (repo.github ? repo.worktrees : [])
    .filter((w) => w.branch)
    .map((w) => [`${repo.github}#${w.branch}`, {
      path: w.path,
      dirty: w.flags.includes('dirty'),
      agents: w.agents.live.map((s) => ({ name: s.name, status: s.status, parked: Boolean(s.parked) })),
      // Recent sessions in this checkout, for the "Open ▾" menu's resume choices.
      sessions: w.agents.recent ?? [],
    }]));
  return new Map(entries);
}

function lightPr(item) {
  return {
    repo: item.repository.nameWithOwner,
    number: item.number,
    title: item.title,
    url: item.url,
    isDraft: item.isDraft,
    updatedAt: item.updatedAt,
    author: item.author?.login ?? null,
    commentsCount: item.commentsCount ?? 0,
  };
}

/** Details for a tracked PR, falling back to its search result if they never loaded. */
function prFromEntry(item, entry) {
  if (!entry?.pr) return { ...lightPr(item), error: entry?.error ?? 'Not loaded yet', fetchedAt: entry?.fetchedAt ?? null };
  return { ...entry.pr, fetchedAt: entry.fetchedAt, refreshError: entry.error };
}

/**
 * The pull requests page. Data comes from an in-memory copy kept fresh by a
 * scheduler that runs at full pace while a PR page is streaming, slower while
 * only header badges ask, and not at all when nothing is open.
 */
export function createPrService({ getLocalIndex, settings = DEFAULT_SETTINGS, sync = null, now = Date.now }) {
  const listeners = new Set();
  let lastTouched = 0;
  let timer = null;
  const prSync = sync ?? createPrSync({ settings, onUpdate: () => notify() });

  async function build() {
    await prSync.ensureLoaded();
    const snap = prSync.snapshot();
    const errors = [...snap.errors];
    const local = await getLocalIndex().catch((error) => {
      errors.push({ source: 'local', message: error.message });
      return new Map();
    });
    const key = (item) => `${item.repository.nameWithOwner}#${item.number}`;
    const enrich = (item) => {
      const pr = prFromEntry(item, snap.entries.get(key(item)));
      return {
        ...pr,
        stage: prStage(pr),
        copilot: pr.error ? null : copilotStatus(pr, settings.github.copilotReviewer),
        local: local.get(`${pr.repo}#${pr.headRefName}`) ?? null,
      };
    };
    const authoredKeys = new Set(snap.authored.map(key));
    const detailedKeys = new Set([...snap.authored, ...snap.direct].map(key));
    return {
      generatedAt: now(),
      syncedAt: snap.syncedAt,
      authored: sortByStage(snap.authored.map(enrich)),
      reviewRequested: sortByStage(snap.direct.filter((item) => !authoredKeys.has(key(item))).map(enrich)),
      teamReviewRequested: snap.team
        .filter((item) => !detailedKeys.has(key(item)))
        .map(lightPr)
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
      errors,
    };
  }

  async function notify() {
    if (listeners.size === 0) return;
    try {
      const page = await build();
      listeners.forEach((listener) => listener(page));
    } catch {
      // A failed rebuild leaves streams on their last page; the next change retries.
    }
  }

  async function getPrs({ force = false } = {}) {
    lastTouched = now();
    if (force) await prSync.refreshAll();
    return build();
  }

  /** Interval multiplier for the current audience, or null to pause. */
  function pace() {
    if (listeners.size > 0) return 1;
    return now() - lastTouched < WATCH_GRACE_MS ? BACKGROUND_FACTOR : null;
  }

  function start() {
    timer ??= setInterval(() => {
      const factor = pace();
      if (factor) prSync.tick({ factor }).catch(() => {});
    }, TICK_MS);
    timer.unref?.();
  }

  function stop() {
    clearInterval(timer);
    timer = null;
  }

  /** Stream page updates to `listener`; refreshes anything that went stale while nobody watched. */
  function subscribe(listener) {
    listeners.add(listener);
    prSync.ensureLoaded().then(() => prSync.tick()).catch(() => {});
    return () => listeners.delete(listener);
  }

  /** Request a Copilot review, but only for a PR the page currently lists as yours or awaiting your review. */
  async function copilotReview(body) {
    const ref = parsePrRef(body);
    const page = await getPrs();
    const known = [...page.authored, ...page.reviewRequested]
      .some((pr) => pr.repo === ref.repo && pr.number === ref.number);
    if (!known) throw new ActionError(404, `${ref.repo}#${ref.number} is not on the pull requests page`);
    try {
      await requestCopilotReview(ref, settings.github.copilotReviewer);
    } catch (error) {
      throw new ActionError(502, error.message);
    }
    await prSync.refreshPr(ref);
    return { requested: true, ...ref };
  }

  return { getPrs, subscribe, start, stop, pace, copilotReview };
}
