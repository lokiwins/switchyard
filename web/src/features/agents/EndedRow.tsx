import { shortPath } from '../../lib/paths';
import { sessionDetail, sessionTitle } from '../../lib/session-text';
import type { Capabilities, EndedSession } from '../../lib/types';
import { DeleteMenu } from './controls/delete';
import { EditorLink } from '../../components/EditorLink';
import { ResumeButton } from '../../components/ResumeButton';
import { endStateOf } from '../../lib/end-states';
import { TaskFromWork } from '../panes/TaskFromWork';
import { GraphLink } from './controls/session';
import { SessionRow, StatusBadge, TrackerLink, WhereLabel } from './Row';
import { useAgentsUi } from './store';

export function EndedRow({ session, caps }: { session: EndedSession; caps: Capabilities }) {
  const detailOpen = useAgentsUi((s) => Boolean(s.openDetails[session.sessionId]));
  const toggleDetail = useAgentsUi((s) => s.toggleDetail);
  const state = endStateOf(session);
  const t = session.transcript;
  return (
    <SessionRow
      // Only recent interruptions are highlighted; older ones are history.
      tone={session.needsAttention ? 'interrupted' : null}
      badge={<StatusBadge tone={state.tone} label={state.label} hint={state.hint} />}
      title={sessionTitle(session)}
      titleHint={[t.title, t.agentName, session.cwd].filter(Boolean).join(' · ')}
      where={<WhereLabel repoName={session.repoName} branch={session.branch} path={shortPath(session.cwd)} />}
      detail={sessionDetail(session)}
      detailOpen={detailOpen}
      onDetailToggle={() => toggleDetail(session.sessionId)}
      since={session.endedAt}
      timeHint={`Ended ${new Date(session.endedAt).toLocaleString()}`}
      actions={(
        <>
          <TrackerLink task={session.task} />
          {session.prUrl && <a href={session.prUrl} target="_blank" rel="noopener" className="text-xs leading-xs">{`#${session.prNumber}`}</a>}
          <ResumeButton session={session} caps={caps} />
          <EditorLink path={session.cwd} caps={caps} />
          {/* Only a session in a worktree switchyard knows can be linked to a task. */}
          {session.worktreePath && <TaskFromWork from={{ sessionId: session.sessionId }} hubTask={session.hubTask} />}
          <GraphLink sessionId={session.sessionId} />
          <DeleteMenu session={session} />
        </>
      )}
    />
  );
}
