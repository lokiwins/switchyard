import { useEffect } from 'react';
import { Panel } from '../../components/Panel';
import { SearchBox } from '../../components/SearchBox';
import { Segmented } from '../../components/Segmented';
import { useNow } from '../../lib/time';
import { settlePending } from '../../lib/shared';
import type { AgentsData, Approval, EndedSession, LiveSession } from '../../lib/types';
import { usePendingStore } from '../../stores/pending';
import { toast } from '../../stores/toast';
import { ShowSessionsButton } from './controls/session';
import { EndedRow } from './EndedRow';
import { endedWorkers, FILTER_KEYS, FILTERS, locateSession, nestWorkers, pendingShown, runningShown } from './filters';
import { LiveRow } from './LiveRow';
import { PendingRow } from './PendingRow';
import { useAgentsUi } from './store';
import { Empty } from '../../components/Empty';
import { filtersClass, listToggleClass, stackedListClass } from '../../components/classes';

const NO_APPROVALS: Approval[] = [];

/** Waiting prompts by session: one map per set of approvals, so a session's list stays the same array while unchanged. */
function approvalsBySession(approvals: Approval[]): Map<string, Approval[]> {
  const bySession = new Map<string, Approval[]>();
  for (const approval of approvals) bySession.set(approval.sessionId, [...(bySession.get(approval.sessionId) ?? []), approval]);
  return bySession;
}

/** Drop started tasks whose session is here now, and give up on ones that never came (checked as data comes and as the clock ticks). */
function useSettlePending(data: AgentsData, now: number) {
  useEffect(() => {
    const { tasks, replace } = usePendingStore.getState();
    if (tasks.length === 0) return;
    const { pending, expired } = settlePending(tasks, data.liveSessions, now, data.taskStarts ?? []);
    replace(pending);
    expired.forEach((t) => toast(`Claude hasn't shown up from tmux window ${t.place} yet. Look there.`));
  }, [data, now]);
}

// A lead's workers, set in under its row with a rule down the side, as a task's subtasks are on the Tasks page.
const WORKERS_LIST = 'col-span-full mt-2 mb-0 ml-6 pl-3 list-none border-l-2 border-gray-200';

const NO_ENDED: EndedSession[] = [];

/**
 * The running sessions, each lead's workers listed under it (see nestWorkers): the running ones, then the
 * ones that have ended (see endedWorkers), which Recently ended leaves out.
 */
function SessionList({ sessions, ended, data, className = stackedListClass }: {
  sessions: LiveSession[]; ended: Map<string, EndedSession[]>; data: AgentsData; className?: string;
}) {
  const approvals = approvalsBySession(data.approvals ?? []);
  const row = (session: LiveSession, workers?: LiveSession[], endedWorkers: EndedSession[] = NO_ENDED) => {
    const where = locateSession(data.repos, session);
    const any = (workers?.length ?? 0) + endedWorkers.length > 0;
    return (
      <LiveRow key={session.sessionId} session={session} repoName={where?.repo.name ?? null} worktree={where?.worktree ?? null}
        approvals={approvals.get(session.sessionId) ?? NO_APPROVALS}
        workers={any && (
          <ul className={WORKERS_LIST} aria-label={`Workers of ${session.hubTask?.title ?? 'this session'}`}>
            {workers?.map((worker) => row(worker))}
            {endedWorkers.map((worker) => <EndedRow key={worker.sessionId} session={worker} caps={data.capabilities} />)}
          </ul>
        )} />
    );
  };
  return (
    <ul className={className}>
      {nestWorkers(sessions).map(({ session, workers }) => row(session, workers, (session.hubTask && ended.get(session.hubTask.id)) || NO_ENDED))}
    </ul>
  );
}

/** Shown when a session needs you but its prompts can't be answered here yet. */
function HookHint() {
  return (
    <p className="m-0 py-1.5 px-3 text-xs text-gray-700 bg-amber-soft border-b border-divider">
      {'To allow or deny permission prompts from this page, run '}<code className="text-2xs">npm run hook -- install</code>{' in the switchyard folder.'}
    </p>
  );
}

const CHOICES = FILTER_KEYS.map((key) => ({ key, label: FILTERS[key].label }));

function ViewFilter() {
  const filter = useAgentsUi((s) => s.filter);
  const setFilter = useAgentsUi((s) => s.setFilter);
  return <Segmented choices={CHOICES} value={filter} onChange={setFilter} label="Show" />;
}

export function RunningPanel({ data, query }: { data: AgentsData; query: string }) {
  const filter = useAgentsUi((s) => s.filter);
  const setQuery = useAgentsUi((s) => s.setQuery);
  const showParked = useAgentsUi((s) => s.showParked);
  const toggleParked = useAgentsUi((s) => s.toggleParked);
  const pendingTasks = usePendingStore((s) => s.tasks);
  const now = useNow();
  useSettlePending(data, now);
  const { live } = FILTERS[filter];
  const { sessions, active, parked, parkedShown, shown } = runningShown(data, filter, query, showParked);
  const ended = endedWorkers(shown, data.endedSessions);
  const starting = pendingShown(pendingTasks, filter, query);
  const empty = query || filter !== 'all' ? 'No running sessions match.' : 'No agent sessions are running.';
  return (
    <Panel id="running-title" title="Running" hidden={!live} head={(
      <>
        <span id="show-sessions" className="mr-auto"><ShowSessionsButton caps={data.capabilities} /></span>
        <div className={filtersClass}>
          <SearchBox placeholder="Filter name, repo, branch, text…" label="Filter sessions" value={query} onChange={setQuery} />
          <ViewFilter />
        </div>
      </>
    )}>
      <div id="running">
        {data.capabilities.approvalsHook === false && sessions.some((s) => s.needsYou) && <HookHint />}
        {starting.length > 0 && (
          <ul className={stackedListClass}>{starting.map((task) => <PendingRow key={task.id} task={task} now={now} />)}</ul>
        )}
        {sessions.length === 0 && starting.length === 0 && <Empty>{empty}</Empty>}
        {active.length > 0 && <SessionList sessions={active} ended={ended} data={data} />}
        {parked.length > 0 && active.length > 0 && filter !== 'parked' && (
          <button type="button" className={listToggleClass} onClick={toggleParked}>
            {showParked ? 'Hide parked sessions' : `Show ${parked.length} parked session${parked.length > 1 ? 's' : ''} (idle over a day, no open tab)`}
          </button>
        )}
        {parked.length > 0 && parkedShown && <SessionList sessions={parked} ended={ended} data={data} />}
      </div>
    </Panel>
  );
}
