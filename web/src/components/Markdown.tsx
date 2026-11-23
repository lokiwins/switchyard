import { createElement, type ReactNode } from 'react';
import { parseMarkdown as parse } from '../../../public/markdown.js';
import { cx } from '../lib/cx';

/*
 * Markdown from the model (a plan, a file Claude wants to write), drawn as
 * elements: never as HTML, so nothing in it runs. Links open only for
 * http(s) and mailto; images show their alt text, as the page loads nothing
 * from outside. Parsing is shared with the other pages (public/markdown.js).
 */

type Inline =
  | { type: 'text' | 'code'; text: string }
  | { type: 'strong' | 'em' | 'del'; children: Inline[] }
  | { type: 'image'; alt: string }
  | { type: 'link'; href: string; children: Inline[] };
type Align = 'left' | 'right' | 'center' | null;
interface Item { checked: boolean | null; blocks: Block[] }
type Block =
  | { type: 'heading'; level: number; inline: Inline[] }
  | { type: 'paragraph'; inline: Inline[] }
  | { type: 'code'; lang: string | null; text: string }
  | { type: 'quote'; blocks: Block[] }
  | { type: 'rule' }
  | { type: 'list'; ordered: boolean; start: number | null; items: Item[] }
  | { type: 'table'; header: Inline[][]; align: Align[]; rows: Inline[][][] };

const parseMarkdown = parse as (text: string) => Block[];

/*
 * Its look, on the glass (the --pane-* colours). Each element is drawn here,
 * so each carries its own classes. Blocks are spaced by the space under them;
 * the first one has none above. A list item's paragraphs sit tight, as in a list.
 */
const BLOCK = 'mt-0 mx-0 mb-[0.9em]';
const HEADING = 'first:mt-0 mt-[1.2em] mb-[0.5em] leading-[1.3]';
// h1 to h3 take their weight from base.css; h4 to h6 are bold, at the sizes a browser gives them.
const HEADING_SIZES: Record<number, string> = {
  1: 'text-[1.6em]', 2: 'text-[1.35em]', 3: 'text-[1.15em]', 4: 'font-bold', 5: 'text-[0.83em] font-bold', 6: 'text-[0.67em] font-bold',
};
const LIST = cx(BLOCK, 'pl-[1.5em] [&>li>p]:m-0 [&>li>ul]:my-[0.2em] [&>li>ol]:my-[0.2em]');
const CODE = 'font-mono text-[0.9em] [line-height:normal]';
const INLINE_CODE = cx(CODE, 'py-[0.1em] px-[0.35em] rounded-xs bg-[color-mix(in_srgb,var(--pane-accent)_12%,transparent)]');
const CELL = 'py-1 px-2.5 border border-[color-mix(in_srgb,var(--pane-accent)_20%,transparent)]';
// Plain Markdown headers, not the app's small-caps table headings.
const HEAD_CELL = cx(CELL, 'bg-[color-mix(in_srgb,var(--pane-accent)_8%,transparent)] normal-case tracking-normal text-[length:inherit] font-semibold [color:inherit]');
const ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;
const DIM = 'text-pane-dim';
const SAFE_LINK = /^(https?:|mailto:)/i;

function InlineNodes({ nodes }: { nodes: Inline[] }): ReactNode {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'code': return <code key={i} className={INLINE_CODE}>{node.text}</code>;
      case 'strong': return <strong key={i}><InlineNodes nodes={node.children} /></strong>;
      case 'em': return <em key={i}><InlineNodes nodes={node.children} /></em>;
      case 'del': return <del key={i}><InlineNodes nodes={node.children} /></del>;
      case 'image': return <span key={i} className={DIM}>{`[image${node.alt ? `: ${node.alt}` : ''}]`}</span>;
      case 'link': return SAFE_LINK.test(node.href)
        ? <a key={i} className="text-pane-accent" href={node.href} target="_blank" rel="noopener noreferrer"><InlineNodes nodes={node.children} /></a>
        : <span key={i} className={DIM} title={node.href}><InlineNodes nodes={node.children} /></span>;
      default: return node.text;
    }
  });
}

const alignClass = (align: Align) => (align ? ALIGN[align] : undefined);

/** A list item; a task item's checkbox goes at the start of its first line. */
function ListItem({ item }: { item: Item }) {
  if (item.checked === null) return <li><Blocks blocks={item.blocks} /></li>;
  const box = <input type="checkbox" className="mt-0 mr-[0.45em] mb-0 ml-0 align-middle" disabled checked={item.checked} readOnly />;
  const task = 'list-none -ml-[1.3em]';
  const [first, ...rest] = item.blocks;
  if (first?.type === 'paragraph') {
    return <li className={task}><p className={BLOCK}>{box}<InlineNodes nodes={first.inline} /></p><Blocks blocks={rest} /></li>;
  }
  return <li className={task}>{box}<Blocks blocks={item.blocks} /></li>;
}

function BlockNode({ block }: { block: Block }): ReactNode {
  switch (block.type) {
    case 'heading': return createElement(`h${block.level}`, { className: cx(HEADING, HEADING_SIZES[block.level]) }, <InlineNodes nodes={block.inline} />);
    case 'code': return (
      <pre className={cx(BLOCK, 'p-3 rounded-[8px] overflow-auto bg-[color-mix(in_srgb,var(--pane-shade)_35%,transparent)]')} data-lang={block.lang ?? undefined}>
        <code className={CODE}>{block.text}</code>
      </pre>
    );
    case 'quote': return <blockquote className={cx(BLOCK, 'pl-[1em] border-l-3 border-pane-edge', DIM)}><Blocks blocks={block.blocks} /></blockquote>;
    case 'rule': return <hr className="my-[1.2em] mx-0 border-0 border-t border-pane-edge" />;
    case 'list': {
      const items = block.items.map((item, i) => <ListItem key={i} item={item} />);
      return block.ordered
        ? <ol className={cx(LIST, 'list-decimal')} start={block.start && block.start !== 1 ? block.start : undefined}>{items}</ol>
        : <ul className={cx(LIST, 'list-disc')}>{items}</ul>;
    }
    case 'table': return (
      <div className={cx(BLOCK, 'overflow-x-auto')}>
        <table className="border-collapse">
          <thead><tr>{block.header.map((cell, i) => <th key={i} className={cx(HEAD_CELL, alignClass(block.align[i] ?? null))}><InlineNodes nodes={cell} /></th>)}</tr></thead>
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r}>{row.map((cell, i) => <td key={i} className={cx(CELL, alignClass(block.align[i] ?? null))}><InlineNodes nodes={cell} /></td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    default: return <p className={BLOCK}><InlineNodes nodes={block.inline} /></p>;
  }
}

// Blocks have no identity beyond their place, and are only ever drawn whole, so their index is their key.
const Blocks = ({ blocks }: { blocks: Block[] }) => blocks.map((block, i) => <BlockNode key={i} block={block} />);

/** Markdown, at the glass's reading size or (`size="sm"`, in a ticket) a step down. */
export function Markdown({ text, size = 'base' }: { text: string; size?: 'base' | 'sm' }) {
  return <div className={cx('max-w-[72ch] leading-[1.6]', size === 'sm' ? 'text-sm' : 'text-base')}><Blocks blocks={parseMarkdown(text)} /></div>;
}
