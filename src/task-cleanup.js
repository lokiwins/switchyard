import { ActionError } from './errors.js';
import { run } from './exec.js';
import { attachedSessionIds, taskWorktrees } from './task-links.js';

/*
 * When a task is marked done or dropped, or deleted, its work is put away:
 * Claude sessions still running in it are ended (as End ▾ does), its ended
 * sessions come off the lists (transcripts kept, as Remove from list does),
 * and its worktrees are removed. A worktree with uncommitted changes or
 * commits that aren't merged is never removed here: it waits for you to
 * choose Keep or Delete. Main checkouts are never removed; a session saved on
 * the task there is ended and listed off, and that's all.
 */

const runGit = (args) => run('git', args);
const isInside = (dir, path) => path === dir || path?.startsWith(`${dir}/`);

export function createTaskCleanup({
  getState, getSessions, endSession, forgetSessions, git = runGit, now = Date.now,
}) {
  const gitIn = (dir, args) => git(['-C', dir, ...args]);
  // Worktrees waiting for Keep or Delete, by path, until you choose. A restart forgets them, keeping the worktrees.
  const choices = new Map();

  async function isAncestor(dir, commit, of) {
    try {
      await gitIn(dir, ['merge-base', '--is-ancestor', commit, of]);
      return true;
    } catch {
      return false;
    }
  }

  /** The refs that count as merged into: the main checkout's branch, and origin's copy of it when there is one. */
  async function mergedInto(dir, mainBranch) {
    if (!mainBranch) return [];
    const remote = `refs/remotes/origin/${mainBranch}`;
    const hasRemote = await gitIn(dir, ['rev-parse', '--verify', '--quiet', remote]).then(() => true, () => false);
    return hasRemote ? [mainBranch, remote] : [mainBranch];
  }

  /**
   * Commits on the worktree that aren't merged: none when its PR is merged with
   * them in it (a squash merge leaves the branch "unmerged" to git), otherwise
   * those the main branch doesn't have. Unknown counts as one, so it's asked about.
   */
  async function unmergedCommits(worktree, mainBranch) {
    const dir = worktree.path;
    const head = (await gitIn(dir, ['rev-parse', 'HEAD'])).trim();
    const prHead = worktree.pr?.state === 'MERGED' ? worktree.pr.headRefOid : null;
    if (prHead && (head === prHead || await isAncestor(dir, head, prHead))) return 0;
    const bases = await mergedInto(dir, mainBranch);
    if (bases.length === 0) return 1;
    return Number((await gitIn(dir, ['rev-list', '--count', 'HEAD', '--not', ...bases])).trim()) || 0;
  }

  async function changedFiles(dir) {
    return (await gitIn(dir, ['status', '--porcelain', '--untracked-files=all'])).split('\n').filter(Boolean).length;
  }

  /** End the worktree's running sessions; resolves to the ones ended, and why any weren't. */
  async function endAll(sessions) {
    const ended = [];
    const errors = [];
    for (const session of sessions) {
      try {
        await endSession({ sessionId: session.sessionId });
        ended.push(session.sessionId);
      } catch (error) {
        errors.push(`Could not end a session: ${error.message}`);
      }
    }
    return { ended, errors };
  }

  /** Remove a clean worktree, or note it for you to choose about. */
  async function putAway(task, repo, worktree) {
    const mainBranch = repo.worktrees.find((w) => w.isMain)?.branch ?? null;
    const [changes, unmerged] = await Promise.all([changedFiles(worktree.path), unmergedCommits(worktree, mainBranch)]);
    if (changes > 0 || unmerged > 0) {
      const choice = {
        path: worktree.path, repoName: repo.name, branch: worktree.branch ?? null, taskId: task.id, taskTitle: task.title, changes, unmerged,
      };
      choices.set(worktree.path, { ...choice, mainPath: repo.mainPath });
      return { choice };
    }
    // No --force: git refuses too if anything turned up since.
    await gitIn(repo.mainPath, ['worktree', 'remove', worktree.path]);
    // A merged PR's branch goes, as Clean up does it; any other branch stays.
    if (worktree.pr?.state === 'MERGED' && worktree.branch) await gitIn(repo.mainPath, ['branch', '-D', worktree.branch]).catch(() => {});
    return { removed: worktree.path };
  }

  /**
   * Put away a task's work, after it's closed or deleted (`task` as it was).
   * Resolves to what happened: sessions ended, how many came off the lists,
   * worktrees removed, the ones waiting for you, and anything that failed.
   */
  async function afterClose(task) {
    const state = await getState();
    const result = { ended: [], hidden: 0, removed: [], choices: [], errors: [] };
    const attached = new Set(attachedSessionIds(task));
    const worktrees = taskWorktrees(task, state.repos);
    const paths = new Set(worktrees.map(({ worktree }) => worktree.path));

    // Sessions saved on the task, wherever they run (main, say): end them; their checkout stays.
    const savedLive = (state.liveSessions ?? []).filter((s) => attached.has(s.sessionId) && ![...paths].some((p) => isInside(p, s.cwd)));
    const saved = await endAll(savedLive);
    result.ended.push(...saved.ended);
    result.errors.push(...saved.errors);

    for (const { repo, worktree } of worktrees) {
      const { ended, errors } = await endAll(worktree.agents?.live ?? []);
      result.ended.push(...ended);
      result.errors.push(...errors);
      if (errors.length > 0) continue;
      try {
        const outcome = await putAway(task, repo, worktree);
        if (outcome.removed) result.removed.push(outcome.removed);
        if (outcome.choice) result.choices.push(outcome.choice);
      } catch (error) {
        result.errors.push(`Could not remove ${worktree.path}: ${error.message}`);
      }
    }

    const endedBefore = (state.endedSessions ?? []).filter((s) => attached.has(s.sessionId) || paths.has(s.worktreePath));
    const justEnded = result.ended.map((sessionId) => ({ sessionId, endedAt: now() }));
    const forget = [...endedBefore.map(({ sessionId, endedAt }) => ({ sessionId, endedAt })), ...justEnded];
    if (forget.length > 0) await forgetSessions(forget);
    result.hidden = forget.length;
    return result;
  }

  const pending = () => [...choices.values()].map(({ mainPath, ...choice }) => choice);

  /** Your answer about a worktree left waiting: keep it, or delete it with whatever is in it (its branch stays). */
  async function choose(body) {
    const path = body?.path;
    if (typeof path !== 'string' || typeof body.keep !== 'boolean') throw new ActionError(400, 'Expected { path: "<worktree path>", keep: true|false }');
    const choice = choices.get(path);
    if (!choice) throw new ActionError(404, 'That worktree isn\'t waiting for a choice');
    if (body.keep === true) {
      choices.delete(path);
      return { kept: path };
    }
    const { liveSessions = [] } = await getSessions();
    if (liveSessions.some((s) => isInside(path, s.cwd))) throw new ActionError(409, 'A Claude session is running in it again; it was kept');
    try {
      // You chose to delete it with its uncommitted changes; that takes --force.
      await gitIn(choice.mainPath, ['worktree', 'remove', '--force', path]);
    } catch (error) {
      throw new ActionError(409, `git refused to remove it: ${error.message}`);
    }
    choices.delete(path);
    return { removed: path };
  }

  return { afterClose, pending, choose };
}
