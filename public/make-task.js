import { h, toast } from './dom.js';
import { announceChange, post } from './actions.js';
import { openTaskPane } from './task-pane.js';
import { linkedWhere } from './task-state.js';

/*
 * Make a task on the Tasks page from work already under way: a session row on
 * the Agents page, or a worktree on the Worktrees page. The task form opens
 * filled in (the session's title and first prompt) and the server saves where
 * the work is on the task, so it shows under it. Work that already has a task
 * links to it instead.
 */

async function getJson(url) {
  const res = await fetch(url);
  const body = await res.json();
  if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body.data;
}

const draftUrl = (from) => (from.sessionId
  ? `/api/hub/tasks/draft?session=${encodeURIComponent(from.sessionId)}`
  : `/api/hub/tasks/draft?worktree=${encodeURIComponent(from.worktree)}`);

/** Open the filled-in task form for `from` ({ sessionId } or { worktree }). */
async function openDraft(from) {
  const draft = await getJson(draftUrl(from));
  const task = { id: null, title: draft.title, notes: draft.notes, dueOn: null, links: [] };
  openTaskPane(task, {
    heading: 'New task',
    sub: linkedWhere(draft.where),
    submitLabel: 'Add task',
    async save(fields) {
      try {
        const created = await post('/api/hub/tasks/create', { ...fields, from });
        toast(`Added task: ${created.title}`);
        // The page looks again (the task is read fresh each time), so this row shows its task.
        announceChange();
        return true;
      } catch (error) {
        toast(error.message);
        return false;
      }
    },
  });
}

/** A link to the task some work is on, opening it on the Tasks page. */
export function taskLinkTo(hubTask, className = 'btn btn-sm btn-secondary') {
  return h('a', { href: `/tasks#${encodeURIComponent(hubTask.id)}`, class: className, title: `Task: ${hubTask.title}` }, 'Task');
}

/** "Task" to the task this work is on, or "Make task" to make one from it. */
export function taskFromWork(from, hubTask) {
  if (hubTask) return taskLinkTo(hubTask);
  return h('button', {
    type: 'button',
    class: 'btn btn-sm btn-secondary',
    title: 'Make a task on the Tasks page from this, filled in from its session',
    onclick: async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await openDraft(from);
      } catch (error) {
        toast(error.message);
      } finally {
        button.disabled = false;
      }
    },
  }, 'Make task');
}
