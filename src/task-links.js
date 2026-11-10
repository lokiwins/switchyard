/*
 * Which worktree is working on which task. A branch names its task the way
 * ClickUp's GitHub integration reads it: CU-<id> or the bare id (or the custom
 * id, like ENG-123), standing whole between separators, in any case.
 */

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether `id` stands whole in `branch`: not as part of a longer word or number. */
function mentions(branch, id) {
  if (typeof id !== 'string' || id === '') return false;
  return new RegExp(`(?:^|[^a-z0-9])${escape(id)}(?:$|[^a-z0-9])`, 'i').test(branch);
}

/** Whether a branch name says it's the work on `task`. */
export function branchNamesTask(branch, task) {
  if (!branch) return false;
  return mentions(branch, task.id) || mentions(branch, task.customId);
}

/** What the Tasks page needs about a worktree: where it is, its PR, and its sessions to jump to. */
function linkOf(repo, worktree) {
  const pr = worktree.pr;
  return {
    repoName: repo.name,
    path: worktree.path,
    branch: worktree.branch,
    pr: pr ? { number: pr.number, url: pr.url, state: pr.state } : null,
    live: worktree.agents?.live ?? [],
    recent: worktree.agents?.recent ?? [],
  };
}

/** Each task, with `links`: the worktrees whose branch names it. */
export function linkTasks(tasks, repos) {
  const worktrees = repos.flatMap((repo) => repo.worktrees.map((worktree) => ({ repo, worktree })));
  return tasks.map((task) => ({
    ...task,
    links: worktrees
      .filter(({ worktree }) => branchNamesTask(worktree.branch, task))
      .map(({ repo, worktree }) => linkOf(repo, worktree)),
  }));
}

/** The task a branch names, as much of it as a link back needs; null when it names none. */
export function taskForBranch(tasks, branch) {
  const task = tasks.find((t) => branchNamesTask(branch, t));
  return task ? { id: task.id, customId: task.customId ?? null, name: task.name, url: task.url ?? null } : null;
}

/** The repos, each worktree with `task`: the one its branch names, or null. */
export function tagWorktrees(repos, tasks) {
  return repos.map((repo) => ({
    ...repo,
    worktrees: repo.worktrees.map((worktree) => ({ ...worktree, task: taskForBranch(tasks, worktree.branch) })),
  }));
}
