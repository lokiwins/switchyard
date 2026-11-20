import { useSyncExternalStore } from 'react';

const subscribe = (listener: () => void) => {
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
};

/** Whether the page's tab is showing. */
export const usePageVisible = (): boolean => useSyncExternalStore(subscribe, () => !document.hidden, () => true);
