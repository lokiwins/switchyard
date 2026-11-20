import type { Pane } from '../../stores/panes';
import { TaskEditor } from './TaskEditor';

/*
 * A task's details, in a pane over the Tasks page: edit its title, due day,
 * notes and links, and read each linked ticket, changing its status from here.
 */
export function TaskPane({ task, heading = task.title, sub = task.id, submitLabel, save }: Extract<Pane, { kind: 'task' }>) {
  return (
    <TaskEditor
      task={task}
      label={task.id ? `Task: ${task.title}` : heading}
      heading={heading}
      sub={sub}
      submitLabel={submitLabel}
      save={save}
    />
  );
}
