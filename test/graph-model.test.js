import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KINDS, TOKEN_KINDS, diffElements, formatShare, formatTokens, kindCounts, nodeConnections, nodeSize, toElements, tokenBreakdown } from '../public/graph-model.js';

const graph = {
  nodes: [
    { id: 'session', kind: 'session', label: 'shop', uses: 1, inContext: true },
    { id: 'prompt:1', kind: 'prompt', label: 'Fix it', uses: 1, inContext: true },
    { id: 'file:/w/a.js', kind: 'file', label: 'a.js', uses: 3, inContext: false, tokens: 3000, liveTokens: 0 },
  ],
  edges: [
    { id: 'session→prompt:1:next', source: 'session', target: 'prompt:1', kind: 'next', count: 1 },
    { id: 'prompt:1→file:/w/a.js:read', source: 'prompt:1', target: 'file:/w/a.js', kind: 'read', count: 2 },
    { id: 'prompt:1→file:/w/a.js:edit', source: 'prompt:1', target: 'file:/w/a.js', kind: 'edit', count: 1 },
  ],
};

test('every node kind the server sends has a name and a colour token', () => {
  for (const kind of ['session', 'prompt', 'compaction', 'file', 'tool', 'memory', 'skill', 'subagent']) {
    assert.ok(KINDS[kind]?.name, kind);
    assert.match(KINDS[kind].color, /^--graph-/, kind);
  }
});

test('nodes grow with the tokens they put into context, but slowly, between a floor and a ceiling', () => {
  assert.equal(nodeSize(0), nodeSize(10));
  assert.ok(nodeSize(1000) > nodeSize(100));
  assert.ok(nodeSize(10_000) > nodeSize(1000));
  assert.ok(nodeSize(10_000_000) <= 72);
  assert.ok(nodeSize(0) >= 12);
});

test('toElements gives Cytoscape nodes then edges, with size and context marks', () => {
  const elements = toElements(graph);
  assert.equal(elements.length, 6);
  const file = elements.find((e) => e.data.id === 'file:/w/a.js');
  assert.equal(file.group, 'nodes');
  assert.equal(file.data.size, nodeSize(3000));
  assert.deepEqual(file.classes, ['file', 'out-of-context']);
  const edge = elements.find((e) => e.data.id === 'prompt:1→file:/w/a.js:read');
  assert.equal(edge.group, 'edges');
  assert.deepEqual(edge.classes, ['read']);
  // Nodes first, so an edge's ends exist when it is added.
  assert.ok(elements.findIndex((e) => e.group === 'edges') > elements.findLastIndex((e) => e.group === 'nodes'));
});

test('diffElements adds what is new, updates what changed, removes what went, and leaves the rest', () => {
  const before = toElements(graph);
  const next = {
    nodes: [
      graph.nodes[0],
      { ...graph.nodes[1] },
      { ...graph.nodes[2], uses: 9, inContext: true },
      { id: 'tool:Bash', kind: 'tool', label: 'Bash', uses: 1, inContext: true },
    ],
    edges: [graph.edges[0], { ...graph.edges[1], count: 3 }, { id: 'prompt:1→tool:Bash:used', source: 'prompt:1', target: 'tool:Bash', kind: 'used', count: 1 }],
  };
  const diff = diffElements(before, next);
  assert.deepEqual(diff.add.map((e) => e.data.id), ['tool:Bash', 'prompt:1→tool:Bash:used']);
  assert.deepEqual(diff.update.map((e) => e.data.id).sort(), ['file:/w/a.js', 'prompt:1→file:/w/a.js:read']);
  assert.deepEqual(diff.remove, ['prompt:1→file:/w/a.js:edit']);
  assert.equal(diffElements(toElements(next), next).update.length, 0);
});

test('kindCounts counts the nodes of each kind, for the filters', () => {
  assert.deepEqual(kindCounts(graph), { session: 1, prompt: 1, file: 1 });
});

test('nodeConnections says, in words, what a node did and what was done to it', () => {
  assert.deepEqual(nodeConnections(graph, 'file:/w/a.js'), [
    { id: 'prompt:1', label: 'Fix it', kind: 'prompt', text: 'read 2× · edit by' },
  ]);
  assert.deepEqual(nodeConnections(graph, 'prompt:1'), [
    { id: 'session', label: 'shop', kind: 'session', text: 'after' },
    { id: 'file:/w/a.js', label: 'a.js', kind: 'file', text: 'read 2× · edit' },
  ]);
});

test('token counts read short: exact under a thousand, then k and M', () => {
  assert.equal(formatTokens(950), '950');
  assert.equal(formatTokens(1234), '1.2k');
  assert.equal(formatTokens(1010), '1k');
  assert.equal(formatTokens(35_400), '35k');
  assert.equal(formatTokens(353_023), '353k');
  assert.equal(formatTokens(2_295_831), '2.3M');
});

test('every token kind has a name and a colour, Claude\'s replies included', () => {
  for (const kind of TOKEN_KINDS) assert.ok(kind.name && kind.color.startsWith('--graph-'), kind.kind);
  assert.ok(TOKEN_KINDS.some((k) => k.kind === 'reply'));
});

test('the breakdown lists what is in context now by kind, in a fixed order, with the rest as other', () => {
  const breakdown = tokenBreakdown({ tokens: { live: { tool: 600, prompt: 100, file: 300 }, session: { tool: 5000 }, context: 2000 } });
  assert.deepEqual(breakdown.rows.map((r) => r.kind), ['prompt', 'file', 'tool', 'other']);
  assert.deepEqual(breakdown.rows.map((r) => r.tokens), [100, 300, 600, 1000]);
  assert.equal(breakdown.total, 2000);
  assert.equal(breakdown.reported, true);
  assert.equal(breakdown.rows.at(-1).share, 0.5);
  assert.equal(breakdown.session, 5000);
});

test('without a reported context size, the total is the estimate and there is no other', () => {
  const breakdown = tokenBreakdown({ tokens: { live: { prompt: 100 }, session: { prompt: 100 }, context: null } });
  assert.equal(breakdown.total, 100);
  assert.equal(breakdown.reported, false);
  assert.deepEqual(breakdown.rows.map((r) => r.kind), ['prompt']);
});

test('estimates above the reported size leave no negative other', () => {
  const breakdown = tokenBreakdown({ tokens: { live: { file: 900 }, session: {}, context: 500 } });
  assert.deepEqual(breakdown.rows.map((r) => r.kind), ['file']);
  assert.equal(breakdown.total, 900);
});

test('shares are whole percents, with a sliver as <1%', () => {
  assert.equal(formatShare(0.5), '50%');
  assert.equal(formatShare(0.004), '<1%');
  assert.equal(formatShare(0), '0%');
});
