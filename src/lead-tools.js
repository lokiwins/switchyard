import { ActionError } from './errors.js';
import { taskWorktrees } from './task-links.js';

/*
 * What a lead's Claude can do through switchyard's MCP server (see
 * mcp-endpoint.js), for its own task only: start a worker, which is a
 * subtask of the lead's task, started like any task (its own worktree,
 * branched from the lead's branch, and session), and list its workers with
 * what each is doing. Prompts a worker shows stay on the dashboard for you;
 * the lead never answers them.
 */

// A safety limit until the running-agents cap in Settings: a lead in a loop can't fill the machine with sessions.
export const MAX_OPEN_WORKERS = 8;

/** A worker's state in a word or two: closed, not started, needs you, working, idle, or no session. */
export function workerState(task, worktrees) {
  if (task.closedAs) return task.closedAs;
  if (worktrees.length === 0) return 'not started';
  const live = worktrees.flatMap((w) => w.live ?? []);
  if (live.length === 0) return 'no session';
  if (live.some((s) => s.needsYou)) return 'needs you';
  return live.some((s) => s.status === 'busy') ? 'working' : 'idle';
}

/** The lead's task: there, open, and not a subtask (workers are one level deep). */
function checkLead(tasks, id) {
  const lead = tasks.find((t) => t.id === id);
  if (!lead) throw new ActionError(404, 'The lead\'s task is not there any more');
  if (lead.parentId) throw new ActionError(403, 'A subtask can\'t lead workers');
  if (lead.closedAs) throw new ActionError(409, `The lead's task is ${lead.closedAs}; reopen it to start workers`);
  return lead;
}

const worktreeView = ({ repo, worktree }) => ({
  repo: repo.name,
  branch: worktree.branch,
  path: worktree.path,
  sessions: (worktree.agents?.live ?? []).map(({ sessionId, status, needsYou }) => ({ sessionId, status, needsYou })),
});

/**
 * @param {{ taskHub: { list, create, remove }, hubStarter: { start }, getRepos: () => Promise<object[]> }} deps
 */
export function createLeadTools({ taskHub, hubStarter, getRepos }) {
  // Each lead's starts, one after another, so starts asked for at once can't all pass the limit.
  const queues = new Map();
  function oneAtATime(leadId, work) {
    const run = (queues.get(leadId) ?? Promise.resolve()).then(work);
    const settled = run.catch(() => {});
    queues.set(leadId, settled);
    settled.then(() => {
      if (queues.get(leadId) === settled) queues.delete(leadId);
    });
    return run;
  }

  /** The repo a worker starts in: the one named (by name or folder), else the one the lead works in. */
  function workerRepo(lead, repos, named) {
    if (named) {
      const repo = repos.find((r) => r.name === named || r.mainPath === named);
      if (!repo) throw new ActionError(404, `There's no repository ${named}; the repositories are ${repos.map((r) => r.name).join(', ')}`);
      return repo;
    }
    const [own] = taskWorktrees(lead, repos);
    if (!own) throw new ActionError(400, 'Your task has no worktree yet to start a worker beside; name the repo to start it in');
    return own.repo;
  }

  async function startWorker(leadId, { title, notes = '', repo: named }) {
    const tasks = await taskHub.list();
    const lead = checkLead(tasks, leadId);
    const open = tasks.filter((t) => t.parentId === lead.id && !t.closedAs).length;
    if (open >= MAX_OPEN_WORKERS) throw new ActionError(409, `A lead can have at most ${MAX_OPEN_WORKERS} open workers; close one (or ask the user to) first`);
    const repo = workerRepo(lead, await getRepos(), named);
    const worker = await taskHub.create({ title, notes, parentId: lead.id });
    try {
      const started = await hubStarter.start({ id: worker.id, repo: repo.mainPath });
      return { id: worker.id, title: worker.title, repo: repo.name, branch: started.branch, path: started.path };
    } catch (error) {
      // So a retry doesn't leave two subtasks for the one worker.
      await taskHub.remove({ id: worker.id }).catch(() => {});
      throw error;
    }
  }

  async function listWorkers(leadId) {
    const tasks = await taskHub.list();
    const lead = checkLead(tasks, leadId);
    const repos = await getRepos();
    return tasks.filter((t) => t.parentId === lead.id).map((task) => {
      const worktrees = taskWorktrees(task, repos);
      return {
        id: task.id,
        title: task.title,
        state: workerState(task, worktrees.map(({ worktree }) => worktree.agents ?? {})),
        closedAs: task.closedAs,
        worktrees: worktrees.map(worktreeView),
      };
    });
  }

  return {
    /** The tools, acting for the lead of task `leadId`. */
    forLead: (leadId) => ({
      startWorker: (args) => oneAtATime(leadId, () => startWorker(leadId, args)),
      listWorkers: () => listWorkers(leadId),
    }),
  };
}
