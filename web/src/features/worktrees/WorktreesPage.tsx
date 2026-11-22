import { useIsFetching } from '@tanstack/react-query';
import { useDeferredValue } from 'react';
import { Errors, pageErrors } from '../../components/Errors';
import { LiveTime } from '../../components/LiveTime';
import { Panel } from '../../components/Panel';
import { RefreshButton } from '../../components/RefreshButton';
import { SearchBox } from '../../components/SearchBox';
import { Segmented } from '../../components/Segmented';
import { Tiles } from '../../components/Tiles';
import { TopBar, TopBarStatus } from '../../components/TopBar';
import { shortPath } from '../../lib/paths';
import { useNow } from '../../lib/time';
import { refreshBoard, STATE_KEY, useBoard } from './api';
import { RepoSection } from './RepoSection';
import { useWorktreesUi } from './store';
import type { OrphanPr, StateData } from './types';
import { groupRepos, SEGMENTED_VIEWS, summarize, VIEWS } from './views';
import { Button } from '../../components/Button';
import { Pill } from '../../components/Pill';

/* The Worktrees page: every checkout under the roots, its branch, PR and sessions; and your PRs with no checkout here. */

const CHOICES = SEGMENTED_VIEWS.map((key) => ({ key, label: VIEWS[key].label }));

function Repos({ data, query }: { data: StateData; query: string }) {
  const view = useWorktreesUi((s) => s.view);
  const setView = useWorktreesUi((s) => s.setView);
  const setQuery = useWorktreesUi((s) => s.setQuery);
  // "Recent" is judged on the page's clock, so a worktree leaves Active as it ages out, with no new data.
  const now = useNow();
  const groups = groupRepos(data.repos, { view, query, now });
  return (
    <Panel id="worktrees-title" title="Worktrees" head={(
      <div className="filters">
        <SearchBox placeholder="Filter branch, path, PR…" label="Filter worktrees" value={query} onChange={setQuery} />
        <Segmented choices={CHOICES} value={view} onChange={setView} label="Show"
          extra={SEGMENTED_VIEWS.includes(view) ? null : { label: VIEWS[view].label, onClear: () => setView('all') }} />
      </div>
    )}>
      <div id="repos">
        {groups.length === 0 ? (
          <div className="empty">
            <p>No worktrees match this view.</p>
            {(view !== 'all' || query) && (
              <Button type="button" variant="secondary" size="sm" onClick={() => {
                setQuery('');
                setView('all');
              }}>Show all worktrees</Button>
            )}
          </div>
        ) : groups.map(({ repo, rows }) => <RepoSection key={repo.mainPath} repo={repo} rows={rows} caps={data.capabilities} />)}
      </div>
    </Panel>
  );
}

function OrphanPrs({ prs }: { prs: OrphanPr[] }) {
  return (
    <Panel id="orphans-title" panelId="orphans-panel" title="My open PRs without a local worktree" hidden={prs.length === 0}>
      <ul id="orphans" className="plain-list">
        {prs.map((pr) => (
          <li key={pr.url} className="row">
            <a href={pr.url} target="_blank" rel="noopener" className="mono">{`${pr.repository.nameWithOwner}#${pr.number}`}</a>
            {pr.isDraft && <Pill>Draft</Pill>}
            <span>{pr.title}</span>
            <LiveTime since={Date.parse(pr.updatedAt)} prefix="updated " className="small muted" />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function BoardTiles({ data }: { data: StateData }) {
  const view = useWorktreesUi((s) => s.view);
  const setView = useWorktreesUi((s) => s.setView);
  const now = useNow();
  return <Tiles tiles={summarize(data, now)} current={view} onSelect={setView} all="all" pressedHint="Click again to show all worktrees" />;
}

export function WorktreesPage() {
  const { data, error } = useBoard();
  const fetching = useIsFetching({ queryKey: STATE_KEY }) > 0;
  const query = useDeferredValue(useWorktreesUi((s) => s.query));
  return (
    <>
      <TopBar current="/worktrees" brand={{ id: 'roots', text: data ? `Scanning ${data.roots.map(shortPath).join(', ')}` : '' }}>
        <TopBarStatus>{data ? <LiveTime since={data.generatedAt} prefix="Updated " /> : 'Loading…'}</TopBarStatus>
        <RefreshButton busy={fetching} onRefresh={refreshBoard} />
      </TopBar>
      <main>
        <Errors errors={pageErrors(data?.errors, error, 'state')} />
        {data ? (
          <>
            <BoardTiles data={data} />
            <Repos data={data} query={query} />
            <OrphanPrs prs={data.prsWithoutWorktree} />
          </>
        ) : (
          <Panel id="worktrees-title" title="Worktrees"><div id="repos"><div className="empty">Scanning worktrees, PRs and agent sessions…</div></div></Panel>
        )}
      </main>
    </>
  );
}
