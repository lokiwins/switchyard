import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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

test('the page is one column no wider than the window, whatever is in it', async () => {
  const base = await readFile(new URL('../web/src/styles/base.css', import.meta.url), 'utf8');
  assert.match(base.match(/(?:^|[{}])\s*main\s*{([^}]*)}/m)?.[1] ?? '', /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test('on a phone a session row stacks, so its buttons do not crowd out its title', async () => {
  const row = await source('features/agents/Row.tsx');
  assert.match(row, /max-phone:grid-cols-\[auto_minmax\(0,1fr\)\]/);
  assert.match(row.match(/rowActionsClass = '([^']*)'/)?.[1] ?? '', /max-phone:row-start-3/);
});

test('on a phone a task row keeps its ⋯ menu beside the title, and the add box gives the title its own line', async () => {
  const row = await source('features/tasks/TaskRow.tsx');
  assert.match(row.match(/const ACTIONS = '([^']*)'/)?.[1] ?? '', /max-phone:row-start-1/);
  assert.match(await source('features/tasks/NewTaskForm.tsx'), /className=\{cx\(BOX, '[^']*max-phone:basis-full[^']*'\)\} name="title"/);
});

test('a select draws its own arrow, inset from its right edge', async () => {
  // The browser's own arrow sits on the right edge whatever the padding, so every select draws one instead.
  const base = await readFile(new URL('../web/src/styles/base.css', import.meta.url), 'utf8');
  const select = base.match(/(?:^|[{}])\s*select\s*{([^}]*)}/m)?.[1] ?? '';
  assert.match(select, /appearance:\s*none/);
  assert.match(select, /background-image:[^;]*currentColor/);
  assert.match(select, /background-position:\s*right\s+\d+px\s+center/);
  // A select's own rule sets only its colour, as the background shorthand would drop the arrow, and leaves the arrow room.
  // Each select's own classes: a background colour only, and room on the right.
  const selects = [
    ['components/pane-classes.ts', /paneSelectClass = cx\(([\s\S]*?)\);/],
    ['components/Field.tsx', /fieldSelectClass = cx\(([\s\S]*?)\);/],
    ['features/tasks/Connections.tsx', /const SELECT = \[([\s\S]*?)\]\.join/],
  ];
  for (const [file, pattern] of selects) {
    const own = (await source(file)).match(pattern)?.[1] ?? '';
    assert.ok(own, `no select classes in ${file}`);
    assert.doesNotMatch(own, /\[background:|bg-\[(linear|radial|url)/, `${file}'s select sets the whole background`);
    assert.ok(Number(own.match(/pr-\[(\d+)px\]/)?.[1]) >= 24, `${file}'s select leaves room for the arrow`);
  }
});
