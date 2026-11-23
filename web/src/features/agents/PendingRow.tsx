import { pendingText, type PendingTask } from '../../lib/pending-tasks';
import { TrustButtons } from './controls/session';
import { SessionRow, StatusBadge, WhereLabel } from './Row';

/* A task started from New task whose session hasn't shown up yet. */

const TONE: Partial<Record<PendingTask['stage'], string>> = { trust: 'amber', exited: 'red' };
const DOT: Partial<Record<PendingTask['stage'], string | null>> = { trust: 'idle', exited: null };

export function PendingRow({ task, now }: { task: PendingTask; now: number }) {
  const text = pendingText(task, now);
  return (
    <SessionRow
      tone={task.stage === 'trust' || task.stage === 'exited' ? task.stage : 'pending'}
      badge={<StatusBadge tone={TONE[task.stage] ?? ''} dot={task.stage in DOT ? DOT[task.stage] : 'busy'} label={text.label} />}
      title={task.prompt}
      titleHint={[task.path, task.place && `in tmux window ${task.place}`].filter(Boolean).join(' · ') || task.prompt}
      where={<WhereLabel repoName={task.repoName} branch={task.branch} path={task.path ?? ''} />}
      detail={{ kind: task.stage === 'trust' ? 'needs-you' : 'pending', text: text.detail }}
      note={text.note}
      since={task.createdAt}
      timeHint={`Started ${new Date(task.createdAt).toLocaleString()}`}
      actions={task.stage === 'trust' && task.path ? <TrustButtons path={task.path} /> : null}
    />
  );
}
