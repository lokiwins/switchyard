import type { StateStorage } from 'zustand/middleware';
import { readPref, writePref } from './prefs';

/*
 * Storage for a Zustand store that keeps one field as a bare string under
 * `key`, as the pages always have (switchyard.agentFilter = "waiting"), so a
 * choice made before a page moved to React is still there after.
 */
export function bareFieldStorage(key: string, field: string, isValid: (value: string) => boolean): StateStorage {
  return {
    getItem: () => {
      const saved = readPref(key);
      return saved !== null && isValid(saved) ? JSON.stringify({ state: { [field]: saved }, version: 0 }) : null;
    },
    setItem: (_name, value) => writePref(key, String((JSON.parse(value) as { state: Record<string, unknown> }).state[field] ?? '')),
    removeItem: () => writePref(key, ''),
  };
}
