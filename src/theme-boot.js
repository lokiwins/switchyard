import { THEME_IDS, MODE_IDS } from '../shared/themes.ts';
import { TERMINAL_IDS } from '../shared/terminal-themes.ts';

/*
 * /theme-boot.js: public/theme-boot.js with the Settings page's default theme
 * and mode filled in. Pages load it first thing in <head>, so the theme is
 * set before anything is drawn (no flash of the wrong one), and it's a file
 * from switchyard itself, so the CSP needs no inline script.
 */

const PLACEHOLDER = '/*APPEARANCE*/null';

/** The boot script `source` with `appearance` (the configured default) and the known themes and modes in it. */
export function themeBootScript(source, appearance) {
  if (!THEME_IDS.includes(appearance?.theme)) throw new Error(`Unknown theme: ${appearance?.theme}`);
  if (!MODE_IDS.includes(appearance?.mode)) throw new Error(`Unknown mode: ${appearance?.mode}`);
  if (!TERMINAL_IDS.includes(appearance?.terminal)) throw new Error(`Unknown terminal: ${appearance?.terminal}`);
  if (!source.includes(PLACEHOLDER)) throw new Error('theme-boot.js has no place for the appearance');
  const filled = {
    defaults: { theme: appearance.theme, mode: appearance.mode, terminal: appearance.terminal },
    themes: THEME_IDS,
    modes: MODE_IDS,
    terminals: TERMINAL_IDS,
  };
  return source.replace(PLACEHOLDER, JSON.stringify(filled));
}
