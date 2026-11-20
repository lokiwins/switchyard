import { useSyncExternalStore } from 'react';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// How often "5m ago" times and alerts that start at a time are brought up to date.
export const CLOCK_MS = 5_000;

export function timeAgo(timestamp: number | null | undefined, now = Date.now()): string {
  if (!timestamp) return '—';
  const diff = Math.max(0, now - timestamp);
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  return `${Math.floor(diff / DAY)}d ago`;
}

/*
 * One clock for the page: components that show a time read it, so only they
 * draw again as it ticks, not the lists they're in.
 */
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  timer ??= setInterval(() => {
    now = Date.now();
    listeners.forEach((l) => l());
  }, CLOCK_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** The time, as of the clock's last tick. */
export const useNow = (): number => useSyncExternalStore(subscribe, () => now, () => now);

/** Whether a time-based alert's moment has come; it's shown only from `showAt` on. */
export const isDue = (showAt: number | null | undefined, at: number): boolean => Boolean(showAt) && at >= Number(showAt);
