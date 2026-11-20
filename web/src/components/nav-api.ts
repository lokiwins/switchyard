import { useQuery } from '@tanstack/react-query';
import { getJson } from '../lib/api';
import type { Nav } from '../lib/types';

/* The header's per-page badge counts. Each page's own data brings fresh ones; this slower poll catches up the rest. */

export const NAV_KEY = ['nav'] as const;
const NAV_POLL_MS = 60_000;

export const useNav = () => useQuery({
  queryKey: NAV_KEY,
  queryFn: ({ signal }) => getJson<Nav>('/api/nav', signal),
  refetchInterval: NAV_POLL_MS,
});
