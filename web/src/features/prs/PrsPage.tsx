import { useIsFetching } from '@tanstack/react-query';
import { useDeferredValue } from 'react';
import { Errors, pageErrors } from '../../components/Errors';
import { LiveTime } from '../../components/LiveTime';
import { Panel } from '../../components/Panel';
import { RefreshButton } from '../../components/RefreshButton';
import { SearchBox } from '../../components/SearchBox';
import { Tiles } from '../../components/Tiles';
import { TopBar, TopBarStatus } from '../../components/TopBar';
import { cx } from '../../lib/cx';
import { PRS_KEY, refreshPrs, usePrs } from './api';
import { FILTERS, matchesQuery, prTiles, visiblePrs } from './filters';
import { PrCard } from './PrCard';
import { usePrsUi } from './store';
import { TeamList } from './TeamList';
import type { Pr, PrsData } from './types';
import { Empty } from '../../components/Empty';
import { filtersClass, stackedListClass } from '../../components/classes';

/* The pull requests page: yours, the ones waiting on your review, and your teams'. */

/** "● Live · GitHub checked 12s ago" while the stream is connected. */
function LiveStatus({ live, syncedAt }: { live: boolean; syncedAt?: number | null }) {
  return (
    <TopBarStatus>
      <span className={cx('inline-block size-1.5 mr-1.5 rounded-full align-middle', live ? 'bg-green shadow-[0_0_0_3px_color-mix(in_srgb,var(--green)_22%,transparent)]' : 'bg-gray-400')} title={live ? 'Receiving updates as they happen' : 'Reconnecting…'} />
      {live ? 'Live · ' : 'Reconnecting · '}
      {syncedAt ? <LiveTime since={syncedAt} prefix="GitHub checked " /> : 'Loading…'}
    </TopBarStatus>
  );
}

function PrList({ prs, emptyText, showAuthor, canAskCopilot, data }: {
  prs: Pr[]; emptyText: string; showAuthor: boolean; canAskCopilot: boolean; data: PrsData;
}) {
  if (prs.length === 0) return <Empty>{emptyText}</Empty>;
  return (
    <ul className={stackedListClass}>
      {prs.map((pr) => (
        <PrCard key={`${pr.repo}#${pr.number}`} pr={pr} showAuthor={showAuthor} canAskCopilot={canAskCopilot} caps={data.capabilities} />
      ))}
    </ul>
  );
}

function Lists({ data }: { data: PrsData }) {
  const filter = usePrsUi((s) => s.filter);
  const setQuery = usePrsUi((s) => s.setQuery);
  const query = useDeferredValue(usePrsUi((s) => s.query));
  const filtered = filter === 'all' ? '' : ` matching “${FILTERS[filter].label}”`;
  return (
    <>
      <Panel id="authored-title" title="My pull requests" head={(
        <div className={filtersClass}>
          <SearchBox placeholder="Filter title, repo, branch, author…" label="Filter pull requests" value={query} onChange={setQuery} />
        </div>
      )}>
        <div id="authored">
          <PrList prs={visiblePrs(data.authored, filter, query)} data={data} showAuthor={false} canAskCopilot
            emptyText={data.authored.length ? `No PRs${filtered}.` : 'You have no open pull requests.'} />
        </div>
      </Panel>
      <Panel id="review-title" title="Review requested from you" head={<span id="review-count" className="text-xs text-gray-500">{`${data.reviewRequested.length} open`}</span>}>
        <div id="review">
          <PrList prs={visiblePrs(data.reviewRequested, filter, query)} data={data} showAuthor canAskCopilot={false}
            emptyText={data.reviewRequested.length ? `No review requests${filtered}.` : 'No one is waiting on your review.'} />
        </div>
      </Panel>
      <TeamList prs={data.teamReviewRequested.filter((pr) => matchesQuery(pr, query))} />
    </>
  );
}

export function PrsPage() {
  const { data, error, live, streamError } = usePrs();
  const fetching = useIsFetching({ queryKey: PRS_KEY }) > 0;
  const filter = usePrsUi((s) => s.filter);
  const setFilter = usePrsUi((s) => s.setFilter);
  const errors = [
    ...pageErrors(data?.errors, error, 'pull requests'),
    ...(streamError ? [{ source: 'monitor', message: streamError }] : []),
  ];
  return (
    <>
      <TopBar current="/prs">
        <LiveStatus live={live} syncedAt={data?.syncedAt} />
        <RefreshButton busy={fetching} onRefresh={refreshPrs} />
      </TopBar>
      <main>
        <Errors errors={errors} />
        {data ? (
          <>
            <Tiles tiles={prTiles(data)} current={filter} onSelect={setFilter} all="all" />
            <Lists data={data} />
          </>
        ) : (
          <Panel id="authored-title" title="My pull requests"><div id="authored"><Empty>Loading pull requests from GitHub…</Empty></div></Panel>
        )}
      </main>
    </>
  );
}
