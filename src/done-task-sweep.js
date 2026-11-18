import { linkHubTasks } from './task-links.js';

/*
 * With Settings › Tasks › "Delete done tasks" on, a task done or dropped for
 * the days set there is deleted, which puts its work away as deleting it by
 * hand does (see task-cleanup.js). A task marked done counts from when it was
 * closed; one done because its PR merged, from when switchyard first saw it so.
 */

// How often to look; a task goes within this long of its time.
export const SWEEP_MS = 60 * 60_000;

/** As the Tasks page sees it (task-state.js): a merged PR on its work makes it done. */
const isMergedDone = (task) => task.work.some((w) => w.pr?.state === 'MERGED');

export function createDoneTaskSweep({
  taskHub, getSessions, settings, deleteTask, now = Date.now,
}) {
  let running = null;

  /** When the task was done, or null while it's open; notes a merged one's first sighting. */
  async function doneSince(task) {
    if (task.closedAs) return task.closedAt;
    if (!isMergedDone(task)) return null;
    if (task.doneSeenAt) return task.doneSeenAt;
    await taskHub.noteDoneSeen(task.id);
    return now();
  }

  async function sweep() {
    const { autoDeleteDone, deleteDoneAfterMs } = settings();
    const result = { deleted: [], errors: [] };
    if (!autoDeleteDone) return result;
    const [tasks, sessions] = await Promise.all([taskHub.list(), getSessions()]);
    for (const task of linkHubTasks(tasks, sessions.repos ?? [])) {
      const since = await doneSince(task);
      if (since === null || now() - since < deleteDoneAfterMs) continue;
      try {
        await deleteTask(task.id);
        result.deleted.push(task.id);
      } catch (error) {
        result.errors.push(`${task.title}: ${error.message}`);
      }
    }
    return result;
  }

  /** Look once; a look already under way is joined, not doubled. */
  function run() {
    running ??= sweep().finally(() => { running = null; });
    return running;
  }

  return { run };
}
