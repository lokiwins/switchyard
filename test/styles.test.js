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

/** The rules inside `@media (<query>) { … }`, as text. */
function media(query) {
  const start = css.indexOf(`@media (${query}) {`);
  if (start === -1) return '';
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
  }
  return '';
}

/** The declarations of `selector` inside a block of CSS text. */
function ruleIn(block, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // A selector follows the block's opening, another rule, or a comment.
  return block.match(new RegExp(`(?:{|}|\\*/)\\s*${escaped}\\s*{([^}]*)}`))?.[1] ?? null;
}

test('the page is one column no wider than the window, whatever is in it', () => {
  assert.match(rule('main') ?? '', /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test('on a phone the top bar wraps: name and buttons, then the page links', () => {
  const phone = media('max-width: 640px');
  assert.match(ruleIn(phone, '.topbar') ?? '', /flex-wrap:\s*wrap/);
  assert.match(ruleIn(phone, '.brand') ?? '', /display:\s*contents/);
  assert.match(ruleIn(phone, '.nav') ?? '', /flex-basis:\s*100%/);
});

test('on a phone wide content shrinks instead of widening the page', () => {
  const phone = media('max-width: 640px');
  assert.match(ruleIn(phone, '.pr') ?? '', /minmax\(0,\s*1fr\)/);
  assert.match(ruleIn(phone, '.segmented') ?? '', /flex-wrap:\s*wrap/);
});

test('on a phone a session row stacks, so its buttons do not crowd out its title', () => {
  const phone = media('max-width: 640px');
  assert.match(ruleIn(phone, '.list-row') ?? '', /grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)/);
  assert.match(ruleIn(phone, '.list-row > .actions') ?? '', /grid-row:\s*3/);
});

test('a menu is never wider than the window', () => {
  const panel = rule('.menu-panel') ?? '';
  assert.match(panel, /max-width:\s*min\([^;]*100vw/);
  assert.match(panel, /min-width:\s*min\([^;]*100vw/);
});

test('on a phone a task row keeps its ⋯ menu beside the title, and the add box gives the title its own line', () => {
  const phone = media('max-width: 640px');
  assert.match(ruleIn(phone, '.list-row.hub-row > .actions') ?? '', /grid-row:\s*1/);
  assert.match(ruleIn(phone, '.hub-new-row input[name="title"]') ?? '', /flex-basis:\s*100%/);
});
