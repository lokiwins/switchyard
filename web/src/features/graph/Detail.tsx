import { formatShare, formatTokens, KINDS, kindCounts, nodeConnections, tokenBreakdown, type GraphNode, type SessionGraph, type ShareRow } from './model';
import { useGraphUi } from './store';

/* Beside the graph: the session at a glance and what fills its context, or the selected node and what it connects to. */

const BAR_WIDTH = 1000;
const BAR_HEIGHT = 10;
const BAR_GAP = 2;

const plural = (count = 0, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
const Swatch = ({ kind }: { kind: string }) => <span className={`graph-swatch kind-${kind}`} aria-hidden="true" />;

/** A thin bar of the shares, no text on it: the rows below carry the figures. A gap separates segments. */
function ShareBar({ rows }: { rows: ShareRow[] }) {
  // Each segment starts where the shares before it end.
  const starts = rows.map((_, i) => rows.slice(0, i).reduce((x, before) => x + before.share * BAR_WIDTH, 0));
  return (
    <svg className="graph-bar" viewBox={`0 0 ${BAR_WIDTH} ${BAR_HEIGHT}`} preserveAspectRatio="none" role="img" aria-label="What fills the context now">
      {rows.map((row, i) => (
        <rect key={row.kind} x={starts[i]!.toFixed(1)} y={0} width={Math.max(0, row.share * BAR_WIDTH - BAR_GAP).toFixed(1)} height={BAR_HEIGHT} rx={2} className={`kind-${row.kind}`}>
          <title>{`${row.name}: ~${formatTokens(row.tokens)} tokens (${formatShare(row.share)})`}</title>
        </rect>
      ))}
    </svg>
  );
}

/** What's in context now: the size Claude last reported, and what fills it by kind. */
function ContextBreakdown({ graph }: { graph: SessionGraph }) {
  const breakdown = tokenBreakdown(graph);
  if (breakdown.total === 0) return null;
  return (
    <div className="graph-context">
      <h3>In context now</h3>
      <p className="graph-context-figure">{`${breakdown.reported ? '' : '~'}${formatTokens(breakdown.total)} `}<span className="muted">tokens</span></p>
      <p className="small muted">
        {breakdown.reported
          ? 'As Claude reported on its last call. The parts are estimated from what each put into context.'
          : 'Estimated from what each part put into context; Claude hasn\'t reported a size yet.'}
      </p>
      <ShareBar rows={breakdown.rows} />
      <ul className="graph-shares">
        {breakdown.rows.map((row) => (
          <li key={row.kind}>
            <Swatch kind={row.kind} /><span>{row.name}</span>
            <span className="num">{`~${formatTokens(row.tokens)}`}</span><span className="num muted">{formatShare(row.share)}</span>
          </li>
        ))}
      </ul>
      {graph.compactions > 0 && (
        <p className="small muted">{`Counting what compactions dropped, your prompts, files, tools and the rest put ~${formatTokens(breakdown.session)} tokens into context over the whole session.`}</p>
      )}
    </div>
  );
}

function Summary({ graph }: { graph: SessionGraph }) {
  const counts = kindCounts(graph);
  const out = graph.nodes.filter((n) => !n.inContext).length;
  return (
    <div className="stack graph-summary">
      <h3>This session</h3>
      <p className="small">{`${[
        plural(counts.prompt, 'prompt'), plural(counts.file, 'file'), plural(counts.tool, 'tool'),
        plural(counts.memory, 'memory or instruction file'), plural(counts.skill, 'skill'), plural(counts.subagent, 'subagent'),
      ].join(', ')}.`}</p>
      {graph.compactions > 0
        ? <p className="small">{`Compacted ${graph.compactions} time${graph.compactions > 1 ? 's' : ''}. Faded nodes were last used before the latest compaction, so they're no longer in context (${out}).`}</p>
        : <p className="small">Never compacted: everything shown is still in context.</p>}
      <p className="small muted">Click a node to see what it is and what it connects to. Bigger nodes put more into context.</p>
      <ContextBreakdown graph={graph} />
    </div>
  );
}

function tokenLine(graph: SessionGraph, node: GraphNode): string {
  if (!node.tokens) {
    const bySubagent = graph.edges.some((e) => e.target === node.id && e.source.startsWith('agent:'));
    return bySubagent ? 'No tokens in the main context: what a subagent reads stays in its own.' : 'No tokens counted yet.';
  }
  const now = node.liveTokens === node.tokens ? 'all still in context'
    : node.liveTokens === 0 ? 'none of it still in context' : `~${formatTokens(node.liveTokens ?? 0)} still in context`;
  return `~${formatTokens(node.tokens)} tokens into context, ${now}.`;
}

function NodeDetail({ graph, node }: { graph: SessionGraph; node: GraphNode }) {
  const select = useGraphUi((s) => s.select);
  const kind = KINDS[node.kind]?.name ?? node.kind;
  const links = nodeConnections(graph, node.id);
  return (
    <div className="stack graph-node">
      <h3>{node.group ? `${kind} · ${node.group}` : kind}</h3>
      <p className="graph-node-label">{node.label}</p>
      {node.detail && node.detail !== node.label && <p className={node.kind === 'prompt' ? 'small' : 'small mono'}>{node.detail}</p>}
      <p className="small muted">
        {[node.kind === 'session' ? null : `Used ${node.uses} time${node.uses === 1 ? '' : 's'}`,
          node.inContext ? 'in context' : 'no longer in context (before the last compaction)'].filter(Boolean).join(' · ')}
      </p>
      {node.kind !== 'session' && <p className="small">{tokenLine(graph, node)}</p>}
      {links.length > 0 && (
        <>
          <h3>{`Connections (${links.length})`}</h3>
          <ul className="graph-links">
            {links.map((link) => (
              <li key={link.id}>
                <Swatch kind={link.kind} />
                <button type="button" className="graph-link" title="Show this node" onClick={() => select(link.id)}>{link.label}</button>
                <span className="muted small">{` ${link.text}`}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <button type="button" className="btn btn-sm btn-secondary" onClick={() => select(null)}>Back to the summary</button>
    </div>
  );
}

export function Detail({ graph }: { graph: SessionGraph | undefined }) {
  const selected = useGraphUi((s) => s.selected);
  const node = selected ? graph?.nodes.find((n) => n.id === selected) : undefined;
  return (
    <aside className="graph-detail" id="detail" aria-live="polite">
      {graph && (node ? <NodeDetail graph={graph} node={node} /> : <Summary graph={graph} />)}
    </aside>
  );
}
