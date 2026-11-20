import { shellQuote } from '../../lib/paths';
import { sessionSearchText } from '../../lib/shared';
import type { Tile } from '../../components/Tiles';
import type { RepoGroup, StateData, WorktreeRow } from './types';

/*
 * Which worktrees the page lists, and in what order. A worktree with activity
 * in the last three days counts as active, judged on the page's clock, so one
 * drops out of Active as time passes even when nothing new comes from the
 * server. No React here, so it's tested on its own.
 */

export const RECENT_MS = 3 * 24 * 60 * 60 * 1000;

export const isRecent = (w: WorktreeRow, now: number): boolean => Boolean(w.lastActivityAt) && now - (w.lastActivityAt ?? 0) < RECENT_MS;

const isActive = (w: WorktreeRow, now: number) => w.agents.live.length > 0
  || w.flags.includes('dirty')
  || w.flags.includes('cleanup')
  || w.pr?.state === 'OPEN'
  || isRecent(w, now);

export type View = 'active' | 'attention' | 'agents' | 'prs' | 'dirty' | 'cleanup' | 'all';

export const VIEWS: Record<View, { label: string; test: (w: WorktreeRow, now: number) => boolean }> = {
  active: { label: 'Active', test: isActive },
  attention: { label: 'Needs attention', test: (w) => Boolean(w.needsAttention) },
  agents: { label: 'Agents', test: (w) => w.agents.live.length > 0 || w.flags.includes('agent-interrupted') },
  prs: { label: 'Open PRs', test: (w) => w.pr?.state === 'OPEN' },
  dirty: { label: 'Uncommitted', test: (w) => w.flags.includes('dirty') },
  cleanup: { label: 'Clean up', test: (w) => w.flags.includes('cleanup') },
  all: { label: 'All', test: () => true },
};

export const SEGMENTED_VIEWS: View[] = ['active', 'attention', 'agents', 'cleanup', 'all'];
export const isView = (value: string): value is View => value in VIEWS;

export function matchesSearch(w: WorktreeRow, query: string): boolean {
  if (!query) return true;
  const haystack = [w.branch, w.path, w.pr?.title, w.pr && `#${w.pr.number}`, ...w.agents.live.flatMap(sessionSearchText)]
    .filter(Boolean).join(' ').toLowerCase();
  return query.toLowerCase().split(/\s+/).every((term) => haystack.includes(term));
}

export function summarize(state: StateData, now: number): Tile<View>[] {
  const worktrees = state.repos.flatMap((r) => r.worktrees);
  const count = (view: View) => worktrees.filter((w) => VIEWS[view].test(w, now)).length;
  return [
    { filter: 'attention', label: 'Need attention', value: count('attention'), tone: 'red' },
    { filter: 'prs', label: 'Worktrees with open PRs', value: count('prs'), tone: 'purple' },
    { filter: 'dirty', label: 'Uncommitted changes', value: count('dirty') },
    { filter: 'cleanup', label: 'Ready to clean up', value: count('cleanup') },
  ];
}

const byActivity = (a: WorktreeRow, b: WorktreeRow) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0);

/** The repos with worktrees in the view and search, busiest first, each with its worktrees busiest first. */
export function groupRepos(repos: RepoGroup[], { view, query, now }: { view: View; query: string; now: number }): { repo: RepoGroup; rows: WorktreeRow[] }[] {
  const { test } = VIEWS[view];
  return repos
    .map((repo) => ({ repo, rows: repo.worktrees.filter((w) => test(w, now) && matchesSearch(w, query)).sort(byActivity) }))
    .filter((g) => g.rows.length > 0)
    .sort((a, b) => byActivity(a.rows[0]!, b.rows[0]!));
}

/** What Clean up runs, to copy instead. Squash merges leave the branch "unmerged" to git, so -D; a closed PR's branch is kept. */
export function cleanupCommand(repo: Pick<RepoGroup, 'mainPath'>, w: WorktreeRow): string {
  const steps = [`git -C ${shellQuote(repo.mainPath)} worktree remove ${shellQuote(w.path)}`];
  if (w.branch && w.pr?.state === 'MERGED') steps.push(`git -C ${shellQuote(repo.mainPath)} branch -D ${shellQuote(w.branch)}`);
  return steps.join(' && ');
}
