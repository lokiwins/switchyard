import type { Capabilities } from '../../lib/types';
import { useWorktreesUi } from './store';
import type { RepoGroup, WorktreeRow } from './types';
import { WorktreeRowView } from './WorktreeRowView';

/* A repo and its worktrees in the view: folded or open as you left it. */

const COLUMNS = [
  ['Worktree', 'col-branch'], ['Local', 'col-local'], ['Pull request', 'col-pr'],
  ['Agent', 'col-agent'], ['Activity', 'col-activity'], ['', 'col-actions'],
] as const;

function RepoCounts({ repo, rows }: { repo: RepoGroup; rows: WorktreeRow[] }) {
  const live = rows.reduce((n, w) => n + w.agents.live.length, 0);
  const attention = rows.filter((w) => w.needsAttention).length;
  const cleanup = rows.filter((w) => w.flags.includes('cleanup')).length;
  return (
    <span className="repo-meta">
      <span className="muted">{`${rows.length} of ${repo.worktrees.length} worktrees`}</span>
      {live > 0 && <span className="muted sep">{`${live} agent${live > 1 ? 's' : ''}`}</span>}
      {cleanup > 0 && <span className="muted sep">{`${cleanup} to clean up`}</span>}
      {attention > 0 && <span className="pill red">{`${attention} need${attention > 1 ? '' : 's'} attention`}</span>}
    </span>
  );
}

export function RepoSection({ repo, rows, caps }: { repo: RepoGroup; rows: WorktreeRow[]; caps: Capabilities }) {
  const collapsed = useWorktreesUi((s) => s.collapsed.includes(repo.mainPath));
  const setCollapsed = useWorktreesUi((s) => s.setCollapsed);
  return (
    <details className="repo" open={!collapsed} onToggle={(event) => setCollapsed(repo.mainPath, !event.currentTarget.open)}>
      <summary>
        <span className="repo-name">{repo.name}</span>
        {repo.github && <a href={`https://github.com/${repo.github}`} target="_blank" rel="noopener" className="repo-link">{repo.github}</a>}
        <RepoCounts repo={repo} rows={rows} />
      </summary>
      <div className="table-wrap">
        <table>
          <colgroup>{COLUMNS.map(([, col]) => <col key={col} className={col} />)}</colgroup>
          <thead><tr>{COLUMNS.map(([label, col]) => <th key={col} scope="col">{label}</th>)}</tr></thead>
          <tbody>{rows.map((w) => <WorktreeRowView key={w.path} repo={repo} w={w} caps={caps} />)}</tbody>
        </table>
      </div>
    </details>
  );
}
