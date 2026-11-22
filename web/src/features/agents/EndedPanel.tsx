import { Panel } from '../../components/Panel';
import type { AgentsData } from '../../lib/types';
import { DeleteAllButton } from './controls/delete';
import { EndedRow } from './EndedRow';
import { endedMatches, endedShown, endedWorkers, FILTERS, runningShown } from './filters';
import { useAgentsUi } from './store';
import { Pill } from '../../components/Pill';
import { Empty } from '../../components/Empty';

export function EndedPanel({ data, query }: { data: AgentsData; query: string }) {
  const filter = useAgentsUi((s) => s.filter);
  const expanded = useAgentsUi((s) => s.showAllEnded);
  const toggle = useAgentsUi((s) => s.toggleAllEnded);
  const showParked = useAgentsUi((s) => s.showParked);
  const { ended } = FILTERS[filter];
  // A worker listed under its lead in Running isn't listed again here.
  const underLeads = new Set([...endedWorkers(runningShown(data, filter, query, showParked).shown, data.endedSessions).values()].flat());
  const sessions = ended ? data.endedSessions.filter((s) => ended(s) && endedMatches(s, query) && !underLeads.has(s)) : [];
  const interrupted = sessions.filter((s) => s.needsAttention).length;
  // Every listed one, shown or collapsed: all of them, or just what the filter and search picked.
  const everything = !query && (filter === 'all' || filter === 'ended');
  const { shown, more } = endedShown(sessions, { expanded, collapse: filter === 'all' && !query });
  return (
    <Panel id="ended-title" panelId="ended-panel" title="Recently ended" hidden={!ended} head={(
      <>
        <span id="ended-count" className="ml-auto text-xs text-gray-500">
          {`${sessions.length} in the last ${data.endedHistoryDays} days`}
          {interrupted > 0 && <>{' · '}<Pill tone="amber">{`${interrupted} interrupted`}</Pill></>}
        </span>
        <span id="ended-actions">
          {sessions.length > 0 && <DeleteAllButton sessions={sessions} label={everything ? 'Delete all ended' : `Delete these ${sessions.length}`} />}
        </span>
      </>
    )}>
      <div id="ended">
        {sessions.length === 0 ? <Empty>No ended sessions match.</Empty> : (
          <ul className="list">{shown.map((s) => <EndedRow key={s.sessionId} session={s} caps={data.capabilities} />)}</ul>
        )}
        {more > 0 && (
          <button type="button" className="list-toggle" onClick={toggle}>{expanded ? 'Show fewer' : `Show ${more} more`}</button>
        )}
      </div>
    </Panel>
  );
}
