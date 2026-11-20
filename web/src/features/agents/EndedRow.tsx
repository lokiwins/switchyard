import { CopyButton } from '../../components/CopyButton';
import { shortPath } from '../../lib/paths';
import { sessionDetail, sessionTitle } from '../../lib/shared';
import type { Capabilities, EndedSession } from '../../lib/types';
import { DeleteMenu } from './controls/delete';
import { EditorLink } from '../../components/EditorLink';
import { canResume, GraphLink, ResumeButton, TaskFromWork } from './controls/session';
import { SessionRow, StatusBadge, TrackerLink, WhereLabel } from './Row';
import { useAgentsUi } from './store';

export const END_STATES: Record<string, { label: string; tone: string; hint: string }> = {
  interrupted: { label: 'Interrupted', tone: 'amber', hint: 'The terminal closed while the agent was mid-turn' },
  stopped: { label: 'Stopped', tone: '', hint: 'You pressed Esc to interrupt the agent' },
  exited: { label: 'Exited', tone: '', hint: 'You ran /exit' },
  finished: { label: 'Finished', tone: '', hint: 'The agent completed its last turn' },
  unknown: { label: 'Ended', tone: '', hint: 'Could not tell how the last turn ended' },
};

const endStateOf = (session: EndedSession) => END_STATES[session.endState ?? ''] ?? END_STATES.unknown!;

export function EndedRow({ session, caps }: { session: EndedSession; caps: Capabilities }) {
  const detailOpen = useAgentsUi((s) => Boolean(s.openDetails[session.sessionId]));
  const toggleDetail = useAgentsUi((s) => s.toggleDetail);
  const state = endStateOf(session);
  const t = session.transcript;
  return (
    <SessionRow
      // Only recent interruptions are highlighted; older ones are history.
      className={session.needsAttention ? 'is-interrupted' : null}
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
          {session.prUrl && <a href={session.prUrl} target="_blank" rel="noopener" className="small">{`#${session.prNumber}`}</a>}
          {canResume(caps) ? <ResumeButton session={session} caps={caps} /> : <CopyButton label="resume" text={session.resumeCommand} />}
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
