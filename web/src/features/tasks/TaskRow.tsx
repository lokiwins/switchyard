import { TrustButtons } from '../agents/controls/session';
import type { Approval, Capabilities } from '../../lib/types';
import { taskActions } from './actions';
import { canStart, rowDue, STATE_LABELS, ticketLabel, trackerOf } from './logic';
import { StartMenu } from './StartMenu';
import { TaskMenu } from './TaskMenu';
import type { ShownTask } from './types';
import { WorkLine } from './WorkLine';

/* A task's row: where it stands, its title and tickets, one line on it, when it's due, what you can do, its work, and its subtasks. */

export interface RowContext {
  now: number;
  caps: Capabilities;
  repos: { name: string; mainPath: string }[];
  approvals: Approval[];
}

function StateBadge({ state }: { state: string }) {
  const { label, tone } = STATE_LABELS[state] ?? { label: state, tone: '' };
  const dot = state === 'working' ? 'busy' : state === 'needs-you' ? 'idle' : null;
  return <span className={`pill ${tone}`}>{dot && <span className={`dot ${dot}`} aria-hidden="true" />}{label}</span>;
}

/** The row's one line: how a start is going, or the first line of the notes. */
function DetailLine({ task }: { task: ShownTask }) {
  const { start } = task;
  if (task.creating) return <span className="row-detail is-pending">Creating the worktree…</span>;
  if (task.closing) {
    const doing = { done: 'Marking it done', dropped: 'Dropping it', delete: 'Deleting it' }[task.closing];
    return <span className="row-detail is-pending">{task.work.length > 0 ? `${doing}: ending its sessions and putting its worktrees away…` : `${doing}…`}</span>;
  }
  if (start?.state === 'asking-trust') return <span className="row-detail is-needs-you"><span className="row-detail-label">Asks:</span> trust this folder?</span>;
  if (start?.state === 'starting') return <span className="row-detail is-pending">{`Starting Claude in tmux window ${start.place}`}</span>;
  if (start?.state === 'exited') {
    const text = start.detail ? `Claude quit before starting: ${start.detail}` : 'Claude quit before starting';
    return <span className="row-detail is-failed" title={text}>{text}</span>;
  }
  return <span className="row-detail muted" title={task.notes}>{task.notes.split('\n')[0]}</span>;
}

function RowActions({ task, parent, context }: { task: ShownTask; parent: ShownTask | null; context: RowContext }) {
  // Already on its way out; a second click would only close it twice.
  if (task.closing) return <div className="actions" />;
  if (task.start?.state === 'asking-trust') return <div className="actions"><TrustButtons path={task.start.path} /></div>;
  return (
    <div className="actions">
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
  return (
    <li className={`list-row hub-row is-${task.state}${task.work.length ? ' has-links' : ''}`}>
      <StateBadge state={task.state} />
      <div className="row-who">
        <button type="button" className="row-title row-title-btn" title="Details: edit it, and read its tickets" onClick={() => taskActions.open(task)}>{task.title}</button>
        <span className="row-where">
          <span className="mono">{task.id}</span>
          {task.links.map((link) => {
            const tracker = trackerOf(link);
            return <a key={link} className={`ticket-badge${tracker ? ` is-${tracker}` : ''}`} href={link} target="_blank" rel="noopener noreferrer" title={link}>{ticketLabel(link)}</a>;
          })}
        </span>
      </div>
      <DetailLine task={task} />
      <span className={`task-due${due?.tone ? ` ${due.tone}` : ''}`}>{due?.text ?? ''}</span>
      <RowActions task={task} parent={parent} context={context} />
      {task.work.length > 0 && (
        <div className="task-links" aria-label="Work on this task">
          {task.work.map((work) => (
            <WorkLine key={work.path} work={work} caps={context.caps} approvals={context.approvals} onRunCheck={taskActions.runCheck}
              onReview={task.closedAs ? null : (path) => taskActions.review(task, path)} />
          ))}
        </div>
      )}
      {subtasks.length > 0 && (
        <ul className="subtasks" aria-label={`Subtasks of ${task.title}`}>
          {subtasks.map((sub) => <TaskRow key={sub.id} task={sub} parent={task} context={context} />)}
        </ul>
      )}
    </li>
  );
}
