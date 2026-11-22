import { LiveTime } from '../../components/LiveTime';
import type { TeamPr } from './types';
import { panelClass, panelHeadClass } from '../../components/Panel';
import { cx } from '../../lib/cx';

/** Review requests to your teams, folded away until opened; the native <details> keeps itself open through updates. */
export function TeamList({ prs }: { prs: TeamPr[] }) {
  return (
    <section className={panelClass} aria-labelledby="team-title">
      <details id="team-details">
        <summary className={cx(panelHeadClass, 'team-summary')}>
          <h2 id="team-title">Requested from your teams</h2>
          <span id="team-count" className="text-xs text-gray-500">{`${prs.length} open`}</span>
        </summary>
        <ul id="team" className="list">
          {prs.length === 0 ? <li className="muted">Nothing waiting on your teams.</li> : prs.map((pr) => (
            <li key={pr.url} className="team-row">
              <a href={pr.url} target="_blank" rel="noopener" className="team-title">{pr.title}</a>
              <span className="pr-meta">
                <span className="mono">{`${pr.repo.split('/').pop()}#${pr.number}`}</span>
                {pr.isDraft && <span className="sep">draft</span>}
                {pr.author && <span className="sep">{pr.author}</span>}
                {(pr.commentsCount ?? 0) > 0 && <span className="sep">{`${pr.commentsCount} comment${pr.commentsCount! > 1 ? 's' : ''}`}</span>}
                <LiveTime since={Date.parse(pr.updatedAt)} prefix="updated " className="sep" />
              </span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
