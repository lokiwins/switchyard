import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../web/src/styles/legacy.css', import.meta.url), 'utf8');

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|})\\s*${escaped}\\s*{([^}]*)}`, 'm'));
  return match ? match[1] : null;
}

/** A source file under web/src, for the utilities it gives an element. */
const source = (path) => readFile(new URL(`../web/src/${path}`, import.meta.url), 'utf8');

test('the page behind an open pane does not scroll', async () => {
  const base = await source('styles/base.css');
  assert.match(base.match(/html:has\(dialog:modal\)\s*{([^}]*)}/)?.[1] ?? '', /overflow:\s*hidden/);
});

test('scrolling to the end of a pane does not carry on to the page', async () => {
  // A pane's body, and the live terminal's scrolling viewport inside xterm.
  assert.match((await source('components/pane-classes.ts')).match(/paneBodyClass = '([^']*)'/)?.[1] ?? '', /(^|\s)overscroll-contain(\s|$)/);
  assert.match(await source('features/terminal/connection.ts'), /\[&_\.xterm-viewport\]:overscroll-contain/);
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

test('the page is one column no wider than the window, whatever is in it', async () => {
  const base = await readFile(new URL('../web/src/styles/base.css', import.meta.url), 'utf8');
  assert.match(base.match(/(?:^|[{}])\s*main\s*{([^}]*)}/m)?.[1] ?? '', /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test('on a phone a session row stacks, so its buttons do not crowd out its title', () => {
  const phone = media('max-width: 640px');
  assert.match(ruleIn(phone, '.list-row') ?? '', /grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)/);
  assert.match(ruleIn(phone, '.list-row > .actions') ?? '', /grid-row:\s*3/);
});

test('on a phone a task row keeps its ⋯ menu beside the title, and the add box gives the title its own line', () => {
  const phone = media('max-width: 640px');
  assert.match(ruleIn(phone, '.list-row.hub-row > .actions') ?? '', /grid-row:\s*1/);
  assert.match(ruleIn(phone, '.hub-new-row input[name="title"]') ?? '', /flex-basis:\s*100%/);
});

test('a select draws its own arrow, inset from its right edge', async () => {
  // The browser's own arrow sits on the right edge whatever the padding, so every select draws one instead.
  const base = await readFile(new URL('../web/src/styles/base.css', import.meta.url), 'utf8');
  const select = base.match(/(?:^|[{}])\s*select\s*{([^}]*)}/m)?.[1] ?? '';
  assert.match(select, /appearance:\s*none/);
  assert.match(select, /background-image:[^;]*currentColor/);
  assert.match(select, /background-position:\s*right\s+\d+px\s+center/);
  // A select's own rule sets only its colour, as the background shorthand would drop the arrow, and leaves the arrow room.
  const own = rule('.tool-select') ?? '';
  assert.ok(own, 'no rule for .tool-select');
  assert.doesNotMatch(own, /(^|[;\s])background:/, '.tool-select uses the background shorthand');
  const room = Number(own.match(/padding(?:-right:\s*|:\s*\S+\s+)(\d+)px/)?.[1]);
  assert.ok(room >= 24, `.tool-select leaves ${room}px for the arrow`);
  // A pane's select, as utilities: a background colour only, and room on the right.
  const pane = (await source('components/pane-classes.ts')).match(/paneSelectClass = cx\(([\s\S]*?)\);/)?.[1] ?? '';
  assert.ok(pane, 'no paneSelectClass');
  assert.doesNotMatch(pane, /\[background:|bg-\[(linear|radial|url)/, 'paneSelectClass sets the whole background');
  assert.ok(Number(pane.match(/pr-\[(\d+)px\]/)?.[1]) >= 24, 'paneSelectClass leaves room for the arrow');
});
