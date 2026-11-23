import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
import { useEffect, useEffectEvent, useImperativeHandle, useRef, type Ref } from 'react';
import { useAppearance } from '../../lib/appearance';
import { diffElements, layoutSteps, toElements, type SessionGraph } from './model';
import { graphStyle } from './style';

/*
 * The graph itself, drawn by Cytoscape. The component owns the Cytoscape
 * instance and keeps it in step with the data: a live update only adds,
 * changes or removes what changed, and new nodes appear beside what they
 * connect to, so the rest stays where you left it. Arrange lays the whole
 * graph out again.
 */

/* The canvas: a sunken box most of the window tall; narrower than a tablet, a little over half of it. */
const CANVAS = [
  'relative h-[calc(100vh-210px)] min-h-[420px] rounded-sm bg-surface-sunken shadow-[inset_0_0_0_1px_var(--divider)]',
  'max-narrow:h-[60vh] max-narrow:min-h-[320px]',
].join(' ');

export interface GraphCanvasHandle { arrange: () => void; fit: () => void }

const LAYOUT = { name: 'cose', animate: false, nodeDimensionsIncludeLabels: false, idealEdgeLength: 90, nodeRepulsion: 20000, gravity: 0.3, padding: 24 };
const NEW_NODE_SPREAD = 60;
// Selecting a node zooms in at least this far, so its label and its neighbours' are readable.
const SELECT_ZOOM = 1;
// A small graph fitted to the screen would be drawn huge; past this zoom it is centred instead.
const MAX_FIT_ZOOM = 1.2;
const FIT_PADDING = 24;
const MIN_ARRANGE_RADIUS = 100;
const RADIUS_PER_NODE = 4;
const SELECT_MS = 200;

function fit(cy: Core) {
  cy.fit(cy.nodes(':visible'), FIT_PADDING);
  if (cy.zoom() > MAX_FIT_ZOOM) {
    cy.zoom(MAX_FIT_ZOOM);
    cy.center(cy.nodes(':visible'));
  }
}

/** Lay everything out from the same start (round a circle in the server's order), so a graph comes out the same each time. */
function arrange(cy: Core) {
  const nodes = cy.nodes();
  const radius = Math.max(MIN_ARRANGE_RADIUS, nodes.length * RADIUS_PER_NODE);
  nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / nodes.length;
    node.position({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
  });
  cy.layout({ ...LAYOUT, numIter: layoutSteps(nodes.length), randomize: false, fit: false } as cytoscape.LayoutOptions).run();
  fit(cy);
}

/** Apply the next graph as a diff; true when this was the first. */
function update(cy: Core, shown: { current: ElementDefinition[] }, graph: SessionGraph): boolean {
  const first = shown.current.length === 0;
  const diff = diffElements(shown.current, graph);
  cy.batch(() => {
    for (const id of diff.remove) cy.getElementById(id).remove();
    for (const element of diff.update) {
      const existing = cy.getElementById(String(element.data.id));
      existing.data(element.data);
      existing.classes(element.classes.join(' '));
    }
  });
  const added = cy.add(diff.add);
  shown.current = toElements(graph);
  if (first) {
    arrange(cy);
    return true;
  }
  for (const node of added.nodes()) {
    const anchor = node.neighborhood().difference(added).nodes();
    const base = anchor.nonempty() ? anchor.first().position() : { x: cy.width() / 2, y: cy.height() / 2 };
    const angle = Math.random() * 2 * Math.PI;
    node.position({ x: base.x + NEW_NODE_SPREAD * Math.cos(angle), y: base.y + NEW_NODE_SPREAD * Math.sin(angle) });
  }
  return false;
}

export function GraphCanvas({ graph, hidden, selected, onSelect, ref }: {
  graph: SessionGraph | undefined;
  hidden: string[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  ref?: Ref<GraphCanvasHandle>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const shown = useRef<{ current: ElementDefinition[] }>({ current: [] });
  const appearance = useAppearance();
  const selectedHere = useEffectEvent((id: string | null) => onSelect(id));

  // The instance lives as long as the page; selecting a node is told back to the page.
  useEffect(() => {
    if (!container.current) return undefined;
    const cy = cytoscape({ container: container.current, style: graphStyle(), wheelSensitivity: 0.3, minZoom: 0.05, maxZoom: 4 });
    cyRef.current = cy;
    shown.current = { current: [] };
    cy.on('select', 'node', (event) => selectedHere(event.target.id()));
    cy.on('unselect', 'node', () => {
      if (cy.nodes(':selected').empty()) selectedHere(null);
    });
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  useEffect(() => {
    const cy = cyRef.current;
    if (cy && graph) update(cy, shown.current, graph);
  }, [graph]);

  useEffect(() => {
    const cy = cyRef.current;
    cy?.batch(() => cy.nodes().forEach((n) => { n.toggleClass('kind-hidden', hidden.includes(n.data('kind'))); }));
  }, [hidden, graph]);

  // The selected node and its neighbours stand out; the rest fades. Selecting from the page (a link, Find) zooms to it.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const node = selected ? cy.getElementById(selected) : null;
    cy.batch(() => {
      cy.elements().removeClass('faded');
      if (node && node.nonempty()) cy.elements().difference(node.closedNeighborhood()).addClass('faded');
    });
    if (!node || node.empty()) {
      cy.elements(':selected').unselect();
    } else if (!node.selected()) {
      cy.elements().unselect();
      node.select();
      cy.animate({ zoom: { level: Math.max(cy.zoom(), SELECT_ZOOM), position: node.position() }, center: { eles: node } }, { duration: SELECT_MS });
    }
  }, [selected, graph]);

  // A new theme or light/dark redraws the graph in its colours.
  useEffect(() => {
    cyRef.current?.style(graphStyle());
  }, [appearance?.theme, appearance?.mode]);

  useImperativeHandle(ref, () => ({
    arrange: () => { if (cyRef.current) arrange(cyRef.current); },
    fit: () => { if (cyRef.current) fit(cyRef.current); },
  }), []);

  // `relative` is Cytoscape's own rule for its container, which the page's CSP keeps it from adding (see graph.html).
  return <div ref={container} id="graph" className={CANVAS} role="img" aria-label="The session's context graph" />;
}
