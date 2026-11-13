import cytoscape from '/vendor/cytoscape/cytoscape.esm.min.mjs';
import { h, readPref, shortPath, timeAgo, writePref } from './dom.js';
import { startNavBadges } from './nav.js';
import { KINDS, diffElements, kindCounts, nodeConnections, toElements } from './graph-model.js';

/*
 * A session's context graph: your prompts in order, and the files, tools,
 * memory, skills and subagents each one brought into Claude's context. It
 * follows the session live; new nodes appear beside what they connect to,
 * and Arrange lays the whole graph out again.
 */

const $ = (id) => document.getElementById(id);
const sessionId = new URLSearchParams(location.search).get('session') ?? '';
const HIDDEN_PREF = 'graph.hiddenKinds';
const NEW_NODE_SPREAD = 60;
const ui = { graph: null, elements: [], selected: null, updatedAt: null, hidden: new Set(JSON.parse(readPref(HIDDEN_PREF, '[]'))) };

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Cytoscape draws on a canvas, so its colours are read from the page's tokens (and again when the theme changes). */
function graphStyle() {
  const kindStyles = Object.entries(KINDS).map(([kind, { color }]) => ({ selector: `node.${kind}`, style: { 'background-color': css(color) } }));
  return [
    {
      selector: 'node',
      style: {
        width: 'data(size)', height: 'data(size)', label: 'data(label)',
        'font-size': 10, 'min-zoomed-font-size': 7, color: css('--gray-700'),
        'text-valign': 'bottom', 'text-margin-y': 4, 'text-wrap': 'ellipsis', 'text-max-width': 160,
        'border-width': 1, 'border-color': css('--surface'),
      },
    },
    ...kindStyles,
    { selector: 'node.session', style: { shape: 'round-rectangle', 'font-weight': 700, 'font-size': 12 } },
    { selector: 'node.compaction', style: { shape: 'diamond' } },
    { selector: 'node.prompt', style: { shape: 'round-rectangle' } },
    { selector: 'node.out-of-context', style: { opacity: 0.35 } },
    {
      selector: 'edge',
      style: { width: 'mapData(count, 1, 20, 1, 4)', 'line-color': css('--gray-200'), 'curve-style': 'haystack', opacity: 0.8 },
    },
    {
      selector: 'edge.next',
      style: { width: 2, 'line-color': css('--graph-prompt'), 'curve-style': 'bezier', 'target-arrow-shape': 'triangle', 'target-arrow-color': css('--graph-prompt') },
    },
    { selector: 'edge.edit, edge.write', style: { 'line-color': css('--graph-file') } },
    { selector: '.faded', style: { opacity: 0.12 } },
    { selector: 'node:selected', style: { 'border-width': 3, 'border-color': css('--accent') } },
    { selector: '.kind-hidden', style: { display: 'none' } },
  ];
}

const cy = cytoscape({
  container: $('graph'),
  style: graphStyle(),
  wheelSensitivity: 0.3,
  minZoom: 0.05,
  maxZoom: 4,
});

const LAYOUT = { name: 'cose', animate: false, nodeDimensionsIncludeLabels: false, idealEdgeLength: 90, nodeRepulsion: 20000, gravity: 0.3, numIter: 1500, padding: 24 };
// Selecting a node zooms in at least this far, so its label and its neighbours' are readable.
const SELECT_ZOOM = 1;
// A small graph fitted to the screen would be drawn huge; past this zoom it is centred instead.
const MAX_FIT_ZOOM = 1.2;

function fit() {
  cy.fit(cy.nodes(':visible'), 24);
  if (cy.zoom() > MAX_FIT_ZOOM) {
    cy.zoom(MAX_FIT_ZOOM);
    cy.center(cy.nodes(':visible'));
  }
}

/**
 * Lay everything out from the same start (nodes round a circle in the server's order), so a
 * graph comes out the same each time: a screenshot or a reload doesn't reshuffle it.
 */
function arrange() {
  const nodes = cy.nodes();
  const radius = Math.max(100, nodes.length * 4);
  nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / nodes.length;
    node.position({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
  });
  cy.layout({ ...LAYOUT, randomize: false, fit: false }).run();
  fit();
}

/** Put nodes new in a live update beside a node they connect to, so the rest of the graph stays where you left it. */
function placeNew(added) {
  for (const node of added.nodes()) {
    const anchor = node.neighborhood('node').filter((n) => !added.contains(n)).first();
    const base = anchor.nonempty() ? anchor.position() : { x: cy.width() / 2, y: cy.height() / 2 };
    const angle = Math.random() * 2 * Math.PI;
    node.position({ x: base.x + NEW_NODE_SPREAD * Math.cos(angle), y: base.y + NEW_NODE_SPREAD * Math.sin(angle) });
  }
}

function applyHidden() {
  cy.batch(() => {
    cy.nodes().forEach((n) => n.toggleClass('kind-hidden', ui.hidden.has(n.data('kind'))));
  });
}

function showLegend(graph) {
  const counts = kindCounts(graph);
  const chips = Object.entries(KINDS).filter(([kind]) => counts[kind] && kind !== 'session').map(([kind, { name }]) => h('label', { class: 'graph-kind' },
    h('input', {
      type: 'checkbox',
      checked: !ui.hidden.has(kind),
      onchange: (event) => {
        if (event.target.checked) ui.hidden.delete(kind);
        else ui.hidden.add(kind);
        writePref(HIDDEN_PREF, JSON.stringify([...ui.hidden]));
        applyHidden();
      },
    }),
    h('span', { class: `graph-swatch kind-${kind}`, 'aria-hidden': 'true' }),
    `${name} `,
    h('span', { class: 'muted' }, String(counts[kind]))));
  $('legend').replaceChildren(h('legend', { class: 'visually-hidden' }, 'Show'), ...chips);
}

const plural = (count = 0, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

function summary(graph) {
  const counts = kindCounts(graph);
  const out = graph.nodes.filter((n) => !n.inContext).length;
  return h('div', { class: 'stack graph-summary' },
    h('h3', {}, 'This session'),
    h('p', { class: 'small' }, `${[
      plural(counts.prompt, 'prompt'), plural(counts.file, 'file'), plural(counts.tool, 'tool'),
      plural(counts.memory, 'memory or instruction file'), plural(counts.skill, 'skill'), plural(counts.subagent, 'subagent'),
    ].join(', ')}.`),
    graph.compactions > 0
      ? h('p', { class: 'small' }, `Compacted ${graph.compactions} time${graph.compactions > 1 ? 's' : ''}. Faded nodes were last used before the latest compaction, so they're no longer in context (${out}).`)
      : h('p', { class: 'small' }, 'Never compacted: everything shown is still in context.'),
    h('p', { class: 'small muted' }, 'Click a node to see what it is and what it connects to. Bigger nodes were used more.'));
}

function select(id) {
  const node = cy.getElementById(id);
  if (node.empty()) return;
  cy.elements().unselect();
  node.select();
  cy.animate({ zoom: { level: Math.max(cy.zoom(), SELECT_ZOOM), position: node.position() }, center: { eles: node } }, { duration: 200 });
}

function nodeDetail(graph, node) {
  const kind = KINDS[node.kind]?.name ?? node.kind;
  const links = nodeConnections(graph, node.id);
  return h('div', { class: 'stack graph-node' },
    h('h3', {}, node.group ? `${kind} · ${node.group}` : kind),
    h('p', { class: 'graph-node-label' }, node.label),
    node.detail && node.detail !== node.label && h('p', { class: node.kind === 'prompt' ? 'small' : 'small mono' }, node.detail),
    h('p', { class: 'small muted' }, [
      node.kind === 'session' ? null : `Used ${node.uses} time${node.uses === 1 ? '' : 's'}`,
      node.inContext ? 'in context' : 'no longer in context (before the last compaction)',
    ].filter(Boolean).join(' · ')),
    links.length > 0 && h('h3', {}, `Connections (${links.length})`),
    links.length > 0 && h('ul', { class: 'graph-links' }, ...links.map((link) => h('li', {},
      h('span', { class: `graph-swatch kind-${link.kind}`, 'aria-hidden': 'true' }),
      h('button', { type: 'button', class: 'graph-link', title: 'Show this node', onclick: () => select(link.id) }, link.label),
      h('span', { class: 'muted small' }, ` ${link.text}`)))),
    h('button', { type: 'button', class: 'btn btn-sm btn-secondary', onclick: () => cy.elements().unselect() }, 'Back to the summary'));
}

function showDetail() {
  if (!ui.graph) return;
  const node = ui.selected && ui.graph.nodes.find((n) => n.id === ui.selected);
  $('detail').replaceChildren(node ? nodeDetail(ui.graph, node) : summary(ui.graph));
}

/** Fade everything but the selected node and its neighbours. */
function highlight() {
  cy.batch(() => {
    cy.elements().removeClass('faded');
    const node = ui.selected && cy.getElementById(ui.selected);
    if (!node || node.empty()) return;
    cy.elements().difference(node.closedNeighborhood()).addClass('faded');
  });
}

cy.on('select', 'node', (event) => {
  ui.selected = event.target.id();
  highlight();
  showDetail();
});
cy.on('unselect', 'node', () => {
  if (cy.nodes(':selected').nonempty()) return;
  ui.selected = null;
  highlight();
  showDetail();
});

/** The find box offers every node's label; picking one selects it. */
function showNames(graph) {
  const labels = [...new Set(graph.nodes.map((n) => n.label))].sort((a, b) => a.localeCompare(b));
  $('node-names').replaceChildren(...labels.map((label) => h('option', { value: label })));
}

function find() {
  const wanted = $('find').value.trim().toLowerCase();
  if (!wanted || !ui.graph) return;
  const node = ui.graph.nodes.find((n) => n.label.toLowerCase() === wanted)
    ?? ui.graph.nodes.find((n) => n.label.toLowerCase().includes(wanted));
  if (!node) return;
  ui.hidden.delete(node.kind);
  applyHidden();
  showLegend(ui.graph);
  select(node.id);
}

function showGraph(graph) {
  const first = ui.graph === null;
  const diff = diffElements(ui.elements, graph);
  cy.batch(() => {
    cy.remove(cy.collection(diff.remove.map((id) => cy.getElementById(id))));
    for (const element of diff.update) {
      const existing = cy.getElementById(element.data.id);
      existing.data(element.data);
      existing.classes(element.classes.join(' '));
    }
  });
  const added = cy.add(diff.add);
  ui.graph = graph;
  ui.elements = toElements(graph);
  ui.updatedAt = Date.now();
  applyHidden();
  if (first) arrange();
  else placeNew(added);
  highlight();
  showLegend(graph);
  showNames(graph);
  showDetail();
  const title = graph.title ?? (graph.cwd ? shortPath(graph.cwd) : 'Session');
  $('graph-title').textContent = title;
  document.title = `${title} · Graph · Switchyard`;
  $('graph-where').textContent = graph.cwd ? shortPath(graph.cwd) : '';
  $('updated').textContent = 'Live';
}

function showError(message) {
  $('errors').hidden = false;
  $('errors').replaceChildren(h('div', { class: 'error' }, message));
  $('updated').textContent = '';
}

/** Why the stream closed: the server answered with an error instead of events. */
async function explainFailure() {
  try {
    const body = await (await fetch(`/api/agents/graph?session=${encodeURIComponent(sessionId)}`)).json();
    showError(body.success ? 'Lost the live connection; reload to try again.' : body.error);
  } catch (error) {
    showError(`Can't reach switchyard: ${error.message}`);
  }
}

function connect() {
  const stream = new EventSource(`/api/agents/graph/stream?session=${encodeURIComponent(sessionId)}`);
  stream.addEventListener('graph', (event) => {
    $('errors').hidden = true;
    showGraph(JSON.parse(event.data));
  });
  stream.addEventListener('error', () => {
    if (stream.readyState === EventSource.CLOSED) explainFailure();
    else $('updated').textContent = ui.updatedAt ? `Reconnecting… (updated ${timeAgo(ui.updatedAt)})` : 'Connecting…';
  });
}

$('arrange').addEventListener('click', arrange);
$('find').addEventListener('change', find);
$('find').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') find();
});
$('fit').addEventListener('click', fit);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => cy.style(graphStyle()));

startNavBadges();
if (sessionId) connect();
else showError('No session given: open a graph from a session\'s Graph button on the Agents page.');
