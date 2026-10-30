import { mapLimit, run } from './exec.js';
import { discoverRepos, getBranchRefs, getRemoteUrl, getStatuses } from './git.js';
import { fetchPrDetails, fetchRepoPrs, parseGithubRemote } from './github.js';
import { DEFAULT_SETTINGS } from './settings.js';

const STATE_TTL_MS = 10_000;
const REPOS_TTL_MS = 60_000;
const PR_TTL_MS = 60_000;
const CHECKS_TTL_MS = 90_000;
const REPO_CONCURRENCY = 4;
const DAY_MS = 24 * 60 * 60 * 1000;
// Defaults; config.json can change each of these (see settings.js).
// An idle session untouched this long is treated as parked, not waiting on you.
export const PARKED_AFTER_MS = DEFAULT_SETTINGS.agents.parkedAfterMs;
// An interrupted session flags its worktree for this long; after that it's history, not a to-do.
export const INTERRUPTED_ATTENTION_MS = DEFAULT_SETTINGS.agents.interruptedAttentionMs;
const ATTENTION_FLAGS = new Set([
  'agent-waiting', 'agent-interrupted', 'checks-failing', 'changes-requested', 'merge-conflict', 'conflicted',
]);

/** The worktree that contains `cwd`, preferring the deepest match. */
export function findWorktreeForPath(worktreePaths, cwd) {
  return worktreePaths
    .filter((path) => cwd === path || cwd.startsWith(`${path}/`))
    .reduce((best, path) => (!best || path.length > best.length ? path : best), null);
}

/**
 * Pick the PR for a branch: open beats merged/closed, then most recently updated.
 * Long-lived branch names are often reused by PRs from forks, so they never match.
 */
export function matchPr(prs, branch, isLongLivedBranch = DEFAULT_SETTINGS.git.isLongLivedBranch) {
  if (!branch || isLongLivedBranch(branch)) return null;
  const rank = (pr) => (pr.state === 'OPEN' ? 1 : 0);
  return prs
    .filter((pr) => pr.headRefName === branch)
    .sort((a, b) => rank(b) - rank(a) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null;
}

export function isParked(session, now = Date.now(), parkedAfterMs = PARKED_AFTER_MS) {
  // An open question is never parked, however old: it's still waiting on you.
  return session.status === 'idle' && !session.needsYou && Boolean(session.statusUpdatedAt) && now - session.statusUpdatedAt > parkedAfterMs;
}

/** Short, UI-facing labels describing what needs doing in a worktree. */
/** A worktree's most recent session died mid-turn, recently, and nothing is running there now. */
export function wasInterrupted(lastSession, liveSessions, now = Date.now(), attentionMs = INTERRUPTED_ATTENTION_MS) {
  return liveSessions.length === 0
    && lastSession?.transcript?.endState === 'interrupted'
    && now - lastSession.updatedAt <= attentionMs;
}

export function deriveFlags(
  { isMain, status, pr, liveSessions, lastSession = null },
  now = Date.now(),
  { parkedAfterMs, interruptedAttentionMs } = DEFAULT_SETTINGS.agents,
) {
  const flags = [];
  const dirty = Boolean(status && (status.changed || status.untracked || status.conflicted));
  if (liveSessions.some((s) => s.status === 'busy')) flags.push('agent-busy');
  if (liveSessions.some((s) => s.status === 'idle' && !isParked(s, now, parkedAfterMs))) flags.push('agent-waiting');
  if (wasInterrupted(lastSession, liveSessions, now, interruptedAttentionMs)) flags.push('agent-interrupted');
  if (status?.conflicted) flags.push('conflicted');
  if (dirty) flags.push('dirty');
  if (status?.behind) flags.push('behind');
  if (pr?.state === 'OPEN') {
    if (pr.checks?.state === 'failing') flags.push('checks-failing');
    if (pr.reviewDecision === 'CHANGES_REQUESTED') flags.push('changes-requested');
    if (pr.reviewDecision === 'APPROVED') flags.push('approved');
    if (pr.mergeStateStatus === 'DIRTY') flags.push('merge-conflict');
  }
  if (!isMain && (pr?.state === 'MERGED' || pr?.state === 'CLOSED') && !dirty && liveSessions.length === 0) {
    flags.push('cleanup');
  }
  return flags;
}

export function needsAttention(flags) {
  return flags.some((flag) => ATTENTION_FLAGS.has(flag));
}

function latestOf(...timestamps) {
  const valid = timestamps.filter((t) => Number.isFinite(t));
  return valid.length ? Math.max(...valid) : null;
}

export function createStateService({ config, claude, cache }) {
  const settings = config.settings ?? DEFAULT_SETTINGS;

  async function fetchMyOpenPrs(force) {
    return cache.get('my-open-prs', PR_TTL_MS, async () => JSON.parse(await run('gh', [
      'search', 'prs', '--author=@me', '--state=open', '--limit', '100',
      '--json', 'number,title,url,isDraft,updatedAt,repository',
    ])), { force });
  }

  async function loadRepoPrs(github, force) {
    try {
      return { prs: await cache.get(`prs:${github}`, PR_TTL_MS, () => fetchRepoPrs(github), { force }), error: null };
    } catch (error) {
      return { prs: [], error: { source: 'github', message: error.message } };
    }
  }

  async function attachChecks(github, pr, force) {
    if (!pr || pr.state !== 'OPEN') return pr;
    const key = `checks:${github}#${pr.number}`;
    const [detail] = await cache.get(key, CHECKS_TTL_MS, () => fetchPrDetails([{ repo: github, number: pr.number }], settings.ci), { force });
    return { ...pr, ...(detail ?? {}) };
  }

  async function buildWorktree({ repo, github, worktree, status, refs, prs, liveSessions, force }) {
    const isMain = worktree.path === repo.mainPath;
    const pr = github ? await attachChecks(github, matchPr(prs, worktree.branch, settings.git.isLongLivedBranch), force) : null;
    const lastSession = await claude.latestSession(worktree.path);
    const recentSessions = await claude.recentSessions(worktree.path, {
      exclude: new Set(liveSessions.map((s) => s.sessionId)),
    });
    const lastCommit = worktree.branch ? refs.get(worktree.branch) ?? null : null;
    const flags = deriveFlags({ isMain, status, pr, liveSessions, lastSession }, Date.now(), settings.agents);
    return {
      ...worktree,
      isMain,
      status,
      lastCommit,
      pr,
      agents: { live: liveSessions, last: lastSession, recent: recentSessions },
      flags,
      needsAttention: needsAttention(flags),
      lastActivityAt: latestOf(
        lastCommit?.committedAt,
        lastSession?.updatedAt,
        pr ? Date.parse(pr.updatedAt) : null,
        ...liveSessions.map((s) => s.statusUpdatedAt),
      ),
    };
  }

  async function buildRepo({ repo, github }, { sessionsByWorktree, prRepos, force }) {
    const errors = [];
    const [statuses, refs] = await Promise.all([
      getStatuses(repo.worktrees),
      getBranchRefs(repo.mainPath).catch(() => new Map()),
    ]);
    const prResult = github && prRepos.has(github) ? await loadRepoPrs(github, force) : { prs: [], error: null };
    if (prResult.error) errors.push(prResult.error);

    const worktrees = await Promise.all(repo.worktrees.map((worktree, i) => buildWorktree({
      repo, github, worktree, refs, force,
      status: statuses[i],
      prs: prResult.prs,
      liveSessions: sessionsByWorktree.get(worktree.path) ?? [],
    })));
    return { repo: { name: repo.name, mainPath: repo.mainPath, github, worktrees }, errors };
  }

  function groupSessions(liveSessions, worktreePaths) {
    const byWorktree = new Map();
    const unmatched = [];
    for (const session of liveSessions) {
      const path = findWorktreeForPath(worktreePaths, session.cwd);
      if (path) byWorktree.set(path, [...(byWorktree.get(path) ?? []), session]);
      else unmatched.push(session);
    }
    return { byWorktree, unmatched };
  }

  /** Attach the repo and branch each ended session ran in, when it was inside a known worktree. */
  function locateEnded(ended, repos) {
    const byPath = new Map(repos.flatMap((repo) => repo.worktrees.map((w) => [w.path, { repo, worktree: w }])));
    return ended.map((session) => {
      const path = findWorktreeForPath([...byPath.keys()], session.cwd);
      const where = path ? byPath.get(path) : null;
      return {
        ...session,
        repoName: where?.repo.name ?? null,
        worktreePath: path,
        branch: where?.worktree.branch ?? session.transcript.gitBranch,
        prUrl: where?.worktree.pr?.url ?? null,
        prNumber: where?.worktree.pr?.number ?? null,
      };
    });
  }

  /** Repos worth querying GitHub for: those with linked worktrees, live agents, or my open PRs. */
  function relevantGithubRepos(reposWithRemote, myOpenPrs, sessionsByWorktree) {
    const active = reposWithRemote
      .filter(({ repo, github }) => github && (
        repo.worktrees.length > 1 || repo.worktrees.some((w) => sessionsByWorktree.has(w.path))
      ))
      .map(({ github }) => github);
    return new Set([...active, ...myOpenPrs.map((pr) => pr.repository.nameWithOwner)]);
  }

  async function build({ force = false } = {}) {
    const errors = [];
    const discovered = await cache.get('repos', REPOS_TTL_MS, () => discoverRepos(config.roots), { force });
    errors.push(...discovered.errors);

    const worktreePaths = discovered.repos.flatMap((r) => r.worktrees.map((w) => w.path));
    const now = Date.now();
    const liveSessions = (await claude.liveSessions()).map((s) => ({ ...s, parked: isParked(s, now, settings.agents.parkedAfterMs) }));
    const { byWorktree, unmatched } = groupSessions(liveSessions, worktreePaths);
    const ended = await claude.endedSessions({
      since: now - settings.agents.endedHistoryMs,
      liveSessionIds: new Set(liveSessions.map((s) => s.sessionId)),
    });

    const myOpenPrs = await fetchMyOpenPrs(force).catch((error) => {
      errors.push({ source: 'github', message: error.message });
      return [];
    });
    const remotes = await mapLimit(discovered.repos, REPO_CONCURRENCY, (repo) => getRemoteUrl(repo.mainPath));
    const reposWithRemote = discovered.repos.map((repo, i) => ({ repo, github: parseGithubRemote(remotes[i]) }));
    const prRepos = relevantGithubRepos(reposWithRemote, myOpenPrs, byWorktree);

    const results = await mapLimit(reposWithRemote, REPO_CONCURRENCY, (repo) => buildRepo(repo, {
      sessionsByWorktree: byWorktree, prRepos, force,
    }));
    results.forEach((r) => errors.push(...r.errors));
    const repos = results.map((r) => r.repo);

    const matchedPrUrls = new Set(repos.flatMap((r) => r.worktrees.map((w) => w.pr?.url).filter(Boolean)));
    return {
      generatedAt: Date.now(),
      roots: config.roots,
      repos,
      liveSessions,
      unmatchedSessions: unmatched,
      endedSessions: locateEnded(ended, repos).map((s) => ({
        ...s,
        needsAttention: s.endState === 'interrupted' && now - s.endedAt <= settings.agents.interruptedAttentionMs,
      })),
      endedHistoryDays: Math.round((settings.agents.endedHistoryMs / DAY_MS) * 10) / 10,
      prsWithoutWorktree: myOpenPrs.filter((pr) => !matchedPrUrls.has(pr.url)),
      errors: [...new Map(errors.map((e) => [e.message, e])).values()],
    };
  }

  return {
    getState: ({ force = false } = {}) => cache.get('state', STATE_TTL_MS, () => build({ force }), { force }),
  };
}
