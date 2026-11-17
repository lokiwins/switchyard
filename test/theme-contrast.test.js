import assert from 'node:assert/strict';
import { test } from 'node:test';
import { THEME_IDS } from '../public/themes.js';
import { contrastOf, over, parseColor, themeTokens } from './support/theme-colors.js';

// Text and the background it's drawn on, with the WCAG AA contrast it needs:
// 4.5:1 for body text, 3:1 for large text (the tiles' 24px numbers).
const PAIRS = [
  ['gray-900', 'bg', 4.5],
  ['gray-700', 'surface', 4.5],
  ['gray-500', 'surface', 4.5],
  ['gray-500', 'bg', 4.5],
  ['gray-400', 'surface', 3],
  ['accent', 'surface', 4.5],
  ['accent', 'accent-soft', 4.5],
  ['on-accent', 'accent', 4.5],
  ['on-red', 'red', 4.5],
  ['gray-700', 'surface-raised', 4.5],
  ...['green', 'amber', 'red', 'purple'].flatMap((color) => [[color, 'surface', 4.5], [color, `${color}-soft`, 4.5]]),
];

for (const theme of THEME_IDS) {
  for (const scheme of ['light', 'dark']) {
    test(`${theme} ${scheme}: text meets WCAG AA contrast`, () => {
      const tokens = themeTokens(theme, scheme);
      // A gradient button: its text has to read at both ends.
      const fills = ['accent-fill-from', 'accent-fill-to'].filter((name) => tokens[name]).map((name) => ['on-accent', name, 4.5]);
      const low = [...PAIRS, ...fills]
        .map(([fg, bg, min]) => ({ pair: `${fg} on ${bg}`, ratio: contrastOf(tokens, fg, bg), min }))
        .filter(({ ratio, min }) => ratio < min)
        .map(({ pair, ratio, min }) => `${pair} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
      assert.deepEqual(low, []);
    });
  }
}

/** How light a colour is, laid over the theme's surface (0 black … 1 white). */
function lightness(tokens, name) {
  const { rgb } = over(parseColor(tokens[name], tokens), parseColor(tokens.surface, tokens));
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

test('in dark mode a menu is lighter than the card under it (raised means lit, not a heavier shadow)', () => {
  for (const theme of THEME_IDS) {
    const tokens = themeTokens(theme, 'dark');
    assert.ok(lightness(tokens, 'surface-raised') > lightness(tokens, 'surface'), `${theme}: --surface-raised isn't lighter than --surface`);
    assert.ok(parseColor(tokens.highlight, tokens)?.alpha > 0, `${theme}: dark mode has no top highlight`);
  }
});

test('in light mode a menu is the plain surface, with no highlight', () => {
  for (const theme of THEME_IDS) {
    const tokens = themeTokens(theme, 'light');
    assert.equal(lightness(tokens, 'surface-raised').toFixed(3), lightness(tokens, 'surface').toFixed(3), theme);
    assert.equal(parseColor(tokens.highlight, tokens)?.alpha, 0, theme);
  }
});

test('the colour reader understands every form the themes use', () => {
  assert.deepEqual(parseColor('#fff').rgb, [1, 1, 1]);
  assert.deepEqual(parseColor('#000000').rgb, [0, 0, 0]);
  assert.equal(parseColor('oklch(100% 0 0 / .08)').alpha, 0.08);
  assert.equal(parseColor('color-mix(in oklab, oklch(70% .1 200) 14%, transparent)').alpha, 0.14);
  assert.ok(Math.abs(parseColor('oklch(100% 0 0)').rgb[0] - 1) < 0.001);
});
