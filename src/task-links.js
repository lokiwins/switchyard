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

// A ClickUp task link: app.clickup.com/t/<id>, or /t/<workspace>/<custom id> for a custom id like ENG-123.
const CLICKUP_TASK = /^\/t\/(?:\d+\/)?([A-Za-z0-9][A-Za-z0-9_-]*)\/?$/;

/** The ticket ids in a task's links that a branch could name: for now, ClickUp's. */
export function ticketKeys(links = []) {
  return links.flatMap((link) => {
    try {
      const url = new URL(link);
      const match = url.hostname === 'app.clickup.com' ? CLICKUP_TASK.exec(url.pathname) : null;
      return match ? [match[1]] : [];
    } catch {
      return [];
    }
  });
}

/**
 * Your own tasks (see task-hub.js), each with `work`: the worktrees whose
 * branch names the task's id or a ClickUp ticket it links to, with their
 * PRs and sessions.
 */
export function linkHubTasks(tasks, repos) {
  const worktrees = repos.flatMap((repo) => repo.worktrees.map((worktree) => ({ repo, worktree })));
  return tasks.map((task) => {
    const keys = [task.id, ...ticketKeys(task.links)];
    return {
      ...task,
      work: worktrees
        .filter(({ worktree }) => keys.some((key) => worktree.branch && mentions(worktree.branch, key)))
        .map(({ repo, worktree }) => linkOf(repo, worktree)),
    };
  });
}
