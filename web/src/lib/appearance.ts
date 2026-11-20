import { useSyncExternalStore } from 'react';

/*
 * This browser's theme, light/dark mode and terminal colours: public/theme-boot.js
 * keeps the choice and applies it (before anything is drawn), and says so with
 * a switchyard:theme event.
 */

export type AppearanceKey = 'theme' | 'mode' | 'terminal';
export interface Appearance {
  theme: string;
  mode: string;
  terminal: string;
  own: Partial<Record<AppearanceKey, string>>;
  defaults: Record<AppearanceKey, string>;
}
interface AppearanceApi {
  current: () => Appearance;
  choose: (change: Partial<Record<AppearanceKey, string | null>>) => void;
  /** The Settings page saved new defaults: use them here at once. */
  setDefaults: (defaults: Record<string, string>) => void;
}

declare global {
  interface Window { switchyardAppearance?: AppearanceApi }
}

export const appearanceApi = (): AppearanceApi | undefined => window.switchyardAppearance;

const subscribe = (listener: () => void) => {
  document.addEventListener('switchyard:theme', listener);
  return () => document.removeEventListener('switchyard:theme', listener);
};
// A snapshot must stay the same object until it changes, so it's compared as text.
const snapshot = () => JSON.stringify(appearanceApi()?.current() ?? null);

export function useAppearance(): Appearance | null {
  const text = useSyncExternalStore(subscribe, snapshot, () => 'null');
  return JSON.parse(text) as Appearance | null;
}
