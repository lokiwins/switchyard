import { ActionError } from './errors.js';
import { run } from './exec.js';

/*
 * A task started as attempts (see hub-start.js): each one side by side, to
 * choose between, and picking one. Picking keeps that attempt's worktree as
 * the task's work and puts the others away as closing a task does (see
 * task-cleanup.js): their sessions end, clean worktrees go, and one with
 * changes or commits waits for you to Keep or Delete it. Branches stay.
 */

const runGit = (args) => run('git', args);
// A card lists this many changed files; the rest are counted.
export const MAX_FILES = 50;

/** What its session is doing: needs you, working, idle (its turn is over), or not running. */
function sessionState(worktree) {
  const live = worktree.agents?.live ?? [];
  if (live.some((s) => s.needsYou)) return 'needs-you';
  if (live.some((s) => s.status === 'busy')) return 'working';
  return live.length > 0 ? 'idle' : 'not-running';
}

/** `git diff --numstat` lines: binary files have no line counts. */
function parseNumstat(text) {
  return text.split('\n').filter(Boolean).map((line) => {
    const [added, removed, ...rest] = line.split('\t');
    const count = (n) => (n === '-' ? null : Number(n));
    return { path: rest.join('\t'), added: count(added), removed: count(removed) };
  });
}

const untrackedIn = (status) => status.split('\n').filter((line) => line.startsWith('?? ')).map((line) => ({
  path: line.slice(3), added: null, removed: null, untracked: true,
}));

/**
 * @param {{ taskHub: { list, recordAttempts }, getState: () => Promise<{ repos: object[] }>,
 *   putAwayWorktrees: (task: object, options: { branches: string[] }) => Promise<object>, git?: Function, now?: () => number }} deps
 */
export function createAttemptCompare({
  taskHub, getState, putAwayWorktrees, git = runGit, now = Date.now,
}) {
  const gitIn = (dir, args) => git(['-C', dir, ...args]);

  async function taskWithAttempts(id) {
    const task = (await taskHub.list()).find((t) => t.id === id);
    if (!task) throw new ActionError(404, 'That task is not there any more');
    if (!task.attempts) throw new ActionError(404, 'That task was not started as attempts');
    return task;
  }

  /** What an attempt changed since it left the main branch (uncommitted edits too), and how many commits it made; nulls if git can't say. */
  async function changesOf(dir, mainBranch) {
    if (!mainBranch) return { changes: null, commits: null };
    try {
      const base = (await gitIn(dir, ['merge-base', 'HEAD', mainBranch])).trim();
      const [numstat, status, commits] = await Promise.all([
        gitIn(dir, ['diff', '--numstat', base]),
        gitIn(dir, ['status', '--porcelain', '--untracked-files=all']),
        gitIn(dir, ['rev-list', '--count', `${base}..HEAD`]),
      ]);
      const tracked = parseNumstat(numstat);
      const sum = (key) => tracked.reduce((total, file) => total + (file[key] ?? 0), 0);
      return {
        changes: { files: [...tracked, ...untrackedIn(status)].slice(0, MAX_FILES), added: sum('added'), removed: sum('removed') },
        commits: Number(commits.trim()) || 0,
      };
    } catch {
      return { changes: null, commits: null };
    }
  }

  async function describe(branch, n, repo, startedAt) {
    const worktree = repo?.worktrees.find((w) => w.branch === branch && !w.isMain);
    if (!worktree) return { n, branch, path: null, present: false };
    const mainBranch = repo.worktrees.find((w) => w.isMain)?.branch ?? null;
    const session = worktree.agents?.live?.[0] ?? worktree.agents?.last ?? null;
    return {
      n,
      branch,
      path: worktree.path,
      present: true,
      state: sessionState(worktree),
      pr: worktree.pr ? { number: worktree.pr.number, url: worktree.pr.url, state: worktree.pr.state } : null,
      // A new worktree's last commit is its base's, from before the attempt began: count from when they started at the earliest.
      lastActivityAt: Math.max(worktree.lastActivityAt ?? 0, startedAt ?? 0) || null,
      contextTokens: session?.transcript?.contextTokens ?? null,
      ...await changesOf(worktree.path, mainBranch),
    };
  }

  /** The task's attempts, each with what it did; which one was picked, if any. */
  async function compare(body) {
    const task = await taskWithAttempts(body?.id);
    const group = task.attempts;
    const repo = (await getState()).repos.find((r) => r.mainPath === group.repo);
    const attempts = await Promise.all(group.branches.map((branch, i) => describe(branch, i + 1, repo, group.startedAt)));
    return { taskId: task.id, picked: group.picked ?? null, startedAt: group.startedAt, attempts };
  }

  /** Keep the attempt on `branch`; put the others away. */
  async function pick(body) {
    const task = await taskWithAttempts(body?.id);
    const group = task.attempts;
    if (typeof body.branch !== 'string' || !group.branches.includes(body.branch)) throw new ActionError(400, 'Pick one of the task\'s attempts');
    if (group.picked) throw new ActionError(409, `An attempt was already picked: ${group.picked}`);
    const repo = (await getState()).repos.find((r) => r.mainPath === group.repo);
    if (!repo?.worktrees.some((w) => w.branch === body.branch && !w.isMain)) throw new ActionError(409, 'That attempt\'s worktree is gone');
    const others = group.branches.filter((branch) => branch !== body.branch);
    const cleanup = await putAwayWorktrees(task, { branches: others });
    await taskHub.recordAttempts(task.id, { ...group, picked: body.branch, pickedAt: now() });
    return { picked: body.branch, cleanup };
  }

  return { compare, pick };
}
