import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { queryClient } from '../../lib/query';
import { useEventStream } from '../../lib/stream';
import { usePageVisible } from '../../lib/visibility';
import type { SessionGraph } from './model';

/*
 * A session's graph, pushed live (/api/agents/graph/stream). A hidden tab
 * gives up the stream, so a busy session isn't re-sent to it every second; it
 * catches up on return. When the server refuses the stream, the page asks why.
 */

const graphKey = (sessionId: string) => ['graph', sessionId] as const;

async function whyClosed(sessionId: string): Promise<string> {
  try {
    const body = (await (await fetch(`/api/agents/graph?session=${encodeURIComponent(sessionId)}`)).json()) as { success: boolean; error?: string };
    return body.success ? 'Lost the live connection; reload to try again.' : body.error ?? 'The graph is unavailable';
  } catch (error) {
    return `Can't reach switchyard: ${(error as Error).message}`;
  }
}

export function useSessionGraph(sessionId: string) {
  const visible = usePageVisible();
  const [error, setError] = useState<string | null>(sessionId ? null : 'No session given: open a graph from a session\'s Graph button on the Agents page.');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const live = useEventStream(sessionId ? `/api/agents/graph/stream?session=${encodeURIComponent(sessionId)}` : null, {
    graph: (data) => {
      setError(null);
      setUpdatedAt(Date.now());
      queryClient.setQueryData(graphKey(sessionId), data as SessionGraph);
    },
  }, { onClosed: () => void whyClosed(sessionId).then(setError) });
  const { data } = useQuery<SessionGraph>({ queryKey: graphKey(sessionId), enabled: false });
  return { graph: data, error, live, visible, updatedAt };
}
