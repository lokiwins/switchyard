import { Panel } from '../../components/Panel';
import type { AgentsData } from '../../lib/types';
import { DeleteAllButton } from './controls/delete';
import { EndedRow } from './EndedRow';
import { endedMatches, endedShown, FILTERS } from './filters';
import { useAgentsUi } from './store';

export function EndedPanel({ data, query }: { data: AgentsData; query: string }) {
  const filter = useAgentsUi((s) => s.filter);
  const expanded = useAgentsUi((s) => s.showAllEnded);
  const toggle = useAgentsUi((s) => s.toggleAllEnded);
  const { ended } = FILTERS[filter];
  const sessions = ended ? data.endedSessions.filter((s) => ended(s) && endedMatches(s, query)) : [];
  const interrupted = sessions.filter((s) => s.needsAttention).length;
  // Every listed one, shown or collapsed: all of them, or just what the filter and search picked.
  const everything = !query && (filter === 'all' || filter === 'ended');
  const { shown, more } = endedShown(sessions, { expanded, collapse: filter === 'all' && !query });
  return (
    <Panel id="ended-title" panelId="ended-panel" title="Recently ended" hidden={!ended} head={(
      <>
        <span id="ended-count" className="muted">
          {`${sessions.length} in the last ${data.endedHistoryDays} days`}
          {interrupted > 0 && <>{' · '}<span className="pill amber">{`${interrupted} interrupted`}</span></>}
        </span>
        <span id="ended-actions">
          {sessions.length > 0 && <DeleteAllButton sessions={sessions} label={everything ? 'Delete all ended' : `Delete these ${sessions.length}`} />}
        </span>
      </>
    )}>
      <div id="ended">
        {sessions.length === 0 ? <div className="empty">No ended sessions match.</div> : (
          <ul className="list">{shown.map((s) => <EndedRow key={s.sessionId} session={s} caps={data.capabilities} />)}</ul>
        )}
        {more > 0 && (
          <button type="button" className="list-toggle" onClick={toggle}>{expanded ? 'Show fewer' : `Show ${more} more`}</button>
        )}
      </div>
    </Panel>
  );
}
