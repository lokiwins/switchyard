import { formatShare, formatTokens, KINDS, kindCounts, nodeConnections, tokenBreakdown, type GraphNode, type SessionGraph, type ShareRow } from './model';
import { useGraphUi } from './store';
import { Button } from '../../components/Button';
import { cx } from '../../lib/cx';
import { kindFillClass, kindSwatchClass } from './kinds';

/* Beside the graph: the session at a glance and what fills its context, or the selected node and what it connects to. */

const BAR_WIDTH = 1000;
const BAR_HEIGHT = 10;
const BAR_GAP = 2;

// A connection: a link-coloured button that shows that node.
const LINK = [
  'p-0 border-0 bg-transparent cursor-pointer [font-family:inherit] [line-height:inherit] text-xs text-accent text-left',
  '[overflow-wrap:anywhere] min-w-0 hover:underline',
].join(' ');

const plural = (count = 0, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
// The panel's small print, and its quieter parts.
const SMALL = 'text-xs leading-xs';
const MUTED = 'text-gray-500';
const FIGURE = 'font-mono text-[11.5px] font-semibold tabular-nums text-right';
// A column of facts; in the panel, a little apart.
const STACK = 'grid gap-2 justify-items-start min-w-0';

const Swatch = ({ kind, className }: { kind: string; className?: string }) => <span className={cx(kindSwatchClass(kind), className)} aria-hidden="true" />;

/** A thin bar of the shares, no text on it: the rows below carry the figures. A gap separates segments. */
function ShareBar({ rows }: { rows: ShareRow[] }) {
  // Each segment starts where the shares before it end.
  const starts = rows.map((_, i) => rows.slice(0, i).reduce((x, before) => x + before.share * BAR_WIDTH, 0));
  return (
    <svg className="block w-full h-2.5" viewBox={`0 0 ${BAR_WIDTH} ${BAR_HEIGHT}`} preserveAspectRatio="none" role="img" aria-label="What fills the context now">
      {rows.map((row, i) => (
        <rect key={row.kind} x={starts[i]!.toFixed(1)} y={0} width={Math.max(0, row.share * BAR_WIDTH - BAR_GAP).toFixed(1)} height={BAR_HEIGHT} rx={2} className={kindFillClass(row.kind)}>
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
    <div className="grid gap-2 w-full">
      <h3>In context now</h3>
      <p className="text-[28px] leading-[32px] font-bold tracking-[-0.02em] tabular-nums">
        {`${breakdown.reported ? '' : '~'}${formatTokens(breakdown.total)} `}<span className={cx('text-sm font-medium [letter-spacing:0]', MUTED)}>tokens</span>
      </p>
      <p className={cx(SMALL, MUTED)}>
        {breakdown.reported
          ? 'As Claude reported on its last call. The parts are estimated from what each put into context.'
          : 'Estimated from what each part put into context; Claude hasn\'t reported a size yet.'}
      </p>
      <ShareBar rows={breakdown.rows} />
      <ul className="list-none m-0 p-0 grid gap-0.5 text-xs">
        {breakdown.rows.map((row) => (
          <li key={row.kind} className="grid grid-cols-[10px_minmax(0,1fr)_auto_3.5em] gap-1.5 items-center">
            <Swatch kind={row.kind} /><span>{row.name}</span>
            <span className={FIGURE}>{`~${formatTokens(row.tokens)}`}</span><span className={cx(FIGURE, MUTED)}>{formatShare(row.share)}</span>
          </li>
        ))}
      </ul>
      {graph.compactions > 0 && (
        <p className={cx(SMALL, MUTED)}>{`Counting what compactions dropped, your prompts, files, tools and the rest put ~${formatTokens(breakdown.session)} tokens into context over the whole session.`}</p>
      )}
    </div>
  );
}

function Summary({ graph }: { graph: SessionGraph }) {
  const counts = kindCounts(graph);
  const out = graph.nodes.filter((n) => !n.inContext).length;
  return (
    <div className={STACK}>
      <h3>This session</h3>
      <p className={SMALL}>{`${[
        plural(counts.prompt, 'prompt'), plural(counts.file, 'file'), plural(counts.tool, 'tool'),
        plural(counts.memory, 'memory or instruction file'), plural(counts.skill, 'skill'), plural(counts.subagent, 'subagent'),
      ].join(', ')}.`}</p>
      {graph.compactions > 0
        ? <p className={SMALL}>{`Compacted ${graph.compactions} time${graph.compactions > 1 ? 's' : ''}. Faded nodes were last used before the latest compaction, so they're no longer in context (${out}).`}</p>
        : <p className={SMALL}>Never compacted: everything shown is still in context.</p>}
      <p className={cx(SMALL, MUTED)}>Click a node to see what it is and what it connects to. Bigger nodes put more into context.</p>
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
    <div className={STACK}>
      <h3>{node.group ? `${kind} · ${node.group}` : kind}</h3>
      <p className="font-semibold">{node.label}</p>
      {node.detail && node.detail !== node.label && <p className={cx(SMALL, node.kind !== 'prompt' && 'font-mono')}>{node.detail}</p>}
      <p className={cx(SMALL, MUTED)}>
        {[node.kind === 'session' ? null : `Used ${node.uses} time${node.uses === 1 ? '' : 's'}`,
          node.inContext ? 'in context' : 'no longer in context (before the last compaction)'].filter(Boolean).join(' · ')}
      </p>
      {node.kind !== 'session' && <p className={SMALL}>{tokenLine(graph, node)}</p>}
      {links.length > 0 && (
        <>
          <h3>{`Connections (${links.length})`}</h3>
          <ul className="list-none m-0 p-0 grid gap-1 w-full">
            {links.map((link) => (
              <li key={link.id} className="flex items-baseline gap-1.5 min-w-0">
                <Swatch kind={link.kind ?? 'other'} className="self-center" />
                <button type="button" className={LINK} title="Show this node" onClick={() => select(link.id)}>{link.label}</button>
                <span className={cx(SMALL, MUTED)}>{` ${link.text}`}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <Button type="button" variant="secondary" size="sm" onClick={() => select(null)}>Back to the summary</Button>
    </div>
  );
}

export function Detail({ graph }: { graph: SessionGraph | undefined }) {
  const selected = useGraphUi((s) => s.selected);
  const node = selected ? graph?.nodes.find((n) => n.id === selected) : undefined;
  return (
    // Beside the graph, scrolling within its height; under it, narrower than a tablet, at its full length.
    <aside className="min-w-0 max-h-[calc(100vh-210px)] overflow-y-auto text-sm max-narrow:max-h-none [&_p]:m-0 [&_p]:[overflow-wrap:anywhere]" id="detail" aria-live="polite">
      {graph && (node ? <NodeDetail graph={graph} node={node} /> : <Summary graph={graph} />)}
    </aside>
  );
}
