import { LiveTime } from '../../components/LiveTime';
import type { TeamPr } from './types';
import { panelClass, panelHeadClass } from '../../components/Panel';
import { cx } from '../../lib/cx';
import { sepClass, stackedListClass } from '../../components/classes';
import { metaClass } from './PrCard';

/** Review requests to your teams, folded away until opened; the native <details> keeps itself open through updates. */
export function TeamList({ prs }: { prs: TeamPr[] }) {
  return (
    <section className={panelClass} aria-labelledby="team-title">
      <details id="team-details">
        <summary className={cx(panelHeadClass, 'list-none cursor-pointer [&::-webkit-details-marker]:hidden [details[open]>&]:mb-1')}>
          <h2 id="team-title">Requested from your teams</h2>
          <span id="team-count" className="text-xs text-gray-500">{`${prs.length} open`}</span>
        </summary>
        <ul id="team" className={stackedListClass}>
          {prs.length === 0 ? <li className="text-gray-500">Nothing waiting on your teams.</li> : prs.map((pr) => (
            <li key={pr.url} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-baseline py-1.5 px-2 -mx-2 hover:bg-hover max-phone:grid-cols-1">
              <a href={pr.url} target="_blank" rel="noopener" className="truncate text-gray-900 font-medium text-sm">{pr.title}</a>
              <span className={metaClass}>
                <span className="font-mono text-[11.5px]">{`${pr.repo.split('/').pop()}#${pr.number}`}</span>
                {pr.isDraft && <span className={sepClass}>draft</span>}
                {pr.author && <span className={sepClass}>{pr.author}</span>}
                {(pr.commentsCount ?? 0) > 0 && <span className={sepClass}>{`${pr.commentsCount} comment${pr.commentsCount! > 1 ? 's' : ''}`}</span>}
                <LiveTime since={Date.parse(pr.updatedAt)} prefix="updated " className={sepClass} />
              </span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
