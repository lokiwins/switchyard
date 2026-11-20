import type { HubTaskRef } from '../../lib/types';
import { openPane, type MakeTaskFrom } from '../../stores/panes';

/** "Task" to the task this work is on, or "Make task" to make one from it, filled in from its session. */
export function TaskFromWork({ from, hubTask }: { from: MakeTaskFrom; hubTask?: HubTaskRef | null }) {
  if (hubTask) {
    return <a href={`/tasks#${encodeURIComponent(hubTask.id)}`} className="btn btn-sm btn-secondary" title={`Task: ${hubTask.title}`}>Task</a>;
  }
  return (
    <button type="button" className="btn btn-sm btn-secondary" title="Make a task on the Tasks page from this, filled in from its session"
      onClick={() => openPane({ kind: 'make-task', from })}>
      Make task
    </button>
  );
}
