import { useQuery } from '@tanstack/react-query';
import { getJson } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { useEventStream } from '../../lib/stream';
import { NAV_KEY } from '../../components/nav-api';
import type { AgentsData } from '../../lib/types';

/*
 * The Agents page's data. Changes are pushed as they happen (/api/agents/stream)
 * into the same cache the polls fill. Without the stream the page polls often;
 * with it, only now and then, in case one was missed. A hidden tab does neither.
 */

export const AGENTS_KEY = ['agents'] as const;
const POLL_MS = 4_000;
const STREAM_POLL_MS = 15_000;

/** The newer of two snapshots: a poll answered from before a pushed update mustn't undo it. */
const newer = (old: AgentsData | undefined, next: AgentsData): AgentsData =>
  (old && next.generatedAt < old.generatedAt ? old : next);

/** A snapshot arrived (a poll or a push): keep it if it's newer, and give the header its badge counts. */
function receive(data: AgentsData): AgentsData {
  const kept = newer(queryClient.getQueryData<AgentsData>(AGENTS_KEY), data);
  if (kept === data && data.nav) queryClient.setQueryData(NAV_KEY, data.nav);
  return kept;
}

const fetchAgents = async (force: boolean, signal?: AbortSignal) =>
  receive(await getJson<AgentsData>(`/api/agents${force ? '?refresh=1' : ''}`, signal));

export function useAgents(streaming: boolean) {
  return useQuery({
    queryKey: AGENTS_KEY,
    queryFn: ({ signal }) => fetchAgents(false, signal),
    refetchInterval: streaming ? STREAM_POLL_MS : POLL_MS,
  });
}

/** Look again now; `force` skips the server's caches (Refresh, or right after starting a task). */
export function refreshAgents({ force = false } = {}): Promise<unknown> {
  if (!force) return queryClient.invalidateQueries({ queryKey: AGENTS_KEY });
  return queryClient.fetchQuery({ queryKey: AGENTS_KEY, queryFn: () => fetchAgents(true), staleTime: 0 });
}

/** The pushed updates, while the tab shows. True while connected. */
export const useAgentStream = (): boolean => useEventStream('/api/agents/stream', {
  agents: (data) => queryClient.setQueryData(AGENTS_KEY, receive(data as AgentsData)),
});
