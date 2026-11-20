import { useEffect } from 'react';
import { useNow } from '../../lib/time';
import { settlePending } from '../../lib/shared';
import type { AgentsData, Approval, LiveSession } from '../../lib/types';
import { usePendingStore } from '../../stores/pending';
import { toast } from '../../stores/toast';
import { ShowSessionsButton } from './controls/session';
import { FILTER_KEYS, FILTERS, liveGroups, liveMatches, locateSession, pendingShown } from './filters';
import { LiveRow } from './LiveRow';
import { PendingRow } from './PendingRow';
import { useAgentsUi } from './store';

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

function SessionList({ sessions, data, className = 'list' }: { sessions: LiveSession[]; data: AgentsData; className?: string }) {
  const approvals = approvalsBySession(data.approvals ?? []);
  return (
    <ul className={className}>
      {sessions.map((session) => {
        const where = locateSession(data.repos, session);
        return (
          <LiveRow key={session.sessionId} session={session} repoName={where?.repo.name ?? null} worktree={where?.worktree ?? null}
            approvals={approvals.get(session.sessionId) ?? NO_APPROVALS} />
        );
      })}
    </ul>
  );
}

/** Shown when a session needs you but its prompts can't be answered here yet. */
function HookHint() {
  return (
    <p className="hint">
      {'To allow or deny permission prompts from this page, run '}<code>npm run hook -- install</code>{' in the switchyard folder.'}
    </p>
  );
}

function ViewFilter() {
  const filter = useAgentsUi((s) => s.filter);
  const setFilter = useAgentsUi((s) => s.setFilter);
  return (
    <div className="segmented" role="radiogroup" aria-label="Show" id="views">
      {FILTER_KEYS.map((key) => (
        <button key={key} type="button" role="radio" aria-checked={filter === key} onClick={() => setFilter(key)}>{FILTERS[key].label}</button>
      ))}
    </div>
  );
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
  const sessions = live ? data.liveSessions.filter((s) => live(s) && liveMatches(data, s, query)) : [];
  const starting = pendingShown(pendingTasks, filter, query);
  const { active, parked } = liveGroups(sessions);
  // The Parked filter always shows them all, so there's nothing to toggle there.
  const parkedShown = showParked || filter === 'parked' || active.length === 0;
  const empty = query || filter !== 'all' ? 'No running sessions match.' : 'No agent sessions are running.';
  return (
    <section className="panel" aria-labelledby="running-title" hidden={!live}>
      <div className="panel-head">
        <h2 id="running-title">Running</h2>
        <span id="show-sessions" className="panel-action"><ShowSessionsButton caps={data.capabilities} /></span>
        <div className="filters">
          <input id="search" type="search" placeholder="Filter name, repo, branch, text…" aria-label="Filter sessions"
            defaultValue={query} onChange={(event) => setQuery(event.target.value.trim())} />
          <ViewFilter />
        </div>
      </div>
      <div id="running">
        {data.capabilities.approvalsHook === false && sessions.some((s) => s.needsYou) && <HookHint />}
        {starting.length > 0 && (
          <ul className="list pending-list">{starting.map((task) => <PendingRow key={task.id} task={task} now={now} />)}</ul>
        )}
        {sessions.length === 0 && starting.length === 0 && <div className="empty">{empty}</div>}
        {active.length > 0 && <SessionList sessions={active} data={data} />}
        {parked.length > 0 && active.length > 0 && filter !== 'parked' && (
          <button type="button" className="list-toggle" onClick={toggleParked}>
            {showParked ? 'Hide parked sessions' : `Show ${parked.length} parked session${parked.length > 1 ? 's' : ''} (idle over a day, no open tab)`}
          </button>
        )}
        {parked.length > 0 && parkedShown && <SessionList sessions={parked} data={data} />}
      </div>
    </section>
  );
}
