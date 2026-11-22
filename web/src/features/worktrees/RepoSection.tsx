import type { Capabilities } from '../../lib/types';
import { useWorktreesUi } from './store';
import type { RepoGroup, WorktreeRow } from './types';
import { WorktreeRowView } from './WorktreeRowView';
import { Pill } from '../../components/Pill';
import { sepClass } from '../../components/classes';
import { cx } from '../../lib/cx';

/* A repo and its worktrees in the view: folded or open as you left it. */

const COLUMNS = [
  ['Worktree', 'w-[27%]'], ['Local', 'w-[14%]'], ['Pull request', 'w-[22%]'],
  ['Agent', 'w-[24%]'], ['Activity', 'w-[72px]'], ['', 'w-[196px]'],
] as const;

// The repo's name line, with a chevron that turns as the repo opens.
const SUMMARY = [
  'flex flex-wrap items-baseline gap-3 py-1 cursor-pointer list-none [&::-webkit-details-marker]:hidden',
  "before:content-[''] before:w-[5px] before:h-[5px] before:self-center before:border-r-[1.5px] before:border-b-[1.5px] before:border-gray-400",
  'before:[transform:rotate(-45deg)] before:[transition:transform_150ms_ease] [details[open]>&]:before:[transform:rotate(45deg)]',
].join(' ');

function RepoCounts({ repo, rows }: { repo: RepoGroup; rows: WorktreeRow[] }) {
  const live = rows.reduce((n, w) => n + w.agents.live.length, 0);
  const attention = rows.filter((w) => w.needsAttention).length;
  const cleanup = rows.filter((w) => w.flags.includes('cleanup')).length;
  return (
    <span className="flex flex-wrap items-baseline gap-2 text-xs">
      <span className="text-gray-500">{`${rows.length} of ${repo.worktrees.length} worktrees`}</span>
      {live > 0 && <span className={cx(sepClass, 'text-gray-500')}>{`${live} agent${live > 1 ? 's' : ''}`}</span>}
      {cleanup > 0 && <span className={cx(sepClass, 'text-gray-500')}>{`${cleanup} to clean up`}</span>}
      {attention > 0 && <Pill tone="red">{`${attention} need${attention > 1 ? '' : 's'} attention`}</Pill>}
    </span>
  );
}

export function RepoSection({ repo, rows, caps }: { repo: RepoGroup; rows: WorktreeRow[]; caps: Capabilities }) {
  const collapsed = useWorktreesUi((s) => s.collapsed.includes(repo.mainPath));
  const setCollapsed = useWorktreesUi((s) => s.setCollapsed);
  return (
    <details className="not-first:mt-4" open={!collapsed} onToggle={(event) => setCollapsed(repo.mainPath, !event.currentTarget.open)}>
      <summary className={SUMMARY}>
        <span className="text-base font-bold tracking-[-0.01em]">{repo.name}</span>
        {repo.github && <a href={`https://github.com/${repo.github}`} target="_blank" rel="noopener" className="text-gray-500 text-xs">{repo.github}</a>}
        <RepoCounts repo={repo} rows={rows} />
      </summary>
      <div className="overflow-x-auto mt-1 rounded-sm shadow-[inset_0_0_0_1px_var(--divider)]">
        <table>
          <colgroup>{COLUMNS.map(([, col]) => <col key={col} className={col} />)}</colgroup>
          <thead><tr>{COLUMNS.map(([label, col]) => <th key={col} scope="col">{label}</th>)}</tr></thead>
          <tbody>{rows.map((w) => <WorktreeRowView key={w.path} repo={repo} w={w} caps={caps} />)}</tbody>
        </table>
      </div>
    </details>
  );
}
