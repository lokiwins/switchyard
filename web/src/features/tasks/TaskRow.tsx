import { TrustButtons } from '../agents/controls/session';
import type { Approval, Capabilities } from '../../lib/types';
import { taskActions } from './actions';
import { hasFailedCheck } from './check-status';
import { canStart, rowDue } from './logic';
import { STATE_LABELS, ticketLabel, trackerOf } from './task-state';
import { StartMenu } from './StartMenu';
import { TaskMenu } from './TaskMenu';
import type { ShownTask } from './types';
import { WorkLine } from './WorkLine';
import { Pill } from '../../components/Pill';
import { Dot } from '../../components/Dot';
import { cx } from '../../lib/cx';

/* A task's row: where it stands, its title and tickets, one line on it, when it's due, what you can do, its work, and its subtasks. */

/*
 * A row's columns: where it stands, title and tickets, its line, when it's
 * due, and its buttons; its work and subtasks under it. Narrower than a
 * tablet, the line and due day go under the title; on a phone the row is
 * where it stands, title and ⋯, then the line, then the due day.
 */
const ROW = [
  'grid items-center gap-3 px-2 -mx-2 hover:bg-hover',
  'grid-cols-[112px_minmax(200px,360px)_minmax(0,1fr)_108px_auto] max-tablet:grid-cols-[96px_minmax(0,1fr)_auto]',
  'max-phone:grid-cols-[auto_minmax(0,1fr)_auto] max-phone:gap-y-1',
].join(' ');

// The line and the due day under the title, narrower than a tablet; across the row on a phone, and left out there when empty.
const LINE_PLACE = 'max-tablet:[grid-column:2/-1] max-tablet:row-start-2 max-phone:[grid-column:1/-1] max-phone:empty:hidden';
const DUE_PLACE = 'max-tablet:[grid-column:2] max-tablet:row-start-3 max-phone:[grid-column:1/-1] max-phone:empty:hidden';

const LINE = cx('text-xs truncate min-w-0', LINE_PLACE);
const LINE_TONES = { pending: 'text-gray-500 italic', failed: 'text-red', plain: 'text-gray-700', notes: 'text-gray-400' } as const;

const DUE_TONES: Record<string, string> = { red: 'text-red font-semibold', amber: 'text-amber font-semibold' };

// Its buttons at the end; on a phone, ⋯ stays beside the title.
const ACTIONS = 'flex flex-wrap justify-end gap-1 max-phone:[grid-column:3] max-phone:row-start-1 max-phone:justify-start';

// A ticket link's badge, marked down its left side in its tracker's colour.
const TRACKER_COLOURS: Record<string, string> = {
  clickup: '[--tracker:#7b68ee]',
  github: '[--tracker:var(--gray-700)]',
  jira: '[--tracker:#2684ff]',
  ado: '[--tracker:#0078d4]',
};
const BADGE = 'inline-flex items-center ml-1.5 px-1.5 rounded-sm text-2xs leading-[17px] text-gray-500 hover:text-accent bg-neutral-soft no-underline hover:no-underline whitespace-nowrap';
const badgeClass = (tracker: string | null) => {
  const colour = tracker ? TRACKER_COLOURS[tracker] : undefined;
  return cx(BADGE, colour
    ? `${colour} shadow-[inset_2px_0_0_var(--tracker),inset_0_0_0_1px_var(--hairline)]`
    : 'shadow-[inset_0_0_0_1px_var(--hairline)]');
};

// A task's title opens its details: a button that reads as the title. A closed task's is grey; a dropped one's struck through.
const TITLE = [
  'max-w-full p-0 border-0 bg-transparent [font-family:inherit] [line-height:inherit] text-sm font-semibold text-left cursor-pointer truncate',
  'hover:text-accent hover:underline hover:underline-offset-2',
].join(' ');
const titleClass = (state: string) => cx(TITLE, state === 'done' || state === 'dropped' ? 'text-gray-500' : 'text-gray-900', state === 'dropped' && 'line-through');

export interface RowContext {
  now: number;
  caps: Capabilities;
  repos: { name: string; mainPath: string }[];
  approvals: Approval[];
}

function StateBadge({ state }: { state: string }) {
  const { label, tone } = STATE_LABELS[state] ?? { label: state, tone: '' };
  const dot = state === 'working' ? 'busy' : state === 'needs-you' ? 'idle' : null;
  return <Pill tone={tone}>{dot && <Dot state={dot} />}{label}</Pill>;
}

/** The row's one line: how a start is going, or the first line of the notes. */
function DetailLine({ task }: { task: ShownTask }) {
  const { start } = task;
  const pending = cx(LINE, LINE_TONES.pending);
  if (task.creating) return <span className={pending}>Creating the worktree…</span>;
  if (task.closing) {
    const doing = { done: 'Marking it done', dropped: 'Dropping it', delete: 'Deleting it' }[task.closing];
    return <span className={pending}>{task.work.length > 0 ? `${doing}: ending its sessions and putting its worktrees away…` : `${doing}…`}</span>;
  }
  if (start?.state === 'asking-trust') {
    return <span className={cx(LINE, LINE_TONES.plain)}><span className="mr-1 font-semibold text-amber">Asks:</span> trust this folder?</span>;
  }
  if (start?.state === 'starting') return <span className={pending}>{`Starting Claude in tmux window ${start.place}`}</span>;
  if (start?.state === 'exited') {
    const text = start.detail ? `Claude quit before starting: ${start.detail}` : 'Claude quit before starting';
    return <span className={cx(LINE, LINE_TONES.failed)} title={text}>{text}</span>;
  }
  return <span className={cx(LINE, LINE_TONES.notes)} title={task.notes}>{task.notes.split('\n')[0]}</span>;
}

function RowActions({ task, parent, context }: { task: ShownTask; parent: ShownTask | null; context: RowContext }) {
  // Already on its way out; a second click would only close it twice.
  if (task.closing) return <div className={ACTIONS} />;
  if (task.start?.state === 'asking-trust') return <div className={ACTIONS}><TrustButtons path={task.start.path} /></div>;
  return (
    <div className={ACTIONS}>
      {canStart(task, { tmux: Boolean(context.caps.tmux), repos: context.repos }) && (
        <StartMenu task={task} repos={context.repos} parent={parent} onStart={(repo, lead) => void taskActions.start(task, repo, lead)} />
      )}
      <TaskMenu task={task} actions={{
        close: (as) => void taskActions.close(task, as),
        reopen: () => void taskActions.reopen(task),
        remove: () => void taskActions.remove(task),
        addSubtask: () => taskActions.addSubtask(task),
      }} />
    </div>
  );
}

export function TaskRow({ task, parent = null, context }: { task: ShownTask; parent?: ShownTask | null; context: RowContext }) {
  const due = rowDue(task, context.now);
  const subtasks = task.subtasks ?? [];
  // An open task's work can close it; not one already on its way out.
  const markAs = task.closedAs || task.closing ? null : { failedCheck: hasFailedCheck(task), close: (as: 'done' | 'dropped') => void taskActions.close(task, as) };
  return (
    // A subtask's row is a little tighter, under its parent's.
    <li className={cx(ROW, parent ? 'py-2' : 'py-[7px]')}>
      <StateBadge state={task.state} />
      <div className="flex flex-col gap-px min-w-0 max-phone:col-start-2 max-phone:row-start-1">
        <button type="button" className={titleClass(task.state)} title="Details: edit it, and read its tickets" onClick={() => taskActions.open(task)}>{task.title}</button>
        <span className="text-xs text-gray-500 truncate min-w-0">
          <span className="font-mono text-[11.5px]">{task.id}</span>
          {task.links.map((link) => {
            const tracker = trackerOf(link);
            return <a key={link} className={badgeClass(tracker)} href={link} target="_blank" rel="noopener noreferrer" title={link}>{ticketLabel(link)}</a>;
          })}
        </span>
      </div>
      <DetailLine task={task} />
      <span data-due className={cx('text-xs whitespace-nowrap tabular-nums', (due?.tone && DUE_TONES[due.tone]) || 'text-gray-500', DUE_PLACE)}>{due?.text ?? ''}</span>
      <RowActions task={task} parent={parent} context={context} />
      {task.work.length > 0 && (
        <div className="grid gap-1 [grid-column:2/-1] max-tablet:[grid-column:1/-1]" aria-label="Work on this task">
          {task.work.map((work) => (
            <WorkLine key={work.path} work={work} caps={context.caps} approvals={context.approvals} onRunCheck={taskActions.runCheck}
              onReview={task.closedAs ? null : (path) => taskActions.review(task, path)} markAs={markAs} />
          ))}
        </div>
      )}
      {subtasks.length > 0 && (
        <ul className="[grid-column:1/-1] mt-2 mr-0 mb-0 ml-6 py-0 pr-0 pl-3 list-none border-l-2 border-gray-200" aria-label={`Subtasks of ${task.title}`}>
          {subtasks.map((sub) => <TaskRow key={sub.id} task={sub} parent={task} context={context} />)}
        </ul>
      )}
    </li>
  );
}
