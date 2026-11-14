import { join } from 'node:path';
import { ActionError } from './errors.js';
import { firstPrompt, transcriptDirName } from './agents/claude-transcript.js';

/*
 * A task made from work already under way: a session on the Agents page, or a
 * worktree on the Worktrees page. The draft fills in the task form (the
 * session's title and first prompt); `attach` is what's saved on the task so
 * its work shows under it (see task-links.js): the repo and branch, or, on a
 * long-lived branch like main, just the one session, so the task doesn't take
 * in everything else done on main.
 */

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TITLE = 200;
const MAX_NOTES = 10_000;

const bad = (message) => new ActionError(400, message);

/** `{ sessionId }` or `{ worktree: path }`, checked. */
function parseFrom(from) {
  if (typeof from?.sessionId === 'string') {
    if (!SESSION_ID.test(from.sessionId)) throw bad('Not a session id');
    return { sessionId: from.sessionId };
  }
  if (typeof from?.worktree === 'string' && from.worktree) return { worktree: from.worktree };
  throw bad('Say which session or worktree the task is from');
}

const sessionsOf = (worktree) => [...(worktree.agents?.live ?? []), ...(worktree.agents?.recent ?? [])];

/** Where a session is: its repo, its worktree and the session itself; null when no worktree has it. */
function findSession(state, sessionId) {
  for (const repo of state.repos) {
    for (const worktree of repo.worktrees) {
      const session = sessionsOf(worktree).find((s) => s.sessionId === sessionId);
      if (session) return { repo, worktree, session };
    }
  }
  const ended = state.endedSessions?.find((s) => s.sessionId === sessionId && s.worktreePath);
  const repo = ended && state.repos.find((r) => r.worktrees.some((w) => w.path === ended.worktreePath));
  return repo ? { repo, worktree: repo.worktrees.find((w) => w.path === ended.worktreePath), session: ended } : null;
}

/** A worktree and its latest session (running first), if any. */
function findWorktree(state, path) {
  for (const repo of state.repos) {
    const worktree = repo.worktrees.find((w) => w.path === path);
    if (worktree) return { repo, worktree, session: worktree.agents?.live?.[0] ?? worktree.agents?.last ?? worktree.agents?.recent?.[0] ?? null };
  }
  return null;
}

/** Whether a task can be made from a worktree: it's on a branch of its own, or has a session to save instead. */
export function canMakeTaskFrom(worktree, isLongLivedBranch) {
  const ownBranch = Boolean(worktree.branch) && !isLongLivedBranch(worktree.branch);
  return ownBranch || Boolean(worktree.agents?.live?.[0] ?? worktree.agents?.last ?? worktree.agents?.recent?.[0]);
}

const firstLine = (text) => text?.split('\n').map((l) => l.trim()).find(Boolean) ?? null;
const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * @param {{ claudeDir: string, getState: () => Promise<{ repos: object[], endedSessions?: object[] }>, isLongLivedBranch: (branch: string) => boolean }} deps
 */
export function createTaskSources({ claudeDir, getState, isLongLivedBranch }) {
  const transcriptOf = (cwd, sessionId) => join(claudeDir, 'projects', transcriptDirName(cwd), `${sessionId}.jsonl`);

  /** What the task is from, and what to save on it. */
  async function locate(rawFrom) {
    const from = parseFrom(rawFrom);
    const state = await getState();
    const found = from.sessionId ? findSession(state, from.sessionId) : findWorktree(state, from.worktree);
    if (!found) {
      throw new ActionError(404, from.sessionId
        ? 'That session isn\'t in a worktree switchyard knows, or has gone; refresh the page'
        : 'That worktree is not there any more; refresh the page');
    }
    const { repo, worktree, session } = found;
    const sessionOnly = !worktree.branch || isLongLivedBranch(worktree.branch);
    if (!canMakeTaskFrom(worktree, isLongLivedBranch) || (sessionOnly && !session)) {
      throw new ActionError(409, `${worktree.branch ?? 'This worktree'} is a long-lived branch and has no session to make a task from; start one, or make the task on the Tasks page`);
    }
    const attached = sessionOnly ? [{ sessionId: session.sessionId }] : [{ repo: repo.mainPath, branch: worktree.branch }];
    return { repo, worktree, session, sessionOnly, attached };
  }

  return {
    /** The task form's starting point: a title, notes, and where the task will be linked. */
    async draft(from) {
      const { repo, worktree, session, sessionOnly } = await locate(from);
      const prompt = session ? await firstPrompt(transcriptOf(session.cwd ?? worktree.path, session.sessionId)) : null;
      const title = session?.transcript?.title ?? firstLine(prompt) ?? worktree.branch ?? repo.name;
      return {
        title: clip(title, MAX_TITLE),
        notes: prompt ? clip(prompt.trim(), MAX_NOTES) : '',
        where: { repoName: repo.name, branch: worktree.branch ?? null, sessionOnly },
      };
    },

    /** Whether a task can be made from this worktree (see canMakeTaskFrom). */
    canMake: (worktree) => canMakeTaskFrom(worktree, isLongLivedBranch),

    /** What a new task made from `from` saves, to link to its work. */
    attach: async (from) => (await locate(from)).attached,
  };
}
