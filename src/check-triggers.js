import { run } from './exec.js';
import { taskWorktrees } from './task-links.js';

/*
 * When checks run by themselves (Settings › Checks, run: after-turn or
 * on-commit; see checks.js). Nothing here polls. It hears two things that
 * switchyard already watches for:
 * - the agent feed's update after Claude's session registry changes (a
 *   session going from busy to not busy has finished a turn);
 * - the status tracker's word that a repo's refs or HEAD changed, where a
 *   worktree whose HEAD moved has a new commit.
 * Only worktrees of open tasks are watched, in repos with a check that runs
 * by itself. The first look at a worktree only learns its state.
 */

const runGit = (args) => run('git', args);
const headOfWorktree = async (path) => (await runGit(['-C', path, 'rev-parse', 'HEAD'])).trim();
const isBusy = (worktree) => (worktree.agents?.live ?? []).some((s) => s.status === 'busy');

/**
 * @param {{ checks: { watchedRepos: () => string[], autoRun: (args: { path: string, trigger: string }) => Promise<string[]> },
 *   listTasks: () => Promise<object[]>, headOf?: (path: string) => Promise<string> }} deps
 */
export function createCheckTriggers({ checks, listTasks, headOf = headOfWorktree }) {
  const busyAt = new Map(); // worktree path -> busy at the last look
  const heads = new Map(); // worktree path -> HEAD at the last look
  let repos = []; // the last sessions view, for the commits to look in
  let queue = Promise.resolve();

  /** One event at a time, in order; a failure is logged and the next goes on. */
  const inTurn = (handle) => {
    queue = queue.then(handle).catch((error) => {
      process.stderr.write(`[switchyard] running checks by themselves: ${error.message}\n`);
    });
    return queue;
  };

  /** The worktrees to watch: open tasks', in repos with a check that runs by itself. */
  async function watched() {
    const names = new Set(checks.watchedRepos());
    if (names.size === 0) return [];
    const open = (await listTasks()).filter((task) => !task.closedAs);
    const mine = repos.filter((repo) => names.has(repo.name));
    const found = new Map();
    for (const task of open) for (const { repo, worktree } of taskWorktrees(task, mine)) found.set(worktree.path, { repo, worktree });
    return [...found.values()];
  }

  /** Learn a worktree's HEAD the first time it's watched, so its next commit is noticed. */
  async function learnHead(path) {
    if (!heads.has(path)) heads.set(path, await headOf(path).catch(() => null));
  }

  /** The agent feed's latest sessions view: a watched worktree that was busy and isn't has finished a turn. */
  const seen = (data) => inTurn(async () => {
    repos = data.repos ?? [];
    for (const { worktree } of await watched()) {
      const busy = isBusy(worktree);
      const was = busyAt.get(worktree.path);
      busyAt.set(worktree.path, busy);
      await learnHead(worktree.path);
      if (was === true && !busy) await checks.autoRun({ path: worktree.path, trigger: 'after-turn' });
    }
  });

  /** A repo's refs or HEAD changed: a watched worktree of it whose HEAD moved has a new commit. */
  const refsChanged = (mainPath) => inTurn(async () => {
    for (const { repo, worktree } of await watched()) {
      if (repo.mainPath !== mainPath) continue;
      const known = heads.has(worktree.path);
      const was = heads.get(worktree.path);
      const now = await headOf(worktree.path).catch(() => null);
      heads.set(worktree.path, now);
      if (known && now && now !== was) await checks.autoRun({ path: worktree.path, trigger: 'on-commit' });
    }
  });

  return { seen, refsChanged };
}
