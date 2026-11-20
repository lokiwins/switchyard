import { useIsFetching } from '@tanstack/react-query';
import { useDeferredValue } from 'react';
import { Errors, pageErrors } from '../../components/Errors';
import { RefreshButton } from '../../components/RefreshButton';
import { TopBar } from '../../components/TopBar';
import { timeAgo, useNow } from '../../lib/time';
import { AGENTS_KEY, refreshAgents, useAgents, useAgentStream } from './api';
import { EndedPanel } from './EndedPanel';
import { NewTaskMenu } from './NewTaskMenu';
import { RunningPanel } from './RunningPanel';
import { useAgentsUi } from './store';
import { AgentTiles } from './AgentTiles';

/* The Agents page: running sessions (and tasks starting), then recently ended ones. */

function Updated({ at }: { at: number | undefined }) {
  const now = useNow();
  return <span id="updated" className="muted" aria-live="polite">{at ? `Updated ${timeAgo(at, now)}` : 'Loading…'}</span>;
}

export function AgentsPage() {
  const streaming = useAgentStream();
  const { data, error } = useAgents(streaming);
  const fetching = useIsFetching({ queryKey: AGENTS_KEY }) > 0;
  // Typing in the search box stays quick; the lists catch up just after.
  const query = useDeferredValue(useAgentsUi((s) => s.query));
  const errors = pageErrors(data?.errors, error, 'sessions');
  return (
    <>
      <TopBar current="/">
        <span id="new-task">{data && <NewTaskMenu data={data} />}</span>
        <Updated at={data?.generatedAt} />
        <RefreshButton busy={fetching} onRefresh={() => refreshAgents({ force: true })} />
      </TopBar>
      <main>
        <Errors errors={errors} />
        {data ? (
          <>
            <AgentTiles data={data} />
            <RunningPanel data={data} query={query} />
            <EndedPanel data={data} query={query} />
          </>
        ) : (
          <section className="panel"><div className="empty">Looking for agent sessions…</div></section>
        )}
      </main>
    </>
  );
}
