import { mapLimit, run } from './exec.js';
import { DEFAULT_SETTINGS } from './settings.js';

const GH_CONCURRENCY = 4;
// statusCheckRollup is expensive; requesting it for many PRs at once makes
// GitHub's GraphQL API time out, so branch lookups use light fields and checks
// are fetched per PR.
const DETAIL_FIELDS = 'number,statusCheckRollup,mergeStateStatus';
const FULL_FIELDS = [
  'number', 'title', 'url', 'state', 'isDraft', 'headRefName', 'headRefOid', 'baseRefName', 'author', 'createdAt', 'updatedAt',
  'reviewDecision', 'mergeStateStatus', 'mergeable', 'statusCheckRollup', 'latestReviews', 'reviewRequests',
  'additions', 'deletions', 'changedFiles',
].join(',');
const SEARCH_FIELDS = 'number,title,url,isDraft,updatedAt,repository,author,commentsCount';
const SEARCH_LIMIT = '100';

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

// Fields for finding a branch's PR; checks come from the PR sync or a per-PR fetch (see above).
// headRefOid (the PR's last commit) tells Clean up whether a worktree's commits are all in the PR.
const BRANCH_PR_FIELDS = 'number title state isDraft headRefName headRefOid url updatedAt reviewDecision author { login }';
// A branch rarely has more than one PR; a few covers reopened and superseded ones.
const PRS_PER_BRANCH = 5;
const BRANCHES_PER_QUERY = 100;

/**
 * One GraphQL query for the PRs of many branches across repos. Owners, names
 * and branch names are all passed as variables, never spliced into the query.
 * @param {{ repo: string, branches: string[] }[]} requests
 */
export function buildBranchPrQuery(requests) {
  const params = [];
  const variables = {};
  const blocks = requests.map(({ repo, branches }, r) => {
    const [owner, name] = repo.split('/');
    variables[`o${r}`] = owner;
    variables[`n${r}`] = name;
    params.push(`$o${r}: String!`, `$n${r}: String!`);
    const lookups = branches.map((branch, b) => {
      variables[`b${r}_${b}`] = branch;
      params.push(`$b${r}_${b}: String!`);
      return `b${b}: pullRequests(headRefName: $b${r}_${b}, first: ${PRS_PER_BRANCH}, `
        + 'orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { ...branchPr } }';
    });
    return `r${r}: repository(owner: $o${r}, name: $n${r}) { ${lookups.join(' ')} }`;
  });
  const query = `query(${params.join(', ')}) { ${blocks.join(' ')} } fragment branchPr on PullRequest { ${BRANCH_PR_FIELDS} }`;
  return { query, variables };
}

/** Group requests so no single query asks about more than BRANCHES_PER_QUERY branches. */
function chunkRequests(requests) {
  return requests.reduce((chunks, request) => {
    const last = chunks.at(-1);
    const size = last?.reduce((n, r) => n + r.branches.length, 0) ?? Infinity;
    return size + request.branches.length > BRANCHES_PER_QUERY
      ? [...chunks, [request]]
      : [...chunks.slice(0, -1), [...last, request]];
  }, []);
}

async function queryBranchPrs(requests, runGh) {
  const { query, variables } = buildBranchPrQuery(requests);
  const args = ['api', 'graphql', '-f', `query=${query}`, ...Object.entries(variables).flatMap(([key, value]) => ['-f', `${key}=${value}`])];
  const { data } = JSON.parse(await runGh(args));
  return Object.fromEntries(requests.map(({ repo, branches }, r) => [
    repo,
    branches.flatMap((_, b) => data?.[`r${r}`]?.[`b${b}`]?.nodes ?? []),
  ]));
}

/**
 * The PRs for each repo's checked-out branches, in as few requests as possible.
 * If a batch fails, its repos are retried one at a time, so a repo that can't
 * be read (renamed, no access) only loses its own PRs.
 * @returns {Promise<{ byRepo: Record<string, object[]>, errors: { source: string, message: string }[] }>}
 */
export async function fetchBranchPrs(requests, { runGh = (args) => run('gh', args) } = {}) {
  const results = await mapLimit(chunkRequests(requests), GH_CONCURRENCY, async (chunk) => {
    try {
      return { byRepo: await queryBranchPrs(chunk, runGh), errors: [] };
    } catch (error) {
      if (chunk.length === 1) return { byRepo: {}, errors: [{ source: 'github', message: `${chunk[0].repo}: ${error.message}` }] };
      const alone = await mapLimit(chunk, GH_CONCURRENCY, (request) => fetchBranchPrs([request], { runGh }));
      return { byRepo: Object.assign({}, ...alone.map((a) => a.byRepo)), errors: alone.flatMap((a) => a.errors) };
    }
  });
  return { byRepo: Object.assign({}, ...results.map((r) => r.byRepo)), errors: results.flatMap((r) => r.errors) };
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
