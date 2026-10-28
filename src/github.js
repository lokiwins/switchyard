import { mapLimit, run } from './exec.js';
import { DEFAULT_SETTINGS } from './settings.js';

const GH_CONCURRENCY = 4;
// statusCheckRollup is expensive; requesting it for many PRs at once makes
// GitHub's GraphQL API time out, so lists use light fields and checks are
// fetched per PR.
const LIST_FIELDS = 'number,title,state,isDraft,headRefName,url,updatedAt,reviewDecision,author';
const DETAIL_FIELDS = 'number,statusCheckRollup,mergeStateStatus';
const FULL_FIELDS = [
  'number', 'title', 'url', 'state', 'isDraft', 'headRefName', 'baseRefName', 'author', 'createdAt', 'updatedAt',
  'reviewDecision', 'mergeStateStatus', 'mergeable', 'statusCheckRollup', 'latestReviews', 'reviewRequests',
  'additions', 'deletions', 'changedFiles',
].join(',');
const SEARCH_FIELDS = 'number,title,url,isDraft,updatedAt,repository,author,commentsCount';
const SEARCH_LIMIT = '100';
const OPEN_PR_LIMIT = '100';
const OWN_PR_LIMIT = '40';

const FAILING_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
const FAILING_STATES = new Set(['FAILURE', 'ERROR']);
const PENDING_STATES = new Set(['PENDING', 'EXPECTED']);

/** Return "owner/repo" for a GitHub remote URL, or null for other hosts. */
export function parseGithubRemote(url) {
  if (!url) return null;
  const match = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return match ? `${match[1]}/${match[2]}` : null;
}

function classifyCheck(check) {
  if (check.__typename === 'StatusContext') {
    if (FAILING_STATES.has(check.state)) return 'failing';
    if (PENDING_STATES.has(check.state)) return 'pending';
    return 'passing';
  }
  if (check.status && check.status !== 'COMPLETED') return 'pending';
  return FAILING_CONCLUSIONS.has(check.conclusion) ? 'failing' : 'passing';
}

const checkName = (check) => (check.__typename === 'StatusContext'
  ? check.context
  : [check.workflowName, check.name].filter(Boolean).join(' / '));

const checkTime = (check) => Date.parse(check.startedAt ?? check.completedAt ?? '') || 0;

/** Re-runs leave older results in the rollup; keep only the latest run of each check. */
export function latestChecks(rollup = []) {
  const byName = rollup.reduce((acc, check) => {
    const name = checkName(check);
    const existing = acc.get(name);
    return !existing || checkTime(check) >= checkTime(existing) ? new Map(acc).set(name, check) : acc;
  }, new Map());
  return [...byName.values()];
}

const leafName = (name) => name.slice(name.lastIndexOf('/') + 1).trim();
const workflowOf = (name) => (name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : null);

/**
 * Manual approval jobs stay "pending" until a human approves them, as does every
 * job queued behind them in the same workflow; reclassify all of those as "held".
 */
function markHeld(checks, holdPatterns) {
  const isHold = (name) => holdPatterns.some((re) => re.test(leafName(name)));
  const heldWorkflows = new Set(checks
    .filter((c) => c.kind === 'pending' && isHold(c.name))
    .map((c) => workflowOf(c.name) ?? c.name));
  return checks.map((c) => (c.kind === 'pending' && heldWorkflows.has(workflowOf(c.name) ?? c.name)
    ? { ...c, kind: 'held' }
    : c));
}

const stripPrefix = (name, prefixes) => {
  const prefix = prefixes.find((p) => name.startsWith(p));
  return prefix ? name.slice(prefix.length) : name;
};

/**
 * Collapse a statusCheckRollup into an overall state, counts, and the failing
 * checks. Each check keeps its full `name` and a shorter display `label`.
 */
export function summarizeChecks(rollup = [], { holdPatterns, stripPrefixes } = DEFAULT_SETTINGS.ci) {
  const checks = markHeld(latestChecks(rollup ?? []).map((check) => ({
    name: checkName(check),
    url: check.detailsUrl ?? check.targetUrl ?? null,
    kind: classifyCheck(check),
  })), holdPatterns).map((c) => ({ ...c, label: stripPrefix(c.name, stripPrefixes) }));
  const count = (kind) => checks.filter((c) => c.kind === kind).length;
  const counts = { passing: count('passing'), failing: count('failing'), pending: count('pending'), heldCount: count('held') };
  const state = counts.failing > 0 ? 'failing'
    : counts.pending > 0 ? 'pending'
      : counts.passing > 0 ? 'passing'
        : 'none';
  const pick = (kind) => checks.filter((c) => c.kind === kind).map(({ name, label, url }) => ({ name, label, url }));
  return { state, ...counts, total: checks.length, failed: pick('failing'), running: pick('pending'), held: pick('held') };
}

const REVIEW_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED']);

/** One entry per reviewer (latest review wins) plus outstanding requests. */
export function summarizeReviews(latestReviews = [], reviewRequests = []) {
  const reviews = (latestReviews ?? [])
    .filter((r) => r.author?.login && REVIEW_STATES.has(r.state))
    .map((r) => ({ login: r.author.login, state: r.state, submittedAt: r.submittedAt ?? null }));
  const requested = (reviewRequests ?? []).map((r) => (r.__typename === 'Team'
    ? { name: r.slug ?? r.name, isTeam: true }
    : { name: r.login ?? r.name, isTeam: false })).filter((r) => r.name);
  return { reviews, requested };
}

function prList(repo, extraArgs) {
  return run('gh', ['pr', 'list', '--repo', repo, '--json', LIST_FIELDS, ...extraArgs]).then(JSON.parse);
}

/** Open PRs from anyone plus the viewer's recent PRs in any state, deduped by number. */
export async function fetchRepoPrs(repo) {
  const [open, own] = await Promise.all([
    prList(repo, ['--state', 'open', '--limit', OPEN_PR_LIMIT]),
    prList(repo, ['--author', '@me', '--state', 'all', '--limit', OWN_PR_LIMIT]),
  ]);
  const byNumber = new Map([...own, ...open].map((pr) => [pr.number, pr]));
  return [...byNumber.values()];
}

/** The login of the authenticated gh user. */
export async function fetchViewerLogin() {
  return (await run('gh', ['api', 'user', '--jq', '.login'])).trim();
}

async function fetchPrDetail({ repo, number }, ciSettings) {
  const detail = JSON.parse(await run('gh', ['pr', 'view', String(number), '--repo', repo, '--json', DETAIL_FIELDS]));
  return { checks: summarizeChecks(detail.statusCheckRollup, ciSettings), mergeStateStatus: detail.mergeStateStatus };
}

/** Fetch check status for each { repo, number }, in order. Failures resolve to null. */
export function fetchPrDetails(refs, ciSettings = DEFAULT_SETTINGS.ci) {
  return mapLimit(refs, GH_CONCURRENCY, (ref) => fetchPrDetail(ref, ciSettings).catch(() => null));
}

/** Run `gh search prs` with extra qualifiers or flags; always open PRs. */
export async function searchOpenPrs(args) {
  return JSON.parse(await run('gh', [
    'search', 'prs', ...args, '--state=open', '--limit', SEARCH_LIMIT, '--json', SEARCH_FIELDS,
  ]));
}

/** Everything the PR page shows for one PR, with checks and reviews summarized. */
export async function fetchPrFull({ repo, number }, ciSettings = DEFAULT_SETTINGS.ci) {
  const pr = JSON.parse(await run('gh', ['pr', 'view', String(number), '--repo', repo, '--json', FULL_FIELDS]));
  const { statusCheckRollup, latestReviews, reviewRequests, ...rest } = pr;
  return {
    ...rest,
    repo,
    checks: summarizeChecks(statusCheckRollup, ciSettings),
    ...summarizeReviews(latestReviews, reviewRequests),
  };
}

const withoutBotSuffix = (login) => login.replace(/\[bot\]$/i, '').toLowerCase();

/** Reviews from a bot appear under its login without the "[bot]" suffix, so compare without it. */
export function isCopilotLogin(login, reviewer = DEFAULT_SETTINGS.github.copilotReviewer) {
  return Boolean(login) && withoutBotSuffix(login) === withoutBotSuffix(reviewer);
}

/** Ask Copilot to (re-)review a pull request. */
export async function requestCopilotReview({ repo, number }, reviewer = DEFAULT_SETTINGS.github.copilotReviewer) {
  await run('gh', [
    'api', '--method', 'POST', `repos/${repo}/pulls/${number}/requested_reviewers`,
    '-f', `reviewers[]=${reviewer}`,
  ]);
}
