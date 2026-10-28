import { mapLimit } from './exec.js';
import { fetchPrFull, isCopilotLogin, requestCopilotReview, searchOpenPrs } from './github.js';

const SEARCH_TTL_MS = 60_000;
const PR_TTL_MS = 60_000;
const PR_CONCURRENCY = 4;
const PAGE_KEY = 'prs-page';
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export class ActionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

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
export function copilotStatus(pr) {
  const review = (pr.reviews ?? []).find((r) => isCopilotLogin(r.login));
  return {
    requested: (pr.requested ?? []).some((r) => !r.isTeam && isCopilotLogin(r.name)),
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

export function createPrService({ cache, getLocalIndex }) {
  async function loadFull(item, force) {
    const ref = { repo: item.repository.nameWithOwner, number: item.number };
    try {
      return await cache.get(`pr:${ref.repo}#${ref.number}`, PR_TTL_MS, () => fetchPrFull(ref), { force });
    } catch (error) {
      return { ...lightPr(item), error: error.message };
    }
  }

  async function build({ force = false } = {}) {
    const errors = [];
    const search = (key, args) => cache.get(key, SEARCH_TTL_MS, () => searchOpenPrs(args), { force })
      .catch((error) => {
        errors.push({ source: 'github', message: error.message });
        return [];
      });

    const [authored, direct, anyRequest] = await Promise.all([
      search('search:authored', ['--author=@me']),
      search('search:review-direct', ['user-review-requested:@me']),
      search('search:review-any', ['--review-requested=@me']),
    ]);
    const detailed = new Set([...authored, ...direct].map((pr) => pr.url));

    const [full, local] = await Promise.all([
      mapLimit([...authored, ...direct], PR_CONCURRENCY, (item) => loadFull(item, force)),
      getLocalIndex().catch((error) => {
        errors.push({ source: 'local', message: error.message });
        return new Map();
      }),
    ]);
    const enrich = (pr) => ({
      ...pr,
      stage: prStage(pr),
      copilot: pr.error ? null : copilotStatus(pr),
      local: local.get(`${pr.repo}#${pr.headRefName}`) ?? null,
    });
    const authoredUrls = new Set(authored.map((pr) => pr.url));

    return {
      generatedAt: Date.now(),
      authored: sortByStage(full.filter((pr) => authoredUrls.has(pr.url)).map(enrich)),
      reviewRequested: sortByStage(full.filter((pr) => !authoredUrls.has(pr.url)).map(enrich)),
      teamReviewRequested: anyRequest
        .filter((pr) => !detailed.has(pr.url))
        .map(lightPr)
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
      errors,
    };
  }

  const getPrs = ({ force = false } = {}) => cache.get(PAGE_KEY, 10_000, () => build({ force }), { force });

  /** Request a Copilot review, but only for a PR the page currently lists as yours or awaiting your review. */
  async function copilotReview(body) {
    const ref = parsePrRef(body);
    const page = await getPrs();
    const known = [...page.authored, ...page.reviewRequested]
      .some((pr) => pr.repo === ref.repo && pr.number === ref.number);
    if (!known) throw new ActionError(404, `${ref.repo}#${ref.number} is not on the pull requests page`);
    try {
      await requestCopilotReview(ref);
    } catch (error) {
      throw new ActionError(502, error.message);
    }
    cache.invalidate(`pr:${ref.repo}#${ref.number}`);
    cache.invalidate(PAGE_KEY);
    return { requested: true, ...ref };
  }

  return { getPrs, copilotReview };
}
