import { QueryClient } from '@tanstack/react-query';

/*
 * Server data lives in TanStack Query's cache (UI state lives in Zustand
 * stores). Each answer is shared structurally with the last one, so a session
 * whose data didn't change keeps the same object and its row isn't drawn again.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      refetchIntervalInBackground: false,
      retry: 1,
    },
  },
});
