import { useEffect, useRef, useState } from 'react';
import { TopBar } from '../../components/TopBar';
import { shortPath } from '../../lib/paths';
import { timeAgo } from '../../lib/time';
import { useSessionGraph } from './api';
import { Detail } from './Detail';
import { GraphCanvas, type GraphCanvasHandle } from './GraphCanvas';
import { KINDS, kindCounts, type SessionGraph } from './model';
import { useGraphUi } from './store';
import { Button } from '../../components/Button';

/*
 * A session's context graph: your prompts in order, and the files, tools,
 * memory, skills and subagents each one brought into Claude's context. It
 * follows the session live.
 */

const sessionId = new URLSearchParams(window.location.search).get('session') ?? '';
// How long to give the browser to close the tab before taking it back to the sessions instead.
const CLOSE_WAIT_MS = 150;

/**
 * Close the graph tab. A browser lets a page close only a tab another page opened (the Graph
 * button's); a graph opened by its address goes back to the Agents page instead.
 */
function closeGraph() {
  window.close();
  setTimeout(() => {
    if (!window.closed) window.location.assign('/');
  }, CLOSE_WAIT_MS);
}

function Legend({ graph }: { graph: SessionGraph | undefined }) {
  const hidden = useGraphUi((s) => s.hidden);
  const setShown = useGraphUi((s) => s.setShown);
  const counts = graph ? kindCounts(graph) : {};
  return (
    <fieldset className="graph-legend" id="legend">
      <legend className="visually-hidden">Show</legend>
      {Object.entries(KINDS).filter(([kind]) => counts[kind] && kind !== 'session').map(([kind, { name }]) => (
        <label key={kind} className="graph-kind">
          <input type="checkbox" checked={!hidden.includes(kind)} onChange={(event) => setShown(kind, event.target.checked)} />
          <span className={`graph-swatch kind-${kind}`} aria-hidden="true" />
          {`${name} `}<span className="muted">{String(counts[kind])}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** The find box offers every node's label; picking one shows its kind if hidden, and selects it. */
function FindBox({ graph }: { graph: SessionGraph | undefined }) {
  const [text, setText] = useState('');
  const setShown = useGraphUi((s) => s.setShown);
  const select = useGraphUi((s) => s.select);
  const labels = [...new Set((graph?.nodes ?? []).map((n) => n.label))].sort((a, b) => a.localeCompare(b));
  const find = () => {
    const wanted = text.trim().toLowerCase();
    if (!wanted || !graph) return;
    const node = graph.nodes.find((n) => n.label.toLowerCase() === wanted) ?? graph.nodes.find((n) => n.label.toLowerCase().includes(wanted));
    if (!node) return;
    setShown(node.kind, true);
    select(node.id);
  };
  return (
    <>
      <input type="search" id="find" list="node-names" placeholder="Find a node…" aria-label="Find a node" autoComplete="off" spellCheck={false}
        value={text} onChange={(event) => setText(event.target.value)} onBlur={find} onKeyDown={(event) => { if (event.key === 'Enter') find(); }} />
      <datalist id="node-names">{labels.map((label) => <option key={label} value={label} />)}</datalist>
    </>
  );
}

function status({ graph, live, visible, updatedAt, error }: { graph?: SessionGraph; live: boolean; visible: boolean; updatedAt: number | null; error: string | null }): string {
  if (error) return '';
  if (!visible) return 'Paused while hidden';
  if (live && graph) return 'Live';
  return updatedAt ? `Reconnecting… (updated ${timeAgo(updatedAt)})` : 'Connecting…';
}

export function GraphPage() {
  const { graph, error, live, visible, updatedAt } = useSessionGraph(sessionId);
  const hidden = useGraphUi((s) => s.hidden);
  const selected = useGraphUi((s) => s.selected);
  const select = useGraphUi((s) => s.select);
  const canvas = useRef<GraphCanvasHandle>(null);
  const title = graph ? graph.title ?? (graph.cwd ? shortPath(graph.cwd) : 'Session') : 'Session graph';
  useEffect(() => {
    if (graph) document.title = `${title} · Graph · Switchyard`;
  }, [graph, title]);
  return (
    <>
      <TopBar current="/graph">
        <span id="updated" className="muted" aria-live="polite">{status({ graph, live, visible, updatedAt, error })}</span>
      </TopBar>
      <main className="graph-main">
        <div id="errors" className="errors" hidden={!error}>{error && <div className="error">{error}</div>}</div>
        <section className="panel graph-panel" aria-labelledby="graph-title">
          <div className="panel-head">
            <div className="stack">
              <h2 id="graph-title">{title}</h2>
              <span className="muted small" id="graph-where">{graph?.cwd ? shortPath(graph.cwd) : ''}</span>
            </div>
            <div className="filters">
              <FindBox graph={graph} />
              <Button type="button" variant="secondary" size="sm" id="arrange" title="Lay the whole graph out again" onClick={() => canvas.current?.arrange()}>Arrange</Button>
              <Button type="button" variant="secondary" size="sm" id="fit" title="Zoom to show every node" onClick={() => canvas.current?.fit()}>Fit</Button>
              <Button type="button" variant="secondary" size="sm" id="close" title="Close the graph and go back to your sessions" onClick={closeGraph}>Close</Button>
            </div>
          </div>
          <Legend graph={graph} />
          <div className="graph-body">
            <GraphCanvas ref={canvas} graph={graph} hidden={hidden} selected={selected} onSelect={select} />
            <Detail graph={graph} />
          </div>
        </section>
      </main>
    </>
  );
}
