import type { ElementDefinition } from 'cytoscape';

/*
 * The graph page's data, apart from drawing: what each kind of node is called
 * and coloured, how big a node is, the Cytoscape elements for a session graph,
 * and what changed between two graphs, so a live update only touches those.
 */

export interface GraphNode {
  id: string;
  kind: string;
  label: string;
  detail?: string | null;
  group?: string | null;
  uses: number;
  inContext: boolean;
  tokens?: number;
  liveTokens?: number;
}
export interface GraphEdge { id: string; source: string; target: string; kind: string; count: number }
/** Tokens by kind: in context now (`live`), and over the whole session; `context` is the size Claude last reported. */
export interface GraphTokens { live?: Record<string, number>; session?: Record<string, number>; context?: number | null }
export interface SessionGraph {
  title?: string | null;
  cwd?: string | null;
  compactions: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  tokens?: GraphTokens;
}
export interface TokenKind { kind: string; name: string; color: string }
export interface ShareRow extends TokenKind { tokens: number; share: number }
export interface Connection { id: string; kind: string | null; label: string; text: string }
/** A Cytoscape element as the page makes them: an id, and its classes as a list. */
export type GraphElement = ElementDefinition & { data: { id: string }; classes: string[] };

/** Node kinds, in legend order. `color` is the CSS custom property the page reads. */
export const KINDS: Readonly<Record<string, { name: string; color: string }>> = {
  session: { name: 'Session', color: '--graph-session' },
  prompt: { name: 'Prompts', color: '--graph-prompt' },
  compaction: { name: 'Compactions', color: '--graph-compaction' },
  memory: { name: 'Memory & instructions', color: '--graph-memory' },
  skill: { name: 'Skills', color: '--graph-skill' },
  subagent: { name: 'Subagents', color: '--graph-subagent' },
  file: { name: 'Files', color: '--graph-file' },
  tool: { name: 'Tools', color: '--graph-tool' },
};

/**
 * What fills the context, in the order the breakdown bar stacks them. The
 * colours are one validated categorical palette in this order (adjacent pairs
 * stay apart under colour blindness), so a kind keeps its colour everywhere.
 */
export const TOKEN_KINDS: readonly TokenKind[] = [
  { kind: 'prompt', name: 'Your prompts', color: '--graph-prompt' },
  { kind: 'file', name: 'Files', color: '--graph-file' },
  { kind: 'tool', name: 'Tool results', color: '--graph-tool' },
  { kind: 'skill', name: 'Skills', color: '--graph-skill' },
  { kind: 'subagent', name: 'Subagents', color: '--graph-subagent' },
  { kind: 'reply', name: 'Claude\'s replies', color: '--graph-reply' },
  { kind: 'memory', name: 'Memory & instructions', color: '--graph-memory' },
  { kind: 'compaction', name: 'Compaction summary', color: '--graph-compaction' },
];
const OTHER: TokenKind = { kind: 'other', name: 'Other: system prompt, tool definitions, reminders', color: '--graph-other' };

const MIN_SIZE = 14;
const MAX_SIZE = 72;
const SIZE_PER_DOUBLING = 5;
// Below this many tokens a node keeps the smallest size.
const SIZE_FLOOR_TOKENS = 50;

/** Diameter in px for a node that put `tokens` into context: grows with each doubling, within bounds. */
export function nodeSize(tokens: number): number {
  return Math.min(MAX_SIZE, MIN_SIZE + SIZE_PER_DOUBLING * Math.log2(Math.max(1, tokens / SIZE_FLOOR_TOKENS)));
}

/** 950, 1.2k, 1k, 35k, 353k, 2.3M. */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(Math.round(tokens));
  if (tokens < 10_000) return `${(tokens / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (tokens < 1_000_000) return `${Math.round(tokens / 1000)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/**
 * What is in context now, by kind (estimated), against the size Claude last
 * reported; what the estimates don't cover is "other". `session` is everything
 * that passed through context over the session, compactions included.
 */
export function tokenBreakdown(graph: Pick<SessionGraph, 'tokens'>): { rows: ShareRow[]; total: number; reported: boolean; session: number } {
  const { live = {}, session = {}, context = null } = graph.tokens ?? {};
  const known = TOKEN_KINDS.flatMap((k) => ((live[k.kind] ?? 0) > 0 ? [{ ...k, tokens: live[k.kind] ?? 0 }] : []));
  const estimated = sum(known.map((r) => r.tokens));
  const other = context === null ? 0 : Math.max(0, context - estimated);
  const rows = other > 0 ? [...known, { ...OTHER, tokens: other }] : known;
  const total = Math.max(estimated, context ?? 0);
  return {
    rows: rows.map((r) => ({ ...r, share: total > 0 ? r.tokens / total : 0 })),
    total,
    reported: context !== null,
    session: sum(Object.values(session)),
  };
}

const MAX_LAYOUT_STEPS = 1500;
const MIN_LAYOUT_STEPS = 250;
// Each layout step weighs every pair of nodes, so its cost grows with the square of the node count.
// This many pair-steps take about a second; a few hundred steps already settle a big graph.
const LAYOUT_PAIR_STEPS = 60_000_000;

/** How many steps to lay out `nodes` nodes: the full count for small graphs, fewer as they grow. */
export function layoutSteps(nodes: number): number {
  const affordable = Math.floor(LAYOUT_PAIR_STEPS / Math.max(1, nodes) ** 2);
  return Math.min(MAX_LAYOUT_STEPS, Math.max(MIN_LAYOUT_STEPS, affordable));
}

const SESSION_SIZE = 28;

function nodeElement(node: GraphNode): GraphElement {
  return {
    group: 'nodes',
    data: { id: node.id, kind: node.kind, label: node.label, size: node.kind === 'session' ? SESSION_SIZE : nodeSize(node.tokens ?? 0) },
    classes: [node.kind, ...(node.inContext ? [] : ['out-of-context'])],
  };
}

function edgeElement(edge: GraphEdge): GraphElement {
  return {
    group: 'edges',
    data: { id: edge.id, source: edge.source, target: edge.target, kind: edge.kind, count: edge.count },
    classes: [edge.kind],
  };
}

/** Cytoscape elements for a graph: all the nodes, then all the edges. */
export function toElements(graph: Pick<SessionGraph, 'nodes' | 'edges'>): GraphElement[] {
  return [...graph.nodes.map(nodeElement), ...graph.edges.map(edgeElement)];
}

const sameElement = (a: GraphElement, b: GraphElement) => JSON.stringify(a.data) === JSON.stringify(b.data) && a.classes.join(' ') === b.classes.join(' ');

/** What turns the `current` elements into `next` graph's: elements to add or update, and ids to remove. */
export function diffElements(current: GraphElement[], next: Pick<SessionGraph, 'nodes' | 'edges'>): { add: GraphElement[]; update: GraphElement[]; remove: string[] } {
  const before = new Map(current.map((e) => [e.data.id, e]));
  const after = toElements(next);
  const ids = new Set(after.map((e) => e.data.id));
  return {
    add: after.filter((e) => !before.has(e.data.id)),
    update: after.filter((e) => {
      const was = before.get(e.data.id);
      return was !== undefined && !sameElement(was, e);
    }),
    remove: current.filter((e) => !ids.has(e.data.id)).map((e) => e.data.id),
  };
}

/** How many nodes there are of each kind. */
export function kindCounts(graph: Pick<SessionGraph, 'nodes'>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const node of graph.nodes) counts[node.kind] = (counts[node.kind] ?? 0) + 1;
  return counts;
}

const times = (edge: GraphEdge) => (edge.count > 1 ? `${edge.kind} ${edge.count}×` : edge.kind);

/**
 * A node's neighbours, each with what passed between them in words:
 * "read 2× · edit" for what this node did to it, "… by" for what it did to this node.
 */
export function nodeConnections(graph: Pick<SessionGraph, 'nodes' | 'edges'>, id: string): Connection[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const found = new Map<string, { other: string; outgoing: boolean; verbs: GraphEdge[] }>();
  for (const edge of graph.edges) {
    const outgoing = edge.source === id;
    if (!outgoing && edge.target !== id) continue;
    const other = outgoing ? edge.target : edge.source;
    const key = `${other}:${outgoing}`;
    const entry = found.get(key) ?? { other, outgoing, verbs: [] };
    entry.verbs.push(edge);
    found.set(key, entry);
  }
  return [...found.values()].map(({ other, outgoing, verbs }) => {
    const node = byId.get(other);
    const isSpine = verbs.every((e) => e.kind === 'next');
    const words = verbs.map(times).join(' · ');
    const text = isSpine ? (outgoing ? 'before' : 'after') : (outgoing ? words : `${words} by`);
    return { id: other, label: node?.label ?? other, kind: node?.kind ?? null, text };
  });
}

/** A share as a whole percent; a sliver reads "<1%" rather than "0%". */
export function formatShare(share: number): string {
  if (share > 0 && share < 0.005) return '<1%';
  return `${Math.round(share * 100)}%`;
}
