import { createElement, type ReactNode } from 'react';
import { parseMarkdown as parse } from '../../../public/markdown.js';

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
const SAFE_LINK = /^(https?:|mailto:)/i;

function InlineNodes({ nodes }: { nodes: Inline[] }): ReactNode {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'code': return <code key={i}>{node.text}</code>;
      case 'strong': return <strong key={i}><InlineNodes nodes={node.children} /></strong>;
      case 'em': return <em key={i}><InlineNodes nodes={node.children} /></em>;
      case 'del': return <del key={i}><InlineNodes nodes={node.children} /></del>;
      case 'image': return <span key={i} className="md-image">{`[image${node.alt ? `: ${node.alt}` : ''}]`}</span>;
      case 'link': return SAFE_LINK.test(node.href)
        ? <a key={i} href={node.href} target="_blank" rel="noopener noreferrer"><InlineNodes nodes={node.children} /></a>
        : <span key={i} className="md-link" title={node.href}><InlineNodes nodes={node.children} /></span>;
      default: return node.text;
    }
  });
}

const alignClass = (align: Align) => (align ? `md-${align}` : undefined);

/** A list item; a task item's checkbox goes at the start of its first line. */
function ListItem({ item }: { item: Item }) {
  if (item.checked === null) return <li><Blocks blocks={item.blocks} /></li>;
  const box = <input type="checkbox" disabled checked={item.checked} readOnly />;
  const [first, ...rest] = item.blocks;
  if (first?.type === 'paragraph') {
    return <li className="md-task"><p>{box}<InlineNodes nodes={first.inline} /></p><Blocks blocks={rest} /></li>;
  }
  return <li className="md-task">{box}<Blocks blocks={item.blocks} /></li>;
}

function BlockNode({ block }: { block: Block }): ReactNode {
  switch (block.type) {
    case 'heading': return createElement(`h${block.level}`, null, <InlineNodes nodes={block.inline} />);
    case 'code': return <pre className="md-code" data-lang={block.lang ?? undefined}><code>{block.text}</code></pre>;
    case 'quote': return <blockquote><Blocks blocks={block.blocks} /></blockquote>;
    case 'rule': return <hr />;
    case 'list': {
      const items = block.items.map((item, i) => <ListItem key={i} item={item} />);
      return block.ordered ? <ol start={block.start && block.start !== 1 ? block.start : undefined}>{items}</ol> : <ul>{items}</ul>;
    }
    case 'table': return (
      <div className="md-table">
        <table>
          <thead><tr>{block.header.map((cell, i) => <th key={i} className={alignClass(block.align[i] ?? null)}><InlineNodes nodes={cell} /></th>)}</tr></thead>
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r}>{row.map((cell, i) => <td key={i} className={alignClass(block.align[i] ?? null)}><InlineNodes nodes={cell} /></td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    default: return <p><InlineNodes nodes={block.inline} /></p>;
  }
}

// Blocks have no identity beyond their place, and are only ever drawn whole, so their index is their key.
const Blocks = ({ blocks }: { blocks: Block[] }) => blocks.map((block, i) => <BlockNode key={i} block={block} />);

export function Markdown({ text }: { text: string }) {
  return <div className="markdown"><Blocks blocks={parseMarkdown(text)} /></div>;
}
