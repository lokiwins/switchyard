import { dueOnLabel } from './task-state.js';
import { hasFailedCheck } from './check-status.js';
import { sessionToJump } from './task-views.js';

/*
 * A task's row on the Tasks page is drawn in parts: its state, title, detail
 * line, due date, buttons, and one line per worktree. Each part's sig is
 * everything that part is drawn from, so a redraw rebuilds only the parts
 * whose sig changed (see keyed.js) and keeps the rest exactly as they are:
 * an open menu, a reply being typed, a selection. Kept apart from the DOM so
 * it can be tested.
 */

const sig = (value) => JSON.stringify(value);

/** The due date as of now; a closed task shows none. */
export function rowDue(task, now) {
  return task.state === 'done' || task.state === 'dropped' ? null : dueOnLabel(task.dueOn, now);
}

/** Whether Start ▾ is offered: a task not started yet, with tmux and a repo to start in. */
export const canStart = (task, { caps, repos }) => task.state === 'not-started' && Boolean(caps?.tmux) && repos.length > 0;

/** The parent's worktree a subtask starts from: its first one with a branch in a known repo. */
export const parentWorkFor = (parent, repos) => parent?.work.find((w) => w.branch && repos.some((r) => r.name === w.repoName)) ?? null;

/** What the buttons (Start ▾, trust prompt, ⋯) offer. Buttons act on the task as it is now, so its other fields don't count. */
function actionsSig(task, context) {
  const startable = canStart(task, context);
  const parentWork = startable ? parentWorkFor(context.parent, context.repos) : null;
  return sig([
    task.closing ?? null, task.start?.state === 'asking-trust' ? task.start : null,
    task.closedAs ?? null, Boolean(task.parentId), task.subtasks?.length ?? 0, hasFailedCheck(task),
    startable && context.repos.map((r) => [r.name, r.mainPath]),
    parentWork && [parentWork.repoName, parentWork.branch],
  ]);
}

/** A worktree's line: its data, the page's abilities, and any questions waiting from its own session. */
function linkSig(link, { caps, approvals }) {
  const session = sessionToJump(link);
  const ids = new Set([session?.sessionId, link.review?.session?.sessionId].filter(Boolean));
  return sig([link, caps, approvals.filter((a) => ids.has(a.sessionId))]);
}

/** The row's parts in order, each { key, sig }; `context` is { now, caps, repos, approvals, parent? }. */
export function taskRowParts(task, context) {
  return [
    { key: 'state', sig: task.state },
    { key: 'who', sig: sig([task.title, task.id, task.links]) },
    { key: 'detail', sig: sig([task.creating ?? false, task.closing ?? null, task.work.length > 0, task.start ?? null, task.notes]) },
    { key: 'due', sig: sig(rowDue(task, context.now)) },
    { key: 'actions', sig: actionsSig(task, context) },
    ...task.work.map((link) => ({ key: `link:${link.path}`, sig: linkSig(link, context) })),
  ];
}
