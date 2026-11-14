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

const attachments = (task) => (Array.isArray(task.attached) ? task.attached : []);

/** Whether a worktree's branch is the task's: it names the task's id or a ClickUp ticket it links to, or it's the branch saved on it. */
function branchIsTasks(task, repo, worktree) {
  if (!worktree.branch) return false;
  if ([task.id, ...ticketKeys(task.links)].some((key) => mentions(worktree.branch, key))) return true;
  return attachments(task).some((a) => a.repo === repo.mainPath && a.branch === worktree.branch);
}

const hasSession = (sessions, id) => (sessions ?? []).some((s) => s.sessionId === id);

/**
 * The work of a task saved with one session (one on a long-lived branch like
 * main): that session's worktree, showing only that session, and no PR,
 * since main's PR isn't the task's.
 */
function sessionLinks(task, worktrees) {
  return attachments(task).filter((a) => a.sessionId).flatMap(({ sessionId }) => {
    const found = worktrees.find(({ worktree }) => hasSession(worktree.agents?.live, sessionId) || hasSession(worktree.agents?.recent, sessionId));
    if (!found) return [];
    const link = linkOf(found.repo, found.worktree);
    return [{
      ...link, pr: null, live: link.live.filter((s) => s.sessionId === sessionId), recent: link.recent.filter((s) => s.sessionId === sessionId),
    }];
  });
}

/**
 * Your own tasks (see task-hub.js), each with `work`: the worktrees whose
 * branch is the task's (see branchIsTasks), with their PRs and sessions, and
 * the session saved on it, if any.
 */
export function linkHubTasks(tasks, repos) {
  const worktrees = repos.flatMap((repo) => repo.worktrees.map((worktree) => ({ repo, worktree })));
  return tasks.map((task) => {
    const byBranch = worktrees.filter(({ repo, worktree }) => branchIsTasks(task, repo, worktree));
    const paths = new Set(byBranch.map(({ worktree }) => worktree.path));
    return {
      ...task,
      work: [
        ...byBranch.map(({ repo, worktree }) => linkOf(repo, worktree)),
        ...sessionLinks(task, worktrees).filter((link) => !paths.has(link.path)),
      ],
    };
  });
}

const brief = (task) => (task ? { id: task.id, title: task.title } : null);

/** The repos, each worktree with `hubTask`: the task its branch is (see branchIsTasks), or null. */
export function worktreeHubTasks(repos, tasks) {
  return repos.map((repo) => ({
    ...repo,
    worktrees: repo.worktrees.map((worktree) => ({ ...worktree, hubTask: brief(tasks.find((t) => branchIsTasks(t, repo, worktree))) })),
  }));
}

/**
 * Each session's task, by session id, for the Agents page: the one saved
 * with that session, else the one its worktree's branch is.
 */
export function sessionHubTasks(tasks, { repos = [], endedSessions = [] }) {
  const bySession = new Map(tasks.flatMap((task) => attachments(task).filter((a) => a.sessionId).map((a) => [a.sessionId, task])));
  const result = {};
  const tag = (sessionId, repo, worktree) => {
    const task = bySession.get(sessionId) ?? (worktree && tasks.find((t) => branchIsTasks(t, repo, worktree)));
    if (task) result[sessionId] = brief(task);
  };
  for (const repo of repos) {
    for (const worktree of repo.worktrees) {
      for (const session of worktree.agents?.live ?? []) tag(session.sessionId, repo, worktree);
    }
  }
  for (const session of endedSessions) {
    const repo = repos.find((r) => r.worktrees.some((w) => w.path === session.worktreePath));
    tag(session.sessionId, repo, repo?.worktrees.find((w) => w.path === session.worktreePath));
  }
  return result;
}
