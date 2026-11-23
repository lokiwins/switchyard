import { expect, test } from 'vitest';
import { parseInline, parseMarkdown, type Block } from './markdown';

/** A block the test expects to be of `type`, as that kind of block. */
function ofType<T extends Block['type']>(block: Block | undefined, type: T): Extract<Block, { type: T }> {
  expect(block?.type).toBe(type);
  return block as Extract<Block, { type: T }>;
}

test('parseInline reads code, emphasis, strikethrough and links, and keeps code literal', () => {
  expect(parseInline('Run `npm **test**` now')).toStrictEqual([
    { type: 'text', text: 'Run ' }, { type: 'code', text: 'npm **test**' }, { type: 'text', text: ' now' },
  ]);
  expect(parseInline('**bold** and *it* and ~~gone~~')).toStrictEqual([
    { type: 'strong', children: [{ type: 'text', text: 'bold' }] }, { type: 'text', text: ' and ' },
    { type: 'em', children: [{ type: 'text', text: 'it' }] }, { type: 'text', text: ' and ' },
    { type: 'del', children: [{ type: 'text', text: 'gone' }] },
  ]);
  expect(parseInline('[docs](https://example.com "Docs") ![logo](x.png)')).toStrictEqual([
    { type: 'link', href: 'https://example.com', children: [{ type: 'text', text: 'docs' }] },
    { type: 'text', text: ' ' }, { type: 'image', alt: 'logo' },
  ]);
});

test('parseInline leaves lone markers as text', () => {
  expect(parseInline('2 * 3 = 6, a_b_c')).toStrictEqual([{ type: 'text', text: '2 * 3 = 6, a_b_c' }]);
});

test('parseMarkdown reads headings, paragraphs joined across lines, rules and quotes', () => {
  const blocks = parseMarkdown('# Title #\n\nFirst line\nsecond line\n\n---\n\n> quoted\n> more');
  expect(blocks.map((b) => b.type)).toStrictEqual(['heading', 'paragraph', 'rule', 'quote']);
  const heading = ofType(blocks[0], 'heading');
  expect(heading.level).toBe(1);
  expect(heading.inline).toStrictEqual([{ type: 'text', text: 'Title' }]);
  expect(ofType(blocks[1], 'paragraph').inline).toStrictEqual([{ type: 'text', text: 'First line second line' }]);
  expect(ofType(ofType(blocks[3], 'quote').blocks[0], 'paragraph').inline).toStrictEqual([{ type: 'text', text: 'quoted more' }]);
});

test('parseMarkdown keeps fenced code exactly, with its language', () => {
  const [code] = parseMarkdown('```js\nconst a = 1;\n\n  # not a heading\n```');
  expect(code).toStrictEqual({ type: 'code', lang: 'js', text: 'const a = 1;\n\n  # not a heading' });
});

test('parseMarkdown reads nested lists, numbered lists and task items', () => {
  const [first, second] = parseMarkdown('- one\n  - nested\n- [x] done\n- [ ] todo\n\n3. third\n4. fourth');
  const list = ofType(first, 'list');
  const numbered = ofType(second, 'list');
  expect(list.ordered).toBe(false);
  expect(list.items.length).toBe(3);
  expect(list.items[0]?.blocks[1]?.type).toBe('list');
  expect(list.items.map((item) => item.checked)).toStrictEqual([null, true, false]);
  expect(numbered.ordered).toBe(true);
  expect(numbered.start).toBe(3);
  expect(numbered.items.length).toBe(2);
});

test('parseMarkdown reads tables with alignment', () => {
  const table = ofType(parseMarkdown('| Tool | Speed |\n|:-----|------:|\n| tmux | fast |')[0], 'table');
  expect(table.align).toStrictEqual(['left', 'right']);
  expect(table.rows[0]?.[0]).toStrictEqual([{ type: 'text', text: 'tmux' }]);
});

test('parseMarkdown runs an unclosed fence to the end instead of failing', () => {
  expect(parseMarkdown('```\nno end')).toStrictEqual([{ type: 'code', lang: null, text: 'no end' }]);
});

test('underscores mark emphasis only around words, not inside them', () => {
  expect(parseInline('call snake_case_name')).toStrictEqual([{ type: 'text', text: 'call snake_case_name' }]);
  expect(parseInline('_this_ and __that__')).toStrictEqual([
    { type: 'em', children: [{ type: 'text', text: 'this' }] }, { type: 'text', text: ' and ' },
    { type: 'strong', children: [{ type: 'text', text: 'that' }] },
  ]);
});

test('a link whose text is an image, like a README badge, is one link around the image', () => {
  expect(parseInline('[![Tests](https://x/badge.svg)](https://x/test.yml) after')).toStrictEqual([
    { type: 'link', href: 'https://x/test.yml', children: [{ type: 'image', alt: 'Tests' }] },
    { type: 'text', text: ' after' },
  ]);
});
