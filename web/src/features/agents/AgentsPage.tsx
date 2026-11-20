import { useIsFetching } from '@tanstack/react-query';
import { useDeferredValue } from 'react';
import { TopBar } from '../../components/TopBar';
import { timeAgo, useNow } from '../../lib/time';
import { AGENTS_KEY, refreshAgents, useAgents, useAgentStream } from './api';
import { EndedPanel } from './EndedPanel';
import { NewTaskMenu } from './NewTaskMenu';
import { RunningPanel } from './RunningPanel';
import { useAgentsUi } from './store';
import { Tiles } from './Tiles';

/* The Agents page: running sessions (and tasks starting), then recently ended ones. */

function Updated({ at }: { at: number | undefined }) {
  const now = useNow();
  return <span id="updated" className="muted" aria-live="polite">{at ? `Updated ${timeAgo(at, now)}` : 'Loading…'}</span>;
}

function Errors({ errors }: { errors: { source: string; message: string }[] }) {
  return (
    <div id="errors" className="errors" hidden={errors.length === 0}>
      {errors.map((e, i) => <div key={i}>{`${e.source}: ${e.message}`}</div>)}
    </div>
  );
}

export function AgentsPage() {
  const streaming = useAgentStream();
  const { data, error } = useAgents(streaming);
  const fetching = useIsFetching({ queryKey: AGENTS_KEY }) > 0;
  // Typing in the search box stays quick; the lists catch up just after.
  const query = useDeferredValue(useAgentsUi((s) => s.query));
  const errors = [
    ...(data?.errors ?? []),
    ...(error ? [{ source: 'monitor', message: `Could not load sessions: ${error.message}` }] : []),
  ];
  return (
    <>
      <TopBar current="/">
        <span id="new-task">{data && <NewTaskMenu data={data} />}</span>
        <Updated at={data?.generatedAt} />
        <button id="refresh" type="button" className="btn" disabled={fetching} onClick={() => void refreshAgents({ force: true }).catch(() => {})}>
          Refresh
        </button>
      </TopBar>
      <main>
        <Errors errors={errors} />
        {data ? (
          <>
            <Tiles data={data} />
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
