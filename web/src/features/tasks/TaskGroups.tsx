import { useTasksUi } from './store';
import { TaskRow, type RowContext } from './TaskRow';
import type { TaskGroup } from './types';

/* Your tasks in their groups: what needs you, then by when it's due; Done folded away until opened (or a search shows it). */

function GroupHead({ group, as: Tag }: { group: TaskGroup; as: 'h3' | 'summary' }) {
  return <Tag className="hub-group-head">{group.label}<span className="hub-count">{String(group.tasks.length)}</span></Tag>;
}

export function TaskGroups({ groups, context, searching }: { groups: TaskGroup[]; context: RowContext; searching: boolean }) {
  const doneOpen = useTasksUi((s) => s.doneOpen);
  const setDoneOpen = useTasksUi((s) => s.setDoneOpen);
  const list = (group: TaskGroup) => <ul className="list">{group.tasks.map((task) => <TaskRow key={task.id} task={task} context={context} />)}</ul>;
  return (
    <>
      {groups.map((group) => (group.key === 'done' ? (
        <details key={group.key} className="hub-group is-done" open={doneOpen || searching} onToggle={(event) => setDoneOpen(event.currentTarget.open)}>
          <GroupHead group={group} as="summary" />
          {list(group)}
        </details>
      ) : (
        <section key={group.key} className={`hub-group is-${group.key}`} aria-label={group.label}>
          <GroupHead group={group} as="h3" />
          {list(group)}
        </section>
      )))}
    </>
  );
}
