import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { NAV_KEY } from '../../components/nav-api';
import { getJson } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { useEventStream } from '../../lib/stream';
import type { PrsData } from './types';

/*
 * The PRs page's data. The server keeps the PRs fresh on its own schedule and
 * pushes each new set (/api/prs/stream); the page polls only while that's down.
 * Closing the stream while the tab is hidden lets the server stop asking GitHub.
 */

export const PRS_KEY = ['prs'] as const;
const FALLBACK_POLL_MS = 60_000;

function receive(data: PrsData): PrsData {
  if (data.nav) queryClient.setQueryData(NAV_KEY, data.nav);
  return data;
}

const fetchPrs = async (force: boolean, signal?: AbortSignal) => receive(await getJson<PrsData>(`/api/prs${force ? '?refresh=1' : ''}`, signal));

/** The PRs, live while the stream is up; `streamError` is the server's last failure to refresh, as it sent it. */
export function usePrs() {
  const [streamError, setStreamError] = useState<string | null>(null);
  const live = useEventStream('/api/prs/stream', {
    prs: (data) => {
      setStreamError(null);
      queryClient.setQueryData(PRS_KEY, receive(data as PrsData));
    },
    failure: (data) => setStreamError((data as { error: string }).error),
  });
  const query = useQuery({
    queryKey: PRS_KEY,
    queryFn: ({ signal }) => fetchPrs(false, signal),
    refetchInterval: live ? false : FALLBACK_POLL_MS,
    refetchOnWindowFocus: false,
  });
  return { ...query, live, streamError };
}

export const refreshPrs = (): Promise<unknown> =>
  queryClient.fetchQuery({ queryKey: PRS_KEY, queryFn: () => fetchPrs(true), staleTime: 0 });
