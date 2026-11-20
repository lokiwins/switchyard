import type { HubTaskRef } from '../../lib/types';
import { openPane, type MakeTaskFrom } from '../../stores/panes';
import { Button, buttonClass } from '../../components/Button';

/** "Task" to the task this work is on, or "Make task" to make one from it, filled in from its session. */
export function TaskFromWork({ from, hubTask }: { from: MakeTaskFrom; hubTask?: HubTaskRef | null }) {
  if (hubTask) {
    return <a href={`/tasks#${encodeURIComponent(hubTask.id)}`} className={buttonClass({ variant: 'secondary', size: 'sm' })} title={`Task: ${hubTask.title}`}>Task</a>;
  }
  return (
    <Button type="button" variant="secondary" size="sm" title="Make a task on the Tasks page from this, filled in from its session"
      onClick={() => openPane({ kind: 'make-task', from })}>
      Make task
    </Button>
  );
}
