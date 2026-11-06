import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseInline, parseMarkdown } from '../public/markdown.js';

test('parseInline reads code, emphasis, strikethrough and links, and keeps code literal', () => {
  assert.deepEqual(parseInline('Run `npm **test**` now'), [
    { type: 'text', text: 'Run ' }, { type: 'code', text: 'npm **test**' }, { type: 'text', text: ' now' },
  ]);
  assert.deepEqual(parseInline('**bold** and *it* and ~~gone~~'), [
    { type: 'strong', children: [{ type: 'text', text: 'bold' }] }, { type: 'text', text: ' and ' },
    { type: 'em', children: [{ type: 'text', text: 'it' }] }, { type: 'text', text: ' and ' },
    { type: 'del', children: [{ type: 'text', text: 'gone' }] },
  ]);
  assert.deepEqual(parseInline('[docs](https://example.com "Docs") ![logo](x.png)'), [
    { type: 'link', href: 'https://example.com', children: [{ type: 'text', text: 'docs' }] },
    { type: 'text', text: ' ' }, { type: 'image', alt: 'logo' },
  ]);
});

test('parseInline leaves lone markers as text', () => {
  assert.deepEqual(parseInline('2 * 3 = 6, a_b_c'), [{ type: 'text', text: '2 * 3 = 6, a_b_c' }]);
});

test('parseMarkdown reads headings, paragraphs joined across lines, rules and quotes', () => {
  const blocks = parseMarkdown('# Title #\n\nFirst line\nsecond line\n\n---\n\n> quoted\n> more');
  assert.deepEqual(blocks.map((b) => b.type), ['heading', 'paragraph', 'rule', 'quote']);
  assert.equal(blocks[0].level, 1);
  assert.deepEqual(blocks[0].inline, [{ type: 'text', text: 'Title' }]);
  assert.deepEqual(blocks[1].inline, [{ type: 'text', text: 'First line second line' }]);
  assert.deepEqual(blocks[3].blocks[0].inline, [{ type: 'text', text: 'quoted more' }]);
});

test('parseMarkdown keeps fenced code exactly, with its language', () => {
  const [code] = parseMarkdown('```js\nconst a = 1;\n\n  # not a heading\n```');
  assert.deepEqual(code, { type: 'code', lang: 'js', text: 'const a = 1;\n\n  # not a heading' });
});

test('parseMarkdown reads nested lists, numbered lists and task items', () => {
  const [list, numbered] = parseMarkdown('- one\n  - nested\n- [x] done\n- [ ] todo\n\n3. third\n4. fourth');
  assert.equal(list.ordered, false);
  assert.equal(list.items.length, 3);
  assert.equal(list.items[0].blocks[1].type, 'list');
  assert.deepEqual(list.items.map((item) => item.checked), [null, true, false]);
  assert.equal(numbered.ordered, true);
  assert.equal(numbered.start, 3);
  assert.equal(numbered.items.length, 2);
});

test('parseMarkdown reads tables with alignment', () => {
  const [table] = parseMarkdown('| Tool | Speed |\n|:-----|------:|\n| tmux | fast |');
  assert.equal(table.type, 'table');
  assert.deepEqual(table.align, ['left', 'right']);
  assert.deepEqual(table.rows[0][0], [{ type: 'text', text: 'tmux' }]);
});

test('parseMarkdown runs an unclosed fence to the end instead of failing', () => {
  assert.deepEqual(parseMarkdown('```\nno end'), [{ type: 'code', lang: null, text: 'no end' }]);
});

test('underscores mark emphasis only around words, not inside them', () => {
  assert.deepEqual(parseInline('call snake_case_name'), [{ type: 'text', text: 'call snake_case_name' }]);
  assert.deepEqual(parseInline('_this_ and __that__'), [
    { type: 'em', children: [{ type: 'text', text: 'this' }] }, { type: 'text', text: ' and ' },
    { type: 'strong', children: [{ type: 'text', text: 'that' }] },
  ]);
});

test('a link whose text is an image, like a README badge, is one link around the image', () => {
  assert.deepEqual(parseInline('[![Tests](https://x/badge.svg)](https://x/test.yml) after'), [
    { type: 'link', href: 'https://x/test.yml', children: [{ type: 'image', alt: 'Tests' }] },
    { type: 'text', text: ' after' },
  ]);
});
