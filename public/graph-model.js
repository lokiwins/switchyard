/*
 * The graph page's data, apart from drawing: what each kind of node is called
 * and coloured, how big a node is, the Cytoscape elements for a session graph,
 * and what changed between two graphs, so a live update only touches those.
 */

/** Node kinds, in legend order. `color` is the CSS custom property the page reads. */
export const KINDS = {
  session: { name: 'Session', color: '--graph-session' },
  prompt: { name: 'Prompts', color: '--graph-prompt' },
  compaction: { name: 'Compactions', color: '--graph-compaction' },
  memory: { name: 'Memory & instructions', color: '--graph-memory' },
  skill: { name: 'Skills', color: '--graph-skill' },
  subagent: { name: 'Subagents', color: '--graph-subagent' },
  file: { name: 'Files', color: '--graph-file' },
  tool: { name: 'Tools', color: '--graph-tool' },
};

const MIN_SIZE = 16;
const MAX_SIZE = 64;
const SIZE_PER_DOUBLING = 6;

/** Diameter in px for a node used `uses` times: grows with each doubling, within bounds. */
export function nodeSize(uses) {
  return Math.min(MAX_SIZE, MIN_SIZE + SIZE_PER_DOUBLING * Math.log2(Math.max(1, uses)));
}

function nodeElement(node) {
  return {
    group: 'nodes',
    data: { id: node.id, kind: node.kind, label: node.label, size: nodeSize(node.uses) },
    classes: [node.kind, ...(node.inContext ? [] : ['out-of-context'])],
  };
}

function edgeElement(edge) {
  return {
    group: 'edges',
    data: { id: edge.id, source: edge.source, target: edge.target, kind: edge.kind, count: edge.count },
    classes: [edge.kind],
  };
}

/** Cytoscape elements for a graph: all the nodes, then all the edges. */
export function toElements(graph) {
  return [...graph.nodes.map(nodeElement), ...graph.edges.map(edgeElement)];
}

const sameElement = (a, b) => JSON.stringify(a.data) === JSON.stringify(b.data) && a.classes.join(' ') === b.classes.join(' ');

/** What turns the `current` elements into `next` graph's: elements to add or update, and ids to remove. */
export function diffElements(current, next) {
  const before = new Map(current.map((e) => [e.data.id, e]));
  const after = toElements(next);
  const ids = new Set(after.map((e) => e.data.id));
  return {
    add: after.filter((e) => !before.has(e.data.id)),
    update: after.filter((e) => before.has(e.data.id) && !sameElement(before.get(e.data.id), e)),
    remove: current.filter((e) => !ids.has(e.data.id)).map((e) => e.data.id),
  };
}

/** How many nodes there are of each kind. */
export function kindCounts(graph) {
  const counts = {};
  for (const node of graph.nodes) counts[node.kind] = (counts[node.kind] ?? 0) + 1;
  return counts;
}

const times = (edge) => (edge.count > 1 ? `${edge.kind} ${edge.count}×` : edge.kind);

/**
 * A node's neighbours, each with what passed between them in words:
 * "read 2× · edit" for what this node did to it, "… by" for what it did to this node.
 */
export function nodeConnections(graph, id) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const found = new Map();
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
