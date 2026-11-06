import { ActionError } from './errors.js';
import { run } from './exec.js';

/*
 * "Clean up" for a worktree whose PR is merged or closed: remove the worktree
 * and, when the PR was merged, its branch. Everything is checked again when
 * you click, not taken from the page: no Claude session running in it, no
 * uncommitted or untracked files, and no commits that aren't in the PR or on
 * a remote. The worktree is removed without --force, so git refuses too if
 * anything is left.
 */

const runGit = (args) => run('git', args);
const DONE_STATES = new Set(['MERGED', 'CLOSED']);

const isInside = (dir, path) => path === dir || path?.startsWith(`${dir}/`);

/** The repo and worktree at `path`, from the board's state. */
function findWorktree(state, path) {
  if (typeof path !== 'string') throw new ActionError(400, 'Expected { path: "<worktree path>" }');
  for (const repo of state.repos) {
    const worktree = repo.worktrees.find((w) => w.path === path && !w.prunable);
    if (worktree) return { repo, worktree };
  }
  throw new ActionError(404, 'That folder is not one of your worktrees');
}

export function createCleanupService({ stateService, git = runGit }) {
  const gitIn = (dir, args) => git(['-C', dir, ...args]);

  async function isAncestor(dir, commit, of) {
    try {
      await gitIn(dir, ['merge-base', '--is-ancestor', commit, of]);
      return true;
    } catch {
      // Not an ancestor, or `of` isn't here (e.g. commits pushed to the PR from elsewhere).
      return false;
    }
  }

  /**
   * Commits on the worktree's branch you'd lose: none when its tip is the PR's
   * last commit or behind it (a squash merge leaves the branch "unmerged" to
   * git, and GitHub may have deleted it on origin), otherwise those on no
   * remote branch.
   */
  async function unsavedCommits(dir, prHead) {
    const head = (await gitIn(dir, ['rev-parse', 'HEAD'])).trim();
    if (prHead && (head === prHead || await isAncestor(dir, head, prHead))) return 0;
    return Number((await gitIn(dir, ['rev-list', '--count', 'HEAD', '--not', '--remotes'])).trim());
  }

  async function checkSafe(worktree, liveSessions) {
    if (worktree.isMain) throw new ActionError(400, "That's the repo's main checkout");
    if (!DONE_STATES.has(worktree.pr?.state)) throw new ActionError(409, 'Only worktrees whose PR is merged or closed are cleaned up here');
    if (liveSessions.some((s) => isInside(worktree.path, s.cwd))) throw new ActionError(409, 'A Claude session is still running in it');
    const changes = (await gitIn(worktree.path, ['status', '--porcelain', '--untracked-files=all'])).split('\n').filter(Boolean);
    if (changes.length > 0) throw new ActionError(409, `It has ${changes.length} uncommitted or untracked file${changes.length === 1 ? '' : 's'}`);
    const unsaved = await unsavedCommits(worktree.path, worktree.pr.headRefOid);
    if (unsaved > 0) throw new ActionError(409, `It has ${unsaved} commit${unsaved === 1 ? '' : 's'} that ${unsaved === 1 ? "isn't" : "aren't"} in the PR or on origin`);
  }

  async function cleanUpWorktree(body) {
    const [state, sessions] = await Promise.all([stateService.getState(), stateService.getSessions({ force: true })]);
    const { repo, worktree } = findWorktree(state, body?.path);
    await checkSafe(worktree, sessions.liveSessions);
    await gitIn(repo.mainPath, ['worktree', 'remove', worktree.path]).catch((error) => {
      throw new ActionError(409, `git refused to remove it: ${error.message}`);
    });
    // A closed, unmerged PR keeps its branch in case the work is wanted later.
    if (worktree.pr.state !== 'MERGED' || !worktree.branch) return { removed: worktree.path, deletedBranch: null };
    try {
      // -D: after a squash merge, git doesn't see the branch as merged. It's in the PR, checked above.
      await gitIn(repo.mainPath, ['branch', '-D', worktree.branch]);
      return { removed: worktree.path, deletedBranch: worktree.branch };
    } catch (error) {
      return { removed: worktree.path, deletedBranch: null, branchError: error.message };
    }
  }

  return { cleanUpWorktree };
}
