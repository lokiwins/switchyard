import { h } from './dom.js';
import { paneVars, terminalPalette, terminalPicker, xtermOptions } from './terminal-themes.js';

/*
 * The terminal theme on this page: theme-boot.js sets <html data-terminal>
 * (and the page's data-theme and data-scheme, which "Match page theme" uses);
 * this turns it into the glass pane's colours and xterm's palette.
 */

const html = document.documentElement;

/** The terminal palette this page uses now. */
function currentPalette() {
  const { terminal = 'match', theme = 'classic', scheme = 'dark' } = html.dataset;
  return terminalPalette(terminal, theme, scheme);
}

/** xterm.js's theme and contrast floor for the terminal theme now. */
export const currentXtermOptions = () => xtermOptions(currentPalette());

/** Give the glass panes the terminal theme's colours (custom properties set from script, which the CSP allows). */
function applyPaneLook() {
  for (const [name, value] of Object.entries(paneVars(currentPalette()))) html.style.setProperty(name, value);
}

/** Keep the glass panes in the terminal theme, now and whenever the theme changes. */
export function followTerminalLook() {
  applyPaneLook();
  document.addEventListener('switchyard:theme', applyPaneLook);
}

/**
 * A picker for the terminal colours, for the terminal pane's header: the pane
 * covers the page, top bar and all, so the ◐ menu can't be reached while it's
 * open. It changes this browser's choice, as the ◐ menu does, and keeps up
 * with changes made there or in another tab. `afterPick` gives the keyboard
 * back to the terminal.
 */
export function terminalThemePicker({ appearance = window.switchyardAppearance, afterPick = () => {} } = {}) {
  if (!appearance) return { element: null, dispose: () => {} };
  const select = h('select', {
    class: 'pane-select term-theme',
    title: 'Terminal colours, for this browser',
    'aria-label': 'Terminal colours',
    onchange: () => {
      appearance.choose({ terminal: select.value || null });
      afterPick();
    },
  });
  const sync = () => {
    const { options, selected } = terminalPicker(appearance.current());
    select.replaceChildren(...options.map((option) => h('option', { value: option.value }, option.label)));
    select.value = selected;
  };
  sync();
  document.addEventListener('switchyard:theme', sync);
  return { element: select, dispose: () => document.removeEventListener('switchyard:theme', sync) };
}
