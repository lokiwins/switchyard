import { ActionError } from './errors.js';
import { taskWorktrees } from './task-links.js';
import { gitReport as readGitReport } from './worker-report.js';

/*
 * What a lead's Claude can do through switchyard's MCP server (see
 * mcp-endpoint.js), for its own task only: start a worker, which is a
 * subtask of the lead's task, started like any task (its own worktree,
 * branched from the lead's branch, and session); list its workers; see one
 * worker's work in detail; message a worker; and end a worker's session.
 * Prompts a worker shows stay on the dashboard for you; the lead never
 * answers them, nor types over them.
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
  if (lead.closedAs) throw new ActionError(409, `The lead's task is ${lead.closedAs}; reopen it to work with its workers`);
  return lead;
}

/** One of the lead's workers: a subtask of the lead's task. Anything else, the lead may not see or touch. */
function ownWorker(tasks, lead, id) {
  const worker = tasks.find((t) => t.id === id && t.parentId === lead.id);
  if (!worker) throw new ActionError(404, `${id} is not one of your workers; list_workers gives their ids`);
  return worker;
}

/**
 * A worker's worktrees with its reviewers' sessions taken out (see review.js): a reviewer reading the work
 * isn't the worker, so it doesn't make the worker look busy, and is never messaged or ended as the worker.
 * Each keeps `allLive`, every session there, for the review's own status.
 */
function workerWorktrees(task, repos) {
  const reviewers = new Set((task.reviews ?? []).map((r) => r.sessionId));
  return taskWorktrees(task, repos).map(({ repo, worktree }) => {
    const allLive = worktree.agents?.live ?? [];
    const agents = { ...worktree.agents, live: allLive.filter((s) => !reviewers.has(s.sessionId)) };
    return { repo, worktree: { ...worktree, agents }, allLive };
  });
}

const liveSessionsOf = (worktrees) => worktrees.flatMap(({ worktree }) => worktree.agents?.live ?? []);

/** A worker's session in detail: what it last said, and the tool call it is in the middle of. */
const sessionDetail = ({ sessionId, status, needsYou, transcript }) => ({
  sessionId, status, needsYou, lastReply: transcript?.lastReply ?? null, activity: transcript?.activity ?? null,
});

// What the lead needs of a check: its name and outcome; the output is on the dashboard.
const checkSummary = ({ name, state, outOfDate }) => ({ name, state, outOfDate });

const worktreeView = ({ repo, worktree }) => ({
  repo: repo.name,
  branch: worktree.branch,
  path: worktree.path,
  sessions: (worktree.agents?.live ?? []).map(({ sessionId, status, needsYou }) => ({ sessionId, status, needsYou })),
});

/**
 * @param {{ taskHub: { list, create, remove }, hubStarter: { start }, getRepos: () => Promise<object[]>,
 *   actions?: { replyToSession, endSession }, checkResults?: (opts: { repos }) => Promise<object>,
 *   gitReport?: (args: { path, base }) => Promise<object>, reviewStatus?: (review, liveSessions) => Promise<object> }} deps
 *   `reviewStatus` gives a review's state and the reviewer's verdict (see review.js).
 */
export function createLeadTools({
  taskHub, hubStarter, getRepos, actions = null, checkResults = async () => ({}), gitReport = readGitReport, reviewStatus = null,
}) {
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
      const started = await hubStarter.start({ id: worker.id, repo: repo.mainPath }, { worker: true });
      return { id: worker.id, title: worker.title, repo: repo.name, branch: started.branch, path: started.path };
    } catch (error) {
      // So a retry doesn't leave two subtasks for the one worker.
      await taskHub.remove({ id: worker.id }).catch(() => {});
      throw error;
    }
  }

  /** The lead, the worker it names, and the repos with the worker's worktrees in them. */
  async function findWorker(leadId, id) {
    const tasks = await taskHub.list();
    const lead = checkLead(tasks, leadId);
    const worker = ownWorker(tasks, lead, id);
    const repos = await getRepos();
    return { lead, worker, repos, worktrees: workerWorktrees(worker, repos) };
  }

  /** A worker's state, its sessions' last replies, and its work next to the lead's branch in that repo. */
  async function workerStatus(leadId, { id }) {
    const { lead, worker, repos, worktrees } = await findWorker(leadId, id);
    const leadBranches = new Map(taskWorktrees(lead, repos).map(({ repo, worktree }) => [repo.mainPath, worktree.branch]));
    const checks = await checkResults({ repos });
    return {
      id: worker.id,
      title: worker.title,
      state: workerState(worker, worktrees.map(({ worktree }) => worktree.agents ?? {})),
      closedAs: worker.closedAs,
      worktrees: await Promise.all(worktrees.map(async ({ repo, worktree, allLive }) => ({
        repo: repo.name,
        branch: worktree.branch,
        path: worktree.path,
        sessions: (worktree.agents?.live ?? []).map(sessionDetail),
        work: await gitReport({ path: worktree.path, base: leadBranches.get(repo.mainPath) ?? null }),
        checks: (checks[worktree.path] ?? []).map(checkSummary),
        review: await latestReview(worker, worktree.path, allLive),
      }))),
    };
  }

  /** The worktree's latest review, as the lead needs it: its state, the reviewer's verdict and reasons, and when; null when none. */
  async function latestReview(worker, path, allLive) {
    const review = (worker.reviews ?? []).find((r) => r.path === path);
    if (!review || !reviewStatus) return null;
    const { state, summary, startedAt } = await reviewStatus(review, allLive);
    return { state, summary, startedAt };
  }

  /** The worker's running session, to message or end; refused when it has none. */
  function runningSessions(worker, worktrees) {
    const live = liveSessionsOf(worktrees);
    if (live.length === 0) throw new ActionError(409, `${worker.id} has no running session`);
    return live;
  }

  /** Type a message into the worker's session, as Reply does; never over a prompt, which is the user's to answer. */
  async function messageWorker(leadId, { id, text }) {
    const { worker, worktrees } = await findWorker(leadId, id);
    const [session] = runningSessions(worker, worktrees);
    if (session.needsYou) throw new ActionError(409, `${worker.id} is waiting on the user (a question or permission prompt); message it once they've answered`);
    const sent = await actions.replyToSession({ sessionId: session.sessionId, text });
    return { sent: true, sessionId: session.sessionId, queued: Boolean(sent?.queued) };
  }

  /** End the worker's sessions. Its worktree, branch and subtask stay, so its work can be merged; closing it is the user's call. */
  async function endWorker(leadId, { id }) {
    const { worker, worktrees } = await findWorker(leadId, id);
    const live = runningSessions(worker, worktrees);
    for (const session of live) await actions.endSession({ sessionId: session.sessionId });
    return { ended: live.map((s) => s.sessionId), kept: worktrees.map(({ worktree }) => worktree.path) };
  }

  async function listWorkers(leadId) {
    const tasks = await taskHub.list();
    const lead = checkLead(tasks, leadId);
    const repos = await getRepos();
    return tasks.filter((t) => t.parentId === lead.id).map((task) => {
      const worktrees = workerWorktrees(task, repos);
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
      workerStatus: (args) => workerStatus(leadId, args),
      messageWorker: (args) => messageWorker(leadId, args),
      endWorker: (args) => endWorker(leadId, args),
    }),
  };
}
