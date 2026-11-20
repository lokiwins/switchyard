import { openPane } from '../../stores/panes';
import { changeTask } from './api';
import { useTasksUi } from './store';
import type { ShownTask, TaskFields } from './types';

/*
 * What you can do to a task. A start or a close shows on its row at once,
 * since the server takes a moment (a fetch and a checkout; ending sessions
 * and putting worktrees away) before it answers.
 */

const ui = () => useTasksUi.getState();

async function closing(task: ShownTask, kind: 'done' | 'dropped' | 'delete', run: () => Promise<boolean>) {
  ui().markClosing(task.id, kind);
  try {
    return await run();
  } finally {
    ui().markClosing(task.id, null);
  }
}

export const createTask = (fields: TaskFields, extra: Record<string, unknown> = {}, label = 'Added') =>
  changeTask('/api/hub/tasks/create', { ...fields, ...extra }, `${label}: ${fields.title.trim()}`);

export const taskActions = {
  close: (task: ShownTask, as: 'done' | 'dropped') => closing(task, as, () =>
    changeTask('/api/hub/tasks/close', { id: task.id, as }, as === 'done' ? `Done: ${task.title}` : `Dropped: ${task.title}`)),
  reopen: (task: ShownTask) => changeTask('/api/hub/tasks/reopen', { id: task.id }, `Reopened: ${task.title}`),
  remove: (task: ShownTask) => closing(task, 'delete', () => changeTask('/api/hub/tasks/delete', { id: task.id }, `Deleted: ${task.title}`)),
  /** The task's details, to edit and read its tickets. */
  open: (task: Pick<ShownTask, 'id' | 'title' | 'notes' | 'dueOn' | 'links'> & { state?: string }) => openPane({
    kind: 'task',
    task,
    save: (fields) => changeTask('/api/hub/tasks/update', { id: task.id, ...fields }, `Saved: ${fields.title.trim()}`),
  }),
  addSubtask: (parent: ShownTask) => openPane({
    kind: 'task',
    task: { id: null, title: '', notes: '', dueOn: null, links: [] },
    heading: 'New subtask',
    sub: `of ${parent.title}`,
    submitLabel: 'Add subtask',
    save: (fields) => createTask(fields, { parentId: parent.id }, 'Added subtask'),
  }),
  async start(task: ShownTask, repo: string, lead: boolean) {
    ui().markCreating(task.id, true);
    try {
      await changeTask('/api/hub/tasks/start', { id: task.id, repo, ...(lead ? { lead } : {}) });
    } finally {
      ui().markCreating(task.id, false);
    }
  },
  runCheck: (path: string, name?: string) => changeTask('/api/checks/run', { path, ...(name ? { name } : {}) }),
  review: (task: ShownTask, path: string) => changeTask('/api/hub/tasks/review', { id: task.id, path }, `Reviewing: ${task.title}`),
};
