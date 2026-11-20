import type { Tile } from '../../components/Tiles';
import type { Pr, PrsData } from './types';

/* Where each PR stands, and what the page lists. No React here, so it's tested on its own. */

export const STAGES: Record<string, { label: string; tone: string; group: string }> = {
  'merge-conflict': { label: 'Merge conflict', tone: 'red', group: 'fix' },
  'checks-failing': { label: 'Checks failing', tone: 'red', group: 'fix' },
  'changes-requested': { label: 'Changes requested', tone: 'red', group: 'fix' },
  ready: { label: 'Ready to merge', tone: 'green', group: 'ready' },
  blocked: { label: 'Approved · blocked', tone: 'amber', group: 'ready' },
  'needs-update': { label: 'Behind base', tone: 'amber', group: 'fix' },
  'checks-running': { label: 'Checks running', tone: 'amber', group: 'running' },
  'awaiting-review': { label: 'Awaiting review', tone: '', group: 'review' },
  draft: { label: 'Draft', tone: '', group: 'draft' },
  unknown: { label: 'Unavailable', tone: '', group: 'other' },
};

export const stageOf = (pr: Pr) => STAGES[pr.stage] ?? STAGES.unknown!;

export type PrFilter = 'all' | 'fix' | 'ready' | 'running' | 'review';

export const FILTERS: Record<PrFilter, { label: string; test: (pr: Pr) => boolean }> = {
  all: { label: 'All', test: () => true },
  fix: { label: 'Needs fixes', test: (pr) => STAGES[pr.stage]?.group === 'fix' },
  ready: { label: 'Ready to merge', test: (pr) => STAGES[pr.stage]?.group === 'ready' },
  running: { label: 'Checks running', test: (pr) => pr.stage === 'checks-running' },
  review: { label: 'Awaiting review', test: (pr) => pr.stage === 'awaiting-review' },
};

export const isPrFilter = (value: string): value is PrFilter => value in FILTERS;

/** Every word of the search in the PR's title, repo, number, branch or author. */
export function matchesQuery(pr: { title: string; repo: string; number: number; headRefName?: string; author?: { login?: string } | string | null }, query: string): boolean {
  if (!query) return true;
  const author = typeof pr.author === 'string' ? pr.author : pr.author?.login;
  const haystack = [pr.title, pr.repo, `#${pr.number}`, pr.headRefName, author].filter(Boolean).join(' ').toLowerCase();
  return query.toLowerCase().split(/\s+/).every((term) => haystack.includes(term));
}

export function prTiles(data: PrsData): Tile<PrFilter>[] {
  const count = (key: PrFilter) => data.authored.filter(FILTERS[key].test).length;
  return [
    { filter: 'ready', label: 'Ready to merge', value: count('ready'), tone: 'green' },
    { filter: 'fix', label: 'Need fixes', value: count('fix'), tone: 'red' },
    { filter: 'running', label: 'Checks running', value: count('running'), tone: 'amber' },
    { filter: 'review', label: 'Awaiting review', value: count('review') },
    { filter: 'all', label: 'Reviews requested of you', value: data.reviewRequested.length, tone: 'purple' },
  ];
}

export const visiblePrs = (prs: Pr[], filter: PrFilter, query: string): Pr[] => prs.filter((pr) => FILTERS[filter].test(pr) && matchesQuery(pr, query));
