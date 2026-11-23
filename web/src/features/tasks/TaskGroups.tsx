import { stackedListClass } from '../../components/classes';
import { cx } from '../../lib/cx';
import { useTasksUi } from './store';
import { TaskRow, type RowContext } from './TaskRow';
import type { TaskGroup } from './types';

/* Your tasks in their groups: what needs you, then by when it's due; Done folded away until opened (or a search shows it). */

// A group's head: small caps, amber for what needs you and red for what's overdue, with its count.
const HEAD = 'flex items-center gap-2 mt-0 mx-0 mb-1 text-xs font-bold tracking-[0.04em] uppercase';
const HEAD_TONES: Record<string, string> = { 'needs-you': 'text-amber', overdue: 'text-red' };
const COUNT = 'min-w-[18px] px-[5px] rounded-[9px] bg-neutral-soft text-gray-700 text-center tabular-nums';
// Done folds away: its head is the <summary>, with ▸ or ▾ before it.
const FOLD = "cursor-pointer list-none before:content-['▸'] group-open:before:content-['▾']";
// Space between one group and the next.
const GROUP = 'not-first:mt-4';

function GroupHead({ group, as: Tag }: { group: TaskGroup; as: 'h3' | 'summary' }) {
  return (
    <Tag className={cx(HEAD, HEAD_TONES[group.key] ?? 'text-gray-500', Tag === 'summary' && FOLD)}>
      {group.label}<span className={COUNT}>{String(group.tasks.length)}</span>
    </Tag>
  );
}

export function TaskGroups({ groups, context, searching }: { groups: TaskGroup[]; context: RowContext; searching: boolean }) {
  const doneOpen = useTasksUi((s) => s.doneOpen);
  const setDoneOpen = useTasksUi((s) => s.setDoneOpen);
  const list = (group: TaskGroup) => <ul className={stackedListClass}>{group.tasks.map((task) => <TaskRow key={task.id} task={task} context={context} />)}</ul>;
  return (
    <>
      {groups.map((group) => (group.key === 'done' ? (
        <details key={group.key} className={cx('group', GROUP)} open={doneOpen || searching} onToggle={(event) => setDoneOpen(event.currentTarget.open)}>
          <GroupHead group={group} as="summary" />
          {list(group)}
        </details>
      ) : (
        <section key={group.key} className={GROUP} aria-label={group.label}>
          <GroupHead group={group} as="h3" />
          {list(group)}
        </section>
      )))}
    </>
  );
}
