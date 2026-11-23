import { expect, test } from 'vitest';
import { paneVars, terminalPalette, TERMINAL_PALETTES } from '../../../shared/terminal-themes.ts';
import { cssSource, sourceFiles, sourceText } from '../styles/source';

/*
 * The glass panes (the review, plan and task panes, and the live terminal's)
 * take every colour from the --pane-* tokens, which the terminal theme sets.
 */

test('the glass panes draw only from the pane tokens, so a terminal theme recolours all of them', () => {
  // Everything drawn on the glass: the pane, its edge and controls, the panes themselves, the terminal's screen and Markdown.
  const files = ['components/Dialog.tsx', 'components/ResizeHandle.tsx', 'components/pane-classes.ts', 'components/Markdown.tsx',
    'features/terminal/TerminalPane.tsx', 'features/terminal/connection.ts',
    ...sourceFiles('features/panes').filter((f) => f.endsWith('.tsx')).map((f) => `features/panes/${f}`)];
  const uncommented = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((line) => line.replace(/\/\/.*$/, ''));
  // A literal colour, or one of the page's own colours rather than the pane's.
  const literal = /#[0-9a-f]{3,8}\b|rgba?\(|(?<![\w-])(white|black)(?![\w-])/i;
  const pageColour = /(?<![\w-])(text|bg|border|outline|shadow|ring|fill)-(gray|surface|accent|green|amber|red|purple|divider|hairline|hover|highlight|neutral|on-)|var\(--(?!pane-|status\b)[\w-]+\)/;
  const offenders = files.flatMap((file) => uncommented(sourceText(file))
    .filter((line) => literal.test(line) || pageColour.test(line))
    .map((line) => `${file}: ${line.trim()}`));
  expect(offenders).toStrictEqual([]);
  // The page behind an open pane is dimmed the same in every terminal theme, so none of them sets it.
  expect(Object.values(TERMINAL_PALETTES).every((p) => !('--pane-backdrop' in paneVars(p)))).toBeTruthy();
  // Today's look before any script runs: Classic dark's pane tokens are the defaults on :root.
  const defaults = cssSource('themes').match(/:root \{\s*--pane-bg[^}]*\}/)?.[0] ?? '';
  expect(defaults, 'themes.css has the pane defaults').toBeTruthy();
  for (const [name, value] of Object.entries(paneVars(terminalPalette('match', 'classic', 'dark')))) {
    expect(defaults.includes(`${name}: ${value};`), `${name} defaults to ${value}`).toBeTruthy();
  }
});
