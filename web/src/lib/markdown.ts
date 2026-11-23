/*
 * Markdown for previewing what Claude wants to write: parseMarkdown turns
 * text into blocks, with no DOM. The pages draw the blocks as elements, never
 * as HTML (components/Markdown.tsx).
 */

export type Inline =
  | { type: 'text' | 'code'; text: string }
  | { type: 'strong' | 'em' | 'del'; children: Inline[] }
  | { type: 'image'; alt: string }
  | { type: 'link'; href: string; children: Inline[] };
export type Align = 'left' | 'right' | 'center' | null;
export interface Item { checked: boolean | null; blocks: Block[] }
export type Block =
  | { type: 'heading'; level: number; inline: Inline[] }
  | { type: 'paragraph'; inline: Inline[] }
  | { type: 'code'; lang: string | null; text: string }
  | { type: 'quote'; blocks: Block[] }
  | { type: 'rule' }
  | { type: 'list'; ordered: boolean; start: number | null; items: Item[] }
  | { type: 'table'; header: Inline[][]; align: Align[]; rows: Inline[][][] };

const FENCE = /^(\s*)(`{3,}|~{3,})\s*([\w+#.-]*)/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const NUMBERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const WORD_CHAR = /[\p{L}\p{N}]/u;

// Inline: code first (its contents are literal), then images, links (whose text may be an image, as in a badge), emphasis.
const INLINE = /(`+)([\s\S]*?[^`])\1(?!`)|!\[([^\]]*)\]\(([^)\s]*)[^)]*\)|\[((?:!\[[^\]]*\]\([^)]*\)|[^[\]])+)\]\(([^)\s]*)[^)]*\)|(\*\*|__)(?=\S)([\s\S]*?\S)\7|(\*|_)(?=\S)([\s\S]*?\S)\9|~~(?=\S)([\s\S]*?\S)~~/;

/** Adjacent text pieces as one. */
const mergeText = (nodes: Inline[]) => nodes.reduce<Inline[]>((merged, node) => {
  const last = merged.at(-1);
  return node.type === 'text' && last?.type === 'text'
    ? [...merged.slice(0, -1), { type: 'text', text: last.text + node.text }]
    : [...merged, node];
}, []);

/** Inline Markdown as [{ type: text|code|strong|em|del|link|image, ... }]. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest) {
    const match = INLINE.exec(rest);
    if (!match) {
      out.push({ type: 'text', text: rest });
      break;
    }
    const [whole, , code, alt, , linkText, href, strongMark, strong, emMark, em, del] = match;
    // "_" inside a word (snake_case) isn't emphasis: skip past it as text.
    const end = match.index + whole.length;
    if ((strongMark ?? emMark)?.startsWith('_') && (WORD_CHAR.test(rest[match.index - 1] ?? '') || WORD_CHAR.test(rest[end] ?? ''))) {
      out.push({ type: 'text', text: rest.slice(0, match.index + 1) });
      rest = rest.slice(match.index + 1);
      continue;
    }
    if (match.index > 0) out.push({ type: 'text', text: rest.slice(0, match.index) });
    if (code !== undefined) out.push({ type: 'code', text: code.trim() || code });
    else if (alt !== undefined) out.push({ type: 'image', alt });
    else if (linkText !== undefined) out.push({ type: 'link', href: href ?? '', children: parseInline(linkText) });
    else if (strong !== undefined) out.push({ type: 'strong', children: parseInline(strong) });
    else if (em !== undefined) out.push({ type: 'em', children: parseInline(em) });
    else out.push({ type: 'del', children: parseInline(del ?? '') });
    rest = rest.slice(end);
  }
  return mergeText(out);
}

const splitRow = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
const alignOf = (cell: string): Align => {
  if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
  if (cell.endsWith(':')) return 'right';
  return cell.startsWith(':') ? 'left' : null;
};
const indentOf = (line: string) => line.length - line.trimStart().length;
const isBlank = (line: string) => line.trim() === '';

/** A list starting at lines[start]: its items' lines (continuations indented under them), parsed as blocks. */
function parseList(lines: string[], start: number): { block: Block; next: number } {
  const line = lines[start] ?? '';
  const first = BULLET.exec(line) ?? NUMBERED.exec(line);
  const ordered = !BULLET.test(line);
  const indent = first?.[1]?.length ?? 0;
  const items: Item[] = [];
  let i = start;
  while (i < lines.length) {
    const marker = (ordered ? NUMBERED : BULLET).exec(lines[i] ?? '');
    if (!marker || (marker[1] ?? '').length !== indent) break;
    const body = [marker[3] ?? ''];
    i += 1;
    while (i < lines.length && (isBlank(lines[i] ?? '') ? i + 1 < lines.length && indentOf(lines[i + 1] ?? '') > indent : indentOf(lines[i] ?? '') > indent)) {
      const next = lines[i] ?? '';
      body.push(next.slice(Math.min(indentOf(next), indent + 2)));
      i += 1;
    }
    const task = TASK.exec(body[0] ?? '');
    if (task) body[0] = task[2] ?? '';
    items.push({ checked: task ? task[1] !== ' ' : null, blocks: parseMarkdown(body.join('\n')) });
  }
  return { block: { type: 'list', ordered, start: ordered ? Number(first?.[2]) : null, items }, next: i };
}

/** Markdown as blocks: heading, paragraph, code, quote, list, table, rule. */
export function parseMarkdown(text: string): Block[] {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  // Past the end reads as a blank line.
  const at = (n: number) => lines[n] ?? '';
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = at(i);
    if (isBlank(line)) {
      i += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const mark = fence[2] ?? '```';
      const close = new RegExp(`^\\s*${mark[0]}{${mark.length},}\\s*$`);
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !close.test(at(i))) body.push(at(i++));
      blocks.push({ type: 'code', lang: fence[3] || null, text: body.join('\n') });
      i += 1;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: (heading[1] ?? '#').length, inline: parseInline(heading[2] ?? '') });
      i += 1;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ type: 'rule' });
      i += 1;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(at(i))) body.push(at(i++).replace(/^\s*>\s?/, ''));
      blocks.push({ type: 'quote', blocks: parseMarkdown(body.join('\n')) });
      continue;
    }
    if (BULLET.test(line) || NUMBERED.test(line)) {
      const { block, next } = parseList(lines, i);
      blocks.push(block);
      i = next;
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_DIVIDER.test(at(i + 1))) {
      const header = splitRow(line);
      const align = splitRow(at(i + 1)).map(alignOf);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && at(i).includes('|') && !isBlank(at(i))) rows.push(splitRow(at(i++)).map(parseInline));
      blocks.push({ type: 'table', header: header.map(parseInline), align, rows });
      continue;
    }
    const body: string[] = [];
    while (i < lines.length && !isBlank(at(i)) && !FENCE.test(at(i)) && !HEADING.test(at(i))
      && !/^\s*>/.test(at(i)) && !BULLET.test(at(i)) && !NUMBERED.test(at(i)) && !RULE.test(at(i))) {
      body.push(at(i++).trim());
    }
    blocks.push({ type: 'paragraph', inline: parseInline(body.join(' ')) });
  }
  return blocks;
}
