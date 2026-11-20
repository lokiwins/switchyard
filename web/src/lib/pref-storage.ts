import type { StateStorage } from 'zustand/middleware';
import { readPref, writePref } from './prefs';

/*
 * Storage for a Zustand store that keeps each saved field under its own key,
 * as the pages always have (switchyard.agentFilter = "waiting",
 * switchyard.collapsed = ["/code/shop"]), so a choice made before a page
 * moved to React is still there after.
 */

export interface PrefField<T> { key: string; read: (raw: string) => T | undefined; write: (value: T) => string }

/** A field saved as a bare string, kept only while `isValid` says it's still one of the choices. */
export const bareField = <T extends string>(key: string, isValid: (value: string) => value is T): PrefField<T> => ({
  key, read: (raw) => (isValid(raw) ? raw : undefined), write: (value) => value,
});

/** A list of strings saved as JSON. */
export const stringListField = (key: string): PrefField<string[]> => ({
  key,
  read: (raw) => {
    try {
      const value: unknown = JSON.parse(raw);
      return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : undefined;
    } catch {
      return undefined;
    }
  },
  write: (value) => JSON.stringify(value),
});

export function prefFieldsStorage<T extends Record<string, unknown>>(fields: { [K in keyof T]: PrefField<T[K]> }): StateStorage {
  const entries = Object.entries(fields) as [string, PrefField<unknown>][];
  return {
    getItem: () => {
      const state: Record<string, unknown> = {};
      for (const [name, field] of entries) {
        const raw = readPref(field.key);
        const value = raw === null ? undefined : field.read(raw);
        if (value !== undefined) state[name] = value;
      }
      return JSON.stringify({ state, version: 0 });
    },
    setItem: (_name, value) => {
      const { state } = JSON.parse(value) as { state: Record<string, unknown> };
      for (const [name, field] of entries) if (name in state) writePref(field.key, field.write(state[name]));
    },
    removeItem: () => entries.forEach(([, field]) => writePref(field.key, '')),
  };
}
