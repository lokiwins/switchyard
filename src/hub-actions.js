/*
 * The Tasks page's actions on a task as a whole: make one, close or delete
 * it with its subtasks (putting their work away, see task-cleanup.js), and
 * Keep or Delete a worktree a closed task left waiting. Each takes the
 * server's services and the request body.
 */

/**
 * After a task's work was put away: every view afresh, and the worktree list
 * found again only when a worktree went (it means a git call per repo).
 */
async function workPutAway({ stateService }, { removed = [] } = {}) {
  if (removed.length > 0) await stateService.rediscover();
  stateService.sessionsRemoved();
}

/** Put away each task's work (see task-cleanup.js), as one summary of what happened. */
async function putAwayAll({ taskCleanup }, tasks) {
  const all = { ended: [], hidden: 0, removed: [], choices: [], errors: [] };
  for (const task of tasks) {
    const one = await taskCleanup.afterClose(task);
    all.ended.push(...one.ended);
    all.hidden += one.hidden;
    all.removed.push(...one.removed);
    all.choices.push(...one.choices);
    all.errors.push(...one.errors);
  }
  return all;
}

/** Done or dropped: the task and its open subtasks close; their sessions end, come off the lists, and their worktrees go. */
export async function closeHubTask(services, body) {
  const [task, ...subtasks] = await services.taskHub.closeWithSubtasks(body);
  const cleanup = await putAwayAll(services, [task, ...subtasks]);
  await workPutAway(services, cleanup);
  return { ...task, subtasksClosed: subtasks.length, cleanup };
}

/** Deleted, with its subtasks: their work is put away as when they're closed, found while the tasks are still there. */
export async function deleteHubTask(services, body) {
  const removed = await services.taskHub.removeWithSubtasks(body);
  const cleanup = await putAwayAll(services, removed);
  await workPutAway(services, cleanup);
  return { removed: body.id, subtasksRemoved: removed.length - 1, cleanup };
}

/** Keep or Delete for a worktree a closed task left waiting. */
export async function chooseWorktree(services, body) {
  const result = await services.taskCleanup.choose(body);
  if (result.removed) await workPutAway(services, { removed: [result.removed] });
  return result;
}

export async function createHubTask({ taskHub, taskSources }, body) {
  const attached = body?.from ? await taskSources.attach(body.from) : [];
  return taskHub.create(body, { attached });
}
