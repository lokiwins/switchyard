/*
 * Markdown for previewing what Claude wants to write: parseMarkdown turns
 * text into blocks, with no DOM, so it's tested in node. The pages draw the
 * blocks as elements, never as HTML (web/src/components/Markdown.tsx).
 */

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
const mergeText = (nodes) => nodes.reduce((merged, node) => {
  const last = merged.at(-1);
  return node.type === 'text' && last?.type === 'text'
    ? [...merged.slice(0, -1), { type: 'text', text: last.text + node.text }]
    : [...merged, node];
}, []);

/** Inline Markdown as [{ type: text|code|strong|em|del|link|image, ... }]. */
export function parseInline(text) {
  const out = [];
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
    else if (linkText !== undefined) out.push({ type: 'link', href, children: parseInline(linkText) });
    else if (strong !== undefined) out.push({ type: 'strong', children: parseInline(strong) });
    else if (em !== undefined) out.push({ type: 'em', children: parseInline(em) });
    else out.push({ type: 'del', children: parseInline(del) });
    rest = rest.slice(end);
  }
  return mergeText(out);
}

const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
const alignOf = (cell) => {
  if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
  if (cell.endsWith(':')) return 'right';
  return cell.startsWith(':') ? 'left' : null;
};
const indentOf = (line) => line.match(/^\s*/)[0].length;
const isBlank = (line) => line.trim() === '';

/** A list starting at lines[start]: its items' lines (continuations indented under them), parsed as blocks. */
function parseList(lines, start) {
  const first = BULLET.exec(lines[start]) ?? NUMBERED.exec(lines[start]);
  const ordered = !BULLET.test(lines[start]);
  const indent = first[1].length;
  const items = [];
  let i = start;
  while (i < lines.length) {
    const marker = (ordered ? NUMBERED : BULLET).exec(lines[i]);
    if (!marker || marker[1].length !== indent) break;
    const body = [marker[3]];
    i += 1;
    while (i < lines.length && (isBlank(lines[i]) ? i + 1 < lines.length && indentOf(lines[i + 1]) > indent : indentOf(lines[i]) > indent)) {
      body.push(lines[i].slice(Math.min(indentOf(lines[i]), indent + 2)));
      i += 1;
    }
    const task = TASK.exec(body[0]);
    if (task) body[0] = task[2];
    items.push({ checked: task ? task[1] !== ' ' : null, blocks: parseMarkdown(body.join('\n')) });
  }
  return { block: { type: 'list', ordered, start: ordered ? Number(first[2]) : null, items }, next: i };
}

/** Markdown as blocks: heading, paragraph, code, quote, list, table, rule. */
export function parseMarkdown(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const close = new RegExp(`^\\s*${fence[2][0]}{${fence[2].length},}\\s*$`);
      const body = [];
      i += 1;
      while (i < lines.length && !close.test(lines[i])) body.push(lines[i++]);
      blocks.push({ type: 'code', lang: fence[3] || null, text: body.join('\n') });
      i += 1;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, inline: parseInline(heading[2]) });
      i += 1;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ type: 'rule' });
      i += 1;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push({ type: 'quote', blocks: parseMarkdown(body.join('\n')) });
      continue;
    }
    if (BULLET.test(line) || NUMBERED.test(line)) {
      const { block, next } = parseList(lines, i);
      blocks.push(block);
      i = next;
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])) {
      const header = splitRow(line);
      const align = splitRow(lines[i + 1]).map(alignOf);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && !isBlank(lines[i])) rows.push(splitRow(lines[i++]).map(parseInline));
      blocks.push({ type: 'table', header: header.map(parseInline), align, rows });
      continue;
    }
    const body = [];
    while (i < lines.length && !isBlank(lines[i]) && !FENCE.test(lines[i]) && !HEADING.test(lines[i])
      && !/^\s*>/.test(lines[i]) && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i]) && !RULE.test(lines[i])) {
      body.push(lines[i++].trim());
    }
    blocks.push({ type: 'paragraph', inline: parseInline(body.join(' ')) });
  }
  return blocks;
}
