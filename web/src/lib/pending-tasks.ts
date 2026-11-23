import { branchFromTask } from '../../../shared/branch-name.ts';
import type { LiveSession, TaskStart } from './types';

/*
 * A task you just started from New task, shown on the Agents page until its
 * Claude session shows up there. Creating the worktree takes a moment (a fetch,
 * a checkout), and Claude takes a few seconds more to register, so without
 * this nothing on the page says it's coming. The server watches the tmux pane
 * too (see src/task-starts.js) and says when Claude asks whether to trust the
 * folder or quits.
 */

export interface PendingTask {
  id: string;
  stage: 'creating' | 'starting' | 'trust' | 'exited';
  repoName?: string;
  prompt: string;
  branch: string;
  createdAt: number;
  startedAt: number | null;
  path?: string;
  place?: string;
  trust?: unknown;
  detail?: string | null;
  exitedAt?: number;
}
export interface StartResult { path: string; branch: string; session: string; window: string }

// After this long without a session, say where to look.
export const SLOW_MS = 15_000;
// How long a task whose Claude quit stays on the page, saying so.
export const EXITED_SHOW_MS = 10_000;
// After this long, stop waiting on the page; the tmux window is still there.
export const GIVE_UP_MS = 120_000;

/** A task the server is still creating. The branch is the one it will most likely get. */
export function pendingTask({ id, repoName, branch, prompt, now }: { id: string; repoName?: string; branch?: string | null; prompt: string; now: number }): PendingTask {
  const typed = String(branch ?? '').trim();
  return { id, stage: 'creating', repoName, prompt, branch: typed || branchFromTask(prompt), createdAt: now, startedAt: null };
}

/** The same task once the server has made the worktree and started Claude in its tmux window. */
export function startedTask(task: PendingTask, { path, branch, session, window }: StartResult, now: number): PendingTask {
  return { ...task, stage: 'starting', path, branch, place: `${session}:${window}`, startedAt: now };
}

const trimSlash = (path: string | null | undefined) => String(path ?? '').replace(/\/+$/, '');

const hasArrived = (task: PendingTask, liveSessions: Pick<LiveSession, 'cwd'>[]) => task.startedAt !== null
  && liveSessions.some((s) => trimSlash(s.cwd) === trimSlash(task.path));

/** A started task as the server last saw its pane: asking to trust the folder, quit, or still starting. */
function withStart(task: PendingTask, starts: TaskStart[], now: number): PendingTask {
  if (task.stage === 'creating' || task.stage === 'exited') return task;
  const start = starts.find((s) => trimSlash(s.path) === trimSlash(task.path));
  if (start?.state === 'exited') return { ...task, stage: 'exited', trust: null, detail: start.detail ?? null, exitedAt: now };
  if (start?.state === 'asking-trust') return { ...task, stage: 'trust', trust: start.trust };
  return { ...task, stage: 'starting', trust: null };
}

const isGone = (task: PendingTask, now: number) => (task.stage === 'exited'
  ? now - (task.exitedAt ?? now) >= EXITED_SHOW_MS
  : task.startedAt !== null && now - task.startedAt >= GIVE_UP_MS);

/**
 * Which tasks are still to come (as the server's `starts` describe them),
 * which have a session now, and which took too long to wait for. A task whose
 * Claude quit shows a while, then goes without being counted as expired.
 */
export function settlePending(tasks: PendingTask[], liveSessions: Pick<LiveSession, 'cwd'>[], now: number, starts: TaskStart[] = []) {
  const arrived = tasks.filter((t) => hasArrived(t, liveSessions));
  const rest = tasks.filter((t) => !arrived.includes(t)).map((t) => withStart(t, starts, now));
  return {
    pending: rest.filter((t) => !isGone(t, now)),
    arrived,
    expired: rest.filter((t) => t.stage !== 'exited' && isGone(t, now)),
  };
}

/** What the row says: its badge, its one line, and a note when there's more to know. */
export function pendingText(task: PendingTask, now: number): { label: string; detail: string; note: string | null } {
  if (task.stage === 'creating') {
    return { label: 'Creating…', detail: `Creating the worktree for "${task.prompt}"`, note: null };
  }
  if (task.stage === 'trust') {
    return {
      label: 'Needs you',
      detail: 'Claude asks whether to trust this folder',
      note: `Trust folder starts Claude; Don't trust and it exits. Or answer it in tmux window ${task.place}.`,
    };
  }
  if (task.stage === 'exited') {
    return {
      label: "Didn't start",
      detail: task.detail ? `Claude quit before starting: ${task.detail}` : 'Claude quit before starting',
      note: `The worktree is still there; start Claude in it from tmux window ${task.place}.`,
    };
  }
  const slow = task.startedAt !== null && now - task.startedAt >= SLOW_MS;
  return {
    label: 'Starting…',
    detail: `Starting Claude in tmux window ${task.place}`,
    note: slow ? `Still starting. See what Claude is doing in tmux window ${task.place}.` : null,
  };
}
