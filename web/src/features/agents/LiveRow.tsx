import { CopyButton } from '../../components/CopyButton';
import { shellQuote, shortPath, tmuxPlace } from '../../lib/paths';
import { answerElsewhere, sessionDetail, sessionDot, sessionLabel, sessionTitle } from '../../lib/shared';
import type { ReactNode } from 'react';
import type { Approval, LiveSession, Worktree } from '../../lib/types';
import { TerminalButton } from '../terminal/TerminalButton';
import { AnswerMenu, PlanButton } from './controls/answer';
import { ApprovalButtons, approvalDetail } from './controls/approvals';
import { ReplyMenu } from './controls/reply';
import { TaskFromWork } from '../panes/TaskFromWork';
import { EndMenu, GraphLink, JumpButton, StopButton } from './controls/session';
import { SessionRow, StatusBadge, TrackerLink, WhereLabel } from './Row';
import { useAgentsUi } from './store';

function tone(session: LiveSession) {
  if (session.status === 'busy') return 'green';
  return session.status === 'idle' && !session.parked ? 'amber' : '';
}

/**
 * A running session's row. Its props are the parts of the page's data it
 * shows, each kept the same object while unchanged, so an update that
 * doesn't touch this session doesn't draw it again.
 */
export function LiveRow({ session, repoName, worktree, approvals, workers = null }: {
  session: LiveSession;
  repoName: string | null;
  worktree: Worktree | null;
  approvals: Approval[];
  /** The rows of the sessions working on this one's subtasks (a lead's workers), to show under it. */
  workers?: ReactNode;
}) {
  const detailOpen = useAgentsUi((s) => Boolean(s.openDetails[session.sessionId]));
  const toggleDetail = useAgentsUi((s) => s.toggleDetail);
  const host = session.host;
  const pr = worktree?.pr;
  return (
    <SessionRow
      className={session.parked ? 'is-parked' : null}
      badge={<StatusBadge tone={tone(session)} dot={sessionDot(session)} label={sessionLabel(session)} />}
      title={sessionTitle(session)}
      titleHint={[session.cwd, host && `running in ${host.kind === 'tmux' ? `tmux window ${tmuxPlace(host)}` : host.label}`].filter(Boolean).join(' · ')}
      where={<WhereLabel repoName={repoName} branch={worktree?.branch ?? session.transcript?.gitBranch} path={shortPath(session.cwd)} />}
      detail={approvals.length > 0 ? approvalDetail(approvals) : sessionDetail(session)}
      note={answerElsewhere(session, approvals)}
      alertsFor={session}
      detailOpen={detailOpen}
      onDetailToggle={() => toggleDetail(session.sessionId)}
      since={session.statusUpdatedAt}
      timeHint={`${sessionLabel(session)} since ${new Date(session.statusUpdatedAt).toLocaleString()}`}
      nested={workers}
      actions={(
        <>
          <ApprovalButtons approvals={approvals} session={session} />
          <PlanButton session={session} approvals={approvals} />
          <AnswerMenu session={session} approvals={approvals} />
          <ReplyMenu session={session} />
          <StopButton session={session} />
          <TrackerLink task={worktree?.task} />
          {pr && <a href={pr.url} target="_blank" rel="noopener" className="small">{`#${pr.number}`}</a>}
          <TerminalButton session={session} />
          <JumpButton session={session} />
          <TaskFromWork from={{ sessionId: session.sessionId }} hubTask={session.hubTask} />
          <GraphLink sessionId={session.sessionId} />
          <EndMenu session={session} />
          <CopyButton label="cd" text={`cd ${shellQuote(session.cwd)}`} />
        </>
      )}
    />
  );
}
