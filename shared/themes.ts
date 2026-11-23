/*
 * The themes switchyard can be drawn in, each in light and dark, and the
 * modes that choose between those. The colors are in web/src/styles/themes.css;
 * the server checks settings against these ids.
 */

export interface Choice { readonly id: string; readonly label: string }

export const THEMES: readonly Choice[] = Object.freeze([
  Object.freeze({ id: 'classic', label: 'Classic' }),
  Object.freeze({ id: 'signal', label: 'Signal' }),
  Object.freeze({ id: 'ember', label: 'Ember' }),
  Object.freeze({ id: 'dusk', label: 'Dusk' }),
  Object.freeze({ id: 'graphite', label: 'Graphite' }),
  Object.freeze({ id: 'coast', label: 'Coast' }),
  Object.freeze({ id: 'heatwave', label: 'Heatwave' }),
]);

export const MODES: readonly Choice[] = Object.freeze([
  Object.freeze({ id: 'system', label: 'System' }),
  Object.freeze({ id: 'light', label: 'Light' }),
  Object.freeze({ id: 'dark', label: 'Dark' }),
]);

export const THEME_IDS = THEMES.map((theme) => theme.id);
export const MODE_IDS = MODES.map((mode) => mode.id);
