import { OpenMenu } from '../../components/OpenMenu';
import type { Approval, Capabilities } from '../../lib/types';
import { SessionControls } from '../agents/controls/SessionControls';
import { SessionAlerts } from '../agents/Row';
import { ChecksControl } from './ChecksControl';
import { MarkAsMenu } from './MarkAsMenu';
import { sessionToJump } from './task-views';
import { ReviewControl } from './ReviewControl';
import type { Work } from './types';
import { cx } from '../../lib/cx';

/*
 * A worktree working on a task: where, its PR, its session's alerts, its
 * checks, its review, and its session's controls (or a way to start one).
 */

const PR_STATES: Record<string, string> = { OPEN: 'open', MERGED: 'merged', CLOSED: 'closed' };

const mine = (approvals: Approval[], sessionId: string | undefined) => approvals.filter((a) => a.sessionId === sessionId);

/** Closing the task from its work: only for an open task. */
export interface MarkAs {
  failedCheck: boolean;
  close: (as: 'done' | 'dropped') => void;
}

export function WorkLine({ work, caps, approvals, onRunCheck, onReview, markAs }: {
  work: Work;
  caps: Capabilities;
  approvals: Approval[];
  onRunCheck: (path: string, name?: string) => Promise<unknown>;
  /** Only for an open task: a closed one's work is put away. */
  onReview: ((path: string) => Promise<unknown>) | null;
  /** Mark as ▾ in End ▾'s place; null keeps End ▾. */
  markAs: MarkAs | null;
}) {
  const session = sessionToJump(work);
  const state = work.pr ? PR_STATES[work.pr.state] : undefined;
  const reviewer = work.review?.session;
  return (
    <div className="flex flex-wrap items-center gap-2 min-w-0 text-xs text-gray-500">
      <span className="truncate min-w-0" title={work.path}>{work.repoName}{' · '}<span className="font-mono text-xs text-gray-700">{work.branch}</span></span>
      {work.pr && (
        // A closed PR is struck through.
        <a className={cx('text-xs leading-xs', state === 'closed' && 'text-gray-500 line-through')} href={work.pr.url} target="_blank" rel="noopener noreferrer"
          title={`Pull request${state ? ` (${state})` : ''}`}>{`#${work.pr.number}`}</a>
      )}
      {session && <SessionAlerts session={session} />}
      <ChecksControl checks={work.checks} names={work.checkNames} onRun={(name) => onRunCheck(work.path, name)} />
      {onReview && caps.tmux && (
        <ReviewControl review={work.review} onReview={() => onReview(work.path)}
          controls={reviewer ? <SessionControls session={reviewer} approvals={mine(approvals, reviewer.sessionId)} /> : null} />
      )}
      <div className="flex flex-wrap justify-end gap-1 ml-auto shrink-0">
        {session ? (
          <SessionControls session={session} approvals={mine(approvals, session.sessionId)}
            end={markAs ? <MarkAsMenu session={session} failedCheck={markAs.failedCheck} onClose={markAs.close} /> : undefined} />
        ) : <OpenMenu path={work.path} sessions={work.recent} caps={caps} />}
      </div>
    </div>
  );
}
