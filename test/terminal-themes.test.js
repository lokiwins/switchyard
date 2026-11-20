import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PANE_TOKENS, TERMINAL_CHOICES, TERMINAL_IDS, TERMINAL_PALETTES, paneVars, terminalPalette, terminalPicker, xtermOptions, xtermTheme,
} from '../public/terminal-themes.js';
import { THEME_IDS } from '../public/themes.js';

const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'];
const HEX = /^#[0-9a-f]{6}$/i;

/** WCAG contrast between two #rrggbb colours. */
function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('the choices: Match page theme first, then the named schemes', () => {
  assert.equal(TERMINAL_CHOICES[0].id, 'match');
  assert.deepEqual(TERMINAL_IDS, ['match', 'dracula', 'solarized-dark', 'solarized-light', 'nord', 'gruvbox-dark', 'tokyo-night', 'catppuccin-mocha', 'catppuccin-latte', 'one-dark']);
});

test('every page theme has a terminal palette for light and for dark, and every named scheme has one', () => {
  for (const theme of THEME_IDS) for (const scheme of ['light', 'dark']) assert.ok(TERMINAL_PALETTES[`${theme}-${scheme}`], `${theme}-${scheme}`);
  for (const id of TERMINAL_IDS.slice(1)) assert.ok(TERMINAL_PALETTES[id], id);
});

test('every palette has its 16 colours, background, text, cursor and selection, and reads clearly', () => {
  for (const [id, p] of Object.entries(TERMINAL_PALETTES)) {
    for (const key of ['background', 'foreground', 'cursor', 'selection', ...ANSI]) assert.match(p[key] ?? '', HEX, `${id}.${key}`);
    assert.equal(typeof p.light, 'boolean', `${id}.light`);
    assert.ok(contrast(p.foreground, p.background) >= 4.5, `${id}: text on background is ${contrast(p.foreground, p.background).toFixed(2)}:1`);
  }
});

test('Match page theme follows the page\'s theme and light/dark; a named scheme is itself everywhere', () => {
  assert.equal(terminalPalette('match', 'ember', 'light'), TERMINAL_PALETTES['ember-light']);
  assert.equal(terminalPalette('match', 'graphite', 'dark'), TERMINAL_PALETTES['graphite-dark']);
  assert.equal(terminalPalette('dracula', 'ember', 'light'), TERMINAL_PALETTES.dracula);
  assert.equal(terminalPalette('nonsense', 'dusk', 'dark'), TERMINAL_PALETTES['dusk-dark']);
  assert.equal(terminalPalette('match', 'nonsense', 'dark'), TERMINAL_PALETTES['classic-dark']);
});

test('xterm gets the 16 colours, cursor and selection; cells stay transparent so the glass shows through', () => {
  const theme = xtermTheme(TERMINAL_PALETTES.nord);
  assert.equal(theme.background, 'rgba(46, 52, 64, 0)', 'transparent, but in its own colour so xterm can judge contrast');
  assert.equal(theme.foreground, '#d8dee9');
  assert.equal(theme.red, '#bf616a');
  assert.match(theme.selectionBackground, /^rgba\(/);
  for (const key of ANSI) assert.ok(theme[key], key);
});

test('the glass frame gets every pane token; Classic dark keeps today\'s exact look', () => {
  for (const p of Object.values(TERMINAL_PALETTES)) {
    const vars = paneVars(p);
    assert.deepEqual(Object.keys(vars).sort(), [...PANE_TOKENS].sort());
  }
  const classic = paneVars(TERMINAL_PALETTES['classic-dark']);
  assert.equal(classic['--pane-bg'], 'rgb(8 13 24 / 0.68)');
  assert.equal(classic['--pane-text'], '#e6f1ff');
  assert.equal(classic['--pane-accent'], '#7dd3fc');
  assert.equal(classic['--pane-scheme'], 'dark');
  assert.equal(paneVars(TERMINAL_PALETTES['solarized-light'])['--pane-scheme'], 'light');
});

test('the glass panes draw only from the pane tokens, so a terminal theme recolours all of them', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../web/src/styles/legacy.css', import.meta.url), 'utf8');
  const start = css.indexOf(' * Glass pane:');
  const end = css.indexOf('/* Clean up: removing a worktree');
  assert.ok(start > 0 && end > start, 'the glass pane section is where the test expects it');
  // The defaults block holds the literal colours; checked below against Classic dark.
  const section = css.slice(start, end).replace(/:root \{\s*\/\* The glass pane[^}]*\}/, '');
  const literals = section.split('\n')
    .filter((line) => !line.includes('var(--pane-backdrop'))
    .filter((line) => /#[0-9a-f]{3,8}\b|rgb\(|rgba\(|(?<![\w-])(white|black)(?![\w-])/i.test(line.replace(/\/\*.*?\*\//g, '')));
  assert.deepEqual(literals, []);
  // The page behind an open pane is dimmed the same in every terminal theme, so none of them sets it.
  assert.ok(Object.values(TERMINAL_PALETTES).every((p) => !('--pane-backdrop' in paneVars(p))));
  // Today's look before any script runs: Classic dark's pane tokens are the defaults on :root.
  const defaults = css.match(/:root \{\s*\/\* The glass pane[^}]*\}/)?.[0] ?? '';
  for (const [name, value] of Object.entries(paneVars(TERMINAL_PALETTES['classic-dark']))) {
    assert.ok(defaults.includes(`${name}: ${value};`), `${name} defaults to ${value}`);
  }
});

test('a light terminal gets a contrast floor, since Claude Code may draw for a dark one; a dark one is left as it is', () => {
  assert.equal(xtermOptions(TERMINAL_PALETTES['solarized-light']).minimumContrastRatio, 4.5);
  assert.equal(xtermOptions(TERMINAL_PALETTES['classic-light']).minimumContrastRatio, 4.5);
  assert.equal(xtermOptions(TERMINAL_PALETTES['classic-dark']).minimumContrastRatio, 1);
  assert.equal(xtermOptions(TERMINAL_PALETTES.dracula).minimumContrastRatio, 1);
});

test('the terminal pane\'s picker: the Settings default (named), then every choice; selects what this browser uses', () => {
  const byDefault = terminalPicker({ own: {}, defaults: { terminal: 'nord' } });
  assert.equal(byDefault.selected, '');
  assert.deepEqual(byDefault.options[0], { value: '', label: 'Settings default (Nord)' });
  assert.deepEqual(byDefault.options.slice(1).map((o) => o.value), TERMINAL_IDS);
  assert.equal(byDefault.options[1].label, 'Match page theme');
  assert.equal(terminalPicker({ own: { terminal: 'dracula' }, defaults: { terminal: 'match' } }).selected, 'dracula');
  assert.equal(terminalPicker({ own: {}, defaults: { terminal: 'match' } }).options[0].label, 'Settings default (Match page theme)');
});
