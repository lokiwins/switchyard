import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|})\\s*${escaped}\\s*{([^}]*)}`, 'm'));
  return match ? match[1] : null;
}

test('the page behind an open pane does not scroll', () => {
  assert.match(rule('html:has(.glass-pane[open])') ?? '', /overflow:\s*hidden/);
});

test('scrolling to the end of a pane does not carry on to the page', () => {
  assert.match(rule('.review-body') ?? '', /overscroll-behavior:\s*contain/);
  assert.match(rule('.glass-pane .term-screen .xterm .xterm-viewport') ?? '', /overscroll-behavior:\s*contain/);
});
