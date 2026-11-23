/*
 * The Tasks page's own small rules, on top of task-state.ts.
 */
import { dueOnLabel } from './task-state';
import type { ShownTask, Work } from './types';

/** The due date as of now; a closed task shows none. */
export const rowDue = (task: ShownTask, now: number) => (task.state === 'done' || task.state === 'dropped' ? null : dueOnLabel(task.dueOn, now));

/** Whether Start ▾ is offered: a task not started yet, with tmux and a repo to start in. */
export const canStart = (task: ShownTask, { tmux, repos }: { tmux: boolean; repos: unknown[] }) => task.state === 'not-started' && tmux && repos.length > 0;

/** The parent's worktree a subtask starts from: its first one with a branch in a known repo. */
export const parentWorkFor = (parent: ShownTask | null | undefined, repos: { name: string }[]): Work | null =>
  parent?.work.find((w) => w.branch && repos.some((r) => r.name === w.repoName)) ?? null;
