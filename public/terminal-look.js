import { paneVars, terminalPalette, xtermOptions } from './terminal-themes.js';

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
