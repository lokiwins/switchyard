import { branchFromTask } from './branch-name.js';

/*
 * A task you just started from New task, shown on the Agents page until its
 * Claude session shows up there. Creating the worktree takes a moment (a fetch,
 * a checkout), and Claude takes a few seconds more to register, so without
 * this nothing on the page says it's coming. No DOM here, so it's tested in node.
 */

// After this long without a session, say where to look: Claude may be asking whether to trust the folder.
export const SLOW_MS = 15_000;
// After this long, stop waiting on the page; the tmux window is still there.
export const GIVE_UP_MS = 120_000;

/** A task the server is still creating. The branch is the one it will most likely get. */
export function pendingTask({ id, repoName, branch, prompt, now }) {
  const typed = String(branch ?? '').trim();
  return { id, stage: 'creating', repoName, prompt, branch: typed || branchFromTask(prompt), createdAt: now, startedAt: null };
}

/** The same task once the server has made the worktree and started Claude in its tmux window. */
export function startedTask(task, { path, branch, session, window }, now) {
  return { ...task, stage: 'starting', path, branch, place: `${session}:${window}`, startedAt: now };
}

const trimSlash = (path) => String(path ?? '').replace(/\/+$/, '');

const hasArrived = (task, liveSessions) => task.stage === 'starting'
  && liveSessions.some((s) => trimSlash(s.cwd) === trimSlash(task.path));

/** Which tasks are still to come, which have a session now, and which took too long to wait for. */
export function settlePending(tasks, liveSessions, now) {
  const arrived = tasks.filter((t) => hasArrived(t, liveSessions));
  const rest = tasks.filter((t) => !arrived.includes(t));
  const expired = rest.filter((t) => t.stage === 'starting' && now - t.startedAt >= GIVE_UP_MS);
  return { pending: rest.filter((t) => !expired.includes(t)), arrived, expired };
}

/** What the row says: its badge, its one line, and a note when it's taking a while. */
export function pendingText(task, now) {
  if (task.stage === 'creating') {
    return { label: 'Creating…', detail: `Creating the worktree for "${task.prompt}"`, note: null };
  }
  const slow = now - task.startedAt >= SLOW_MS;
  return {
    label: 'Starting…',
    detail: `Starting Claude in tmux window ${task.place}`,
    note: slow ? `Still starting. If Claude is asking whether to trust this folder, answer it in tmux window ${task.place}.` : null,
  };
}
