import { expect, test } from 'vitest';
import {
  PANE_TOKENS, TERMINAL_CHOICES, TERMINAL_IDS, TERMINAL_PALETTES, paneVars, terminalPalette, terminalPicker, xtermOptions, xtermTheme,
} from './terminal-themes.ts';
import { THEME_IDS } from './themes.ts';

const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'];
const HEX = /^#[0-9a-f]{6}$/i;

/** A palette by id, which the test expects to be there. */
function palette(id: string) {
  const found = TERMINAL_PALETTES[id];
  if (!found) throw new Error(`No palette ${id}`);
  return found;
}

/** WCAG contrast between two #rrggbb colours. */
function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const [r = 0, g = 0, bl = 0] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi = 0, lo = 0] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('the choices: Match page theme first, then the named schemes', () => {
  expect(TERMINAL_CHOICES[0]?.id).toBe('match');
  expect(TERMINAL_IDS).toStrictEqual(['match', 'dracula', 'solarized-dark', 'solarized-light', 'nord', 'gruvbox-dark', 'tokyo-night', 'catppuccin-mocha', 'catppuccin-latte', 'one-dark']);
});

test('every page theme has a terminal palette for light and for dark, and every named scheme has one', () => {
  for (const theme of THEME_IDS) for (const scheme of ['light', 'dark']) expect(TERMINAL_PALETTES[`${theme}-${scheme}`], `${theme}-${scheme}`).toBeTruthy();
  for (const id of TERMINAL_IDS.slice(1)) expect(TERMINAL_PALETTES[id], id).toBeTruthy();
});

test('every palette has its 16 colours, background, text, cursor and selection, and reads clearly', () => {
  for (const [id, p] of Object.entries(TERMINAL_PALETTES)) {
    for (const key of ['background', 'foreground', 'cursor', 'selection', ...ANSI]) expect((p as unknown as Record<string, unknown>)[key] ?? '', `${id}.${key}`).toMatch(HEX);
    expect(typeof p.light, `${id}.light`).toBe('boolean');
    expect(contrast(p.foreground, p.background) >= 4.5, `${id}: text on background is ${contrast(p.foreground, p.background).toFixed(2)}:1`).toBeTruthy();
  }
});

test('Match page theme follows the page\'s theme and light/dark; a named scheme is itself everywhere', () => {
  expect(terminalPalette('match', 'ember', 'light')).toBe(TERMINAL_PALETTES['ember-light']);
  expect(terminalPalette('match', 'graphite', 'dark')).toBe(TERMINAL_PALETTES['graphite-dark']);
  expect(terminalPalette('dracula', 'ember', 'light')).toBe(TERMINAL_PALETTES.dracula);
  expect(terminalPalette('nonsense', 'dusk', 'dark')).toBe(TERMINAL_PALETTES['dusk-dark']);
  expect(terminalPalette('match', 'nonsense', 'dark')).toBe(TERMINAL_PALETTES['classic-dark']);
});

test('xterm gets the 16 colours, cursor and selection; cells stay transparent so the glass shows through', () => {
  const theme = xtermTheme(palette('nord'));
  expect(theme.background, 'transparent, but in its own colour so xterm can judge contrast').toBe('rgba(46, 52, 64, 0)');
  expect(theme.foreground).toBe('#d8dee9');
  expect(theme.red).toBe('#bf616a');
  expect(theme.selectionBackground).toMatch(/^rgba\(/);
  for (const key of ANSI) expect((theme as Record<string, string>)[key], key).toBeTruthy();
});

test('the glass frame gets every pane token; Classic dark keeps today\'s exact look', () => {
  for (const p of Object.values(TERMINAL_PALETTES)) {
    const vars = paneVars(p);
    expect(Object.keys(vars).sort()).toStrictEqual([...PANE_TOKENS].sort());
  }
  const classic = paneVars(palette('classic-dark'));
  expect(classic['--pane-bg']).toBe('rgb(8 13 24 / 0.68)');
  expect(classic['--pane-text']).toBe('#e6f1ff');
  expect(classic['--pane-accent']).toBe('#7dd3fc');
  expect(classic['--pane-scheme']).toBe('dark');
  expect(paneVars(palette('solarized-light'))['--pane-scheme']).toBe('light');
});

test('a light terminal gets a contrast floor, since Claude Code may draw for a dark one; a dark one is left as it is', () => {
  expect(xtermOptions(palette('solarized-light')).minimumContrastRatio).toBe(4.5);
  expect(xtermOptions(palette('classic-light')).minimumContrastRatio).toBe(4.5);
  expect(xtermOptions(palette('classic-dark')).minimumContrastRatio).toBe(1);
  expect(xtermOptions(palette('dracula')).minimumContrastRatio).toBe(1);
});

test('the terminal pane\'s picker: the Settings default (named), then every choice; selects what this browser uses', () => {
  const byDefault = terminalPicker({ own: {}, defaults: { terminal: 'nord' } });
  expect(byDefault.selected).toBe('');
  expect(byDefault.options[0]).toStrictEqual({ value: '', label: 'Settings default (Nord)' });
  expect(byDefault.options.slice(1).map((o) => o.value)).toStrictEqual(TERMINAL_IDS);
  expect(byDefault.options[1]?.label).toBe('Match page theme');
  expect(terminalPicker({ own: { terminal: 'dracula' }, defaults: { terminal: 'match' } }).selected).toBe('dracula');
  expect(terminalPicker({ own: {}, defaults: { terminal: 'match' } }).options[0]?.label).toBe('Settings default (Match page theme)');
});
