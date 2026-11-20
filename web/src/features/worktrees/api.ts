import { useQuery } from '@tanstack/react-query';
import { NAV_KEY } from '../../components/nav-api';
import { ApiError } from '../../lib/api';
import { queryClient } from '../../lib/query';
import type { StateData } from './types';

/*
 * The whole board, polled often: the server answers 304 when nothing changed
 * since the version the page has (its ETag), and then the page keeps the same
 * data, with only when it was checked moved on, so nothing is drawn again.
 */

export const STATE_KEY = ['state'] as const;
const POLL_MS = 5_000;

// The version of the board the page has; a failed poll forgets it, so the next one gets everything.
let etag: string | null = null;

async function fetchState(force: boolean, signal?: AbortSignal): Promise<StateData> {
  const current = queryClient.getQueryData<StateData>(STATE_KEY);
  // Refresh always gets everything, and draws it, so it visibly did something.
  const ask: Record<string, string> = current && etag && !force ? { 'If-None-Match': etag } : {};
  try {
    const res = await fetch(`/api/state${force ? '?refresh=1' : ''}`, { cache: 'no-store', headers: ask, signal });
    if (res.status === 304 && current) {
      const built = Number(res.headers.get('X-Generated-At'));
      return { ...current, generatedAt: Number.isFinite(built) && built > 0 ? built : Date.now() };
    }
    const body = (await res.json()) as { success: boolean; data?: StateData; error?: string };
    if (!body.success || !body.data) throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status);
    etag = res.headers.get('ETag');
    if (body.data.nav) queryClient.setQueryData(NAV_KEY, body.data.nav);
    return body.data;
  } catch (error) {
    etag = null;
    throw error;
  }
}

export const useBoard = () => useQuery({ queryKey: STATE_KEY, queryFn: ({ signal }) => fetchState(false, signal), refetchInterval: POLL_MS });

export const refreshBoard = (): Promise<unknown> =>
  queryClient.fetchQuery({ queryKey: STATE_KEY, queryFn: () => fetchState(true), staleTime: 0 });
