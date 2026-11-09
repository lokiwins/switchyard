import { mapLimit, run } from './exec.js';
import { discoverRepos, getBranchRefs, getRemoteUrl } from './git.js';
import { fetchBranchPrs, fetchPrDetails, parseGithubRemote } from './github.js';
import { DEFAULT_SETTINGS } from './settings.js';
import { createStatusTracker } from './status-tracker.js';

// git status only runs where files changed (see status-tracker.js) and GitHub data refreshes
// in the background on its own TTLs, so a full rebuild is cheap enough to do every few seconds.
const STATE_TTL_MS = 3_000;
// Sessions alone are cheap (local files, no git status, no GitHub), so they can be much fresher.
const SESSIONS_TTL_MS = 2_000;
const LOCAL_TTL_MS = 3_000;
// The sessions view shows PR links from the last full scan; rescan in the background when it gets this old.
const FULL_SCAN_STALE_MS = 5 * 60_000;
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

/**
 * @param {object} deps
 * @param {() => object|null} [deps.prSnapshot] The PR page's live sync (see pr-sync.js), whose
 *   details for your open PRs are reused here instead of being fetched a second time.
 */
export function createStateService({
  config, claude, cache,
  statusTracker = createStatusTracker(),
  github = { fetchBranchPrs, fetchPrDetails },
  prSnapshot = () => null,
}) {
  const settings = config.settings ?? DEFAULT_SETTINGS;

  /**
   * A cached GitHub read. With `github` off (the local view) it never calls
   * GitHub and uses whatever the last full scan cached, or `fallback`.
   */
  function fromGithub(key, ttlMs, load, { force, github, fallback }) {
    if (!github) return Promise.resolve(cache.peek(key) ?? fallback);
    return cache.get(key, ttlMs, load, { force });
  }

  /** Your open PRs: from the PR sync once it has loaded, otherwise one search. */
  async function fetchMyOpenPrs(scan, sync) {
    if (sync?.loaded) return sync.authored;
    return fromGithub('my-open-prs', PR_TTL_MS, async () => JSON.parse(await run('gh', [
      'search', 'prs', '--author=@me', '--state=open', '--limit', '100',
      '--json', 'number,title,url,isDraft,updatedAt,repository',
    ])), { ...scan, fallback: [] });
  }

  /**
   * The PRs for every checked-out branch, in one batched query. A new branch
   * set (a worktree added or switched) refetches right away instead of waiting out the TTL.
   */
  async function loadBranchPrs(requests, scan) {
    const signature = JSON.stringify(requests);
    const empty = { signature, byRepo: {}, errors: [] };
    if (requests.length === 0) return empty;
    const cached = cache.peek('branch-prs');
    const force = scan.force || (scan.github && cached !== undefined && cached.signature !== signature);
    try {
      return await fromGithub('branch-prs', PR_TTL_MS, async () => ({ signature, ...await github.fetchBranchPrs(requests) }),
        { ...scan, force, fallback: empty });
    } catch (error) {
      return { ...empty, errors: [{ source: 'github', message: error.message }] };
    }
  }

  async function attachChecks(repo, pr, scan, sync) {
    if (!pr || pr.state !== 'OPEN') return pr;
    // The PR sync keeps your open PRs' checks fresh already; only other people's need a fetch.
    const synced = sync?.entries.get(`${repo}#${pr.number}`)?.pr;
    if (synced) {
      const { checks, mergeStateStatus, reviewDecision, isDraft } = synced;
      return { ...pr, checks, mergeStateStatus, reviewDecision, isDraft };
    }
    const load = () => github.fetchPrDetails([{ repo, number: pr.number }], settings.ci);
    const [detail] = await fromGithub(`checks:${repo}#${pr.number}`, CHECKS_TTL_MS, load, { ...scan, fallback: [] });
    return { ...pr, ...(detail ?? {}) };
  }

  async function buildWorktree({ repo, remote, worktree, status, refs, prs, liveSessions, scan, sync }) {
    const isMain = worktree.path === repo.mainPath;
    const pr = remote ? await attachChecks(remote, matchPr(prs, worktree.branch, settings.git.isLongLivedBranch), scan, sync) : null;
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

  async function buildRepo({ repo, github: remote }, { sessionsByWorktree, branchPrs, scan, sync }) {
    const [statuses, refs] = await Promise.all([
      // git status is the slow part of a local scan; the sessions view leaves it out.
      scan.git ? statusTracker.statuses(repo.worktrees) : repo.worktrees.map(() => null),
      getBranchRefs(repo.mainPath).catch(() => new Map()),
    ]);
    const worktrees = await Promise.all(repo.worktrees.map((worktree, i) => buildWorktree({
      repo, remote, worktree, refs, scan, sync,
      status: statuses[i],
      prs: (remote && branchPrs.byRepo[remote]) ?? [],
      liveSessions: sessionsByWorktree.get(worktree.path) ?? [],
    })));
    return { name: repo.name, mainPath: repo.mainPath, github: remote, worktrees };
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

  /** One request per relevant repo: its checked-out branches that could have a PR. */
  function branchRequests(reposWithRemote, prRepos) {
    return reposWithRemote
      .filter(({ github: remote }) => remote && prRepos.has(remote))
      .map(({ repo, github: remote }) => ({
        repo: remote,
        branches: [...new Set(repo.worktrees.map((w) => w.branch)
          .filter((branch) => branch && !settings.git.isLongLivedBranch(branch)))],
      }))
      .filter((request) => request.branches.length > 0);
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

  /** The repos under the roots, with each one's origin URL; both change rarely, so they're cached together. */
  async function discoverWithRemotes() {
    const discovered = await discoverRepos(config.roots);
    const remotes = await mapLimit(discovered.repos, REPO_CONCURRENCY, (repo) => getRemoteUrl(repo.mainPath));
    return { ...discovered, remotes };
  }

  /**
   * The whole board. `github: false` uses only PR data a full scan already
   * cached; `git: false` also skips git status, leaving just sessions.
   */
  async function build({ force = false, github = true, git = true } = {}) {
    const scan = { force, github, git };
    const errors = [];
    const discovered = await cache.get('repos', REPOS_TTL_MS, () => discoverWithRemotes(), { force });
    errors.push(...discovered.errors);
    // Watching is what lets a scan skip git status in worktrees where nothing changed.
    if (git) await statusTracker.track(discovered.repos);

    const worktreePaths = discovered.repos.flatMap((r) => r.worktrees.map((w) => w.path));
    const now = Date.now();
    const liveSessions = (await claude.liveSessions()).map((s) => ({ ...s, parked: isParked(s, now, settings.agents.parkedAfterMs) }));
    const { byWorktree, unmatched } = groupSessions(liveSessions, worktreePaths);
    const ended = await claude.endedSessions({
      since: now - settings.agents.endedHistoryMs,
      liveSessionIds: new Set(liveSessions.map((s) => s.sessionId)),
    });

    const sync = prSnapshot();
    const myOpenPrs = await fetchMyOpenPrs(scan, sync).catch((error) => {
      errors.push({ source: 'github', message: error.message });
      return [];
    });
    const reposWithRemote = discovered.repos.map((repo, i) => ({ repo, github: parseGithubRemote(discovered.remotes[i]) }));
    const prRepos = relevantGithubRepos(reposWithRemote, myOpenPrs, byWorktree);

    const branchPrs = await loadBranchPrs(branchRequests(reposWithRemote, prRepos), scan);
    errors.push(...branchPrs.errors);

    const repos = await mapLimit(reposWithRemote, REPO_CONCURRENCY, (repo) => buildRepo(repo, {
      sessionsByWorktree: byWorktree, branchPrs, scan, sync,
    }));

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

  const getState = ({ force = false } = {}) => cache.get('state', STATE_TTL_MS, () => build({ force }), { force });

  /** Keep the cached PR links the sessions view borrows from going stale, without a full scan on every poll. */
  function refreshFullScanIfOld() {
    // The server's startup scan provides the first one; this only keeps it from going stale.
    const lastFull = cache.peek('state')?.generatedAt;
    if (lastFull && Date.now() - lastFull > FULL_SCAN_STALE_MS) getState().catch(() => {});
  }

  return {
    /** Everything, GitHub included: the Worktrees page. */
    getState,
    /** git and sessions, no GitHub calls: what the PR page needs to know about local checkouts. */
    getLocal: ({ force = false } = {}) => cache.get('local', LOCAL_TTL_MS, () => build({ force, github: false }), { force }),
    /** Sessions and where they run, without git status or GitHub calls: the Agents page, badges and actions. */
    getSessions: ({ force = false } = {}) => {
      refreshFullScanIfOld();
      return cache.get('sessions', SESSIONS_TTL_MS, () => build({ force, github: false, git: false }), { force });
    },
    /** The sessions view rebuilt now, for a session that just changed; the repo list stays cached. */
    refreshSessions: () => cache.reload('sessions', () => build({ github: false, git: false })),
  };
}
