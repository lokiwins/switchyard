/*
 * Each kind's colour, from its token in themes.css (--graph-prompt, …; the
 * Cytoscape graph reads the same tokens, see graph-model.js). Written out in
 * full so Tailwind finds every class; anything else is the grey of "other".
 */

const SWATCHES: Record<string, string> = {
  session: 'bg-[var(--graph-session)]',
  prompt: 'bg-[var(--graph-prompt)]',
  compaction: 'bg-[var(--graph-compaction)]',
  memory: 'bg-[var(--graph-memory)]',
  skill: 'bg-[var(--graph-skill)]',
  subagent: 'bg-[var(--graph-subagent)]',
  file: 'bg-[var(--graph-file)]',
  tool: 'bg-[var(--graph-tool)]',
  reply: 'bg-[var(--graph-reply)]',
  other: 'bg-[var(--graph-other)]',
};

const FILLS: Record<string, string> = {
  prompt: 'fill-[var(--graph-prompt)]',
  file: 'fill-[var(--graph-file)]',
  tool: 'fill-[var(--graph-tool)]',
  skill: 'fill-[var(--graph-skill)]',
  subagent: 'fill-[var(--graph-subagent)]',
  reply: 'fill-[var(--graph-reply)]',
  memory: 'fill-[var(--graph-memory)]',
  compaction: 'fill-[var(--graph-compaction)]',
  other: 'fill-[var(--graph-other)]',
};

/** A kind's dot, beside its name in the legend, the context's parts and a node's connections. */
export const kindSwatchClass = (kind: string) => `inline-block size-2.5 rounded-full shrink-0 ${SWATCHES[kind] ?? SWATCHES.other}`;

/** A part's segment of the context bar. */
export const kindFillClass = (kind: string) => FILLS[kind] ?? FILLS.other ?? '';
