import { describe, expect, it } from 'vitest';
import type { LiveSession } from '../../lib/types';
import type { RepoGroup, WorktreeRow } from './types';
import { cleanupCommand, groupRepos, isRecent, matchesSearch, RECENT_MS, summarize } from './views';

const NOW = Date.UTC(2026, 10, 20);
const wt = (path: string, extra: Partial<WorktreeRow> = {}): WorktreeRow => ({ path, flags: [], agents: { live: [] }, ...extra });

describe('isRecent', () => {
  it('counts activity in the last three days, by the page\'s clock', () => {
    expect(isRecent(wt('/a', { lastActivityAt: NOW - RECENT_MS + 1 }), NOW)).toBe(true);
    expect(isRecent(wt('/a', { lastActivityAt: NOW - RECENT_MS }), NOW)).toBe(false);
    expect(isRecent(wt('/a'), NOW)).toBe(false);
  });
});

describe('groupRepos', () => {
  const repos: RepoGroup[] = [
    { name: 'quiet', mainPath: '/quiet', worktrees: [wt('/quiet', { lastActivityAt: NOW - 10 * RECENT_MS })] },
    { name: 'busy', mainPath: '/busy', worktrees: [
      wt('/busy', { lastActivityAt: NOW - 1000 }),
      wt('/busy-old', { lastActivityAt: NOW - 5 * RECENT_MS, flags: ['dirty'] }),
      wt('/busy-new', { lastActivityAt: NOW - 10, branch: 'fix-login' }),
    ] },
  ];

  it('lists active worktrees, busiest repo and worktree first', () => {
    expect(groupRepos(repos, { view: 'active', query: '', now: NOW }).map((g) => [g.repo.name, g.rows.map((w) => w.path)]))
      .toEqual([['busy', ['/busy-new', '/busy', '/busy-old']]]);
  });

  it('a worktree drops out of Active once its activity is three days old', () => {
    expect(groupRepos(repos, { view: 'active', query: '', now: NOW + RECENT_MS })[0]!.rows.map((w) => w.path)).toEqual(['/busy-old']);
  });

  it('filters by search, and All shows everything', () => {
    expect(groupRepos(repos, { view: 'all', query: 'login', now: NOW }).map((g) => g.rows.map((w) => w.path))).toEqual([['/busy-new']]);
    expect(groupRepos(repos, { view: 'all', query: '', now: NOW }).flatMap((g) => g.rows)).toHaveLength(4);
  });
});

describe('matchesSearch', () => {
  it('finds a worktree by its PR and its sessions\' words', () => {
    const w = wt('/x', { pr: { number: 7, url: '', title: 'Dark mode', state: 'OPEN' }, agents: { live: [{ transcript: { title: 'Toggle theme' } } as LiveSession] } });
    expect(matchesSearch(w, '#7 dark')).toBe(true);
    expect(matchesSearch(w, 'toggle')).toBe(true);
    expect(matchesSearch(w, 'light')).toBe(false);
  });
});

describe('summarize', () => {
  it('counts what needs attention, open PRs, uncommitted and clean-ups', () => {
    const state = { repos: [{ name: 'r', mainPath: '/r', worktrees: [
      wt('/1', { needsAttention: true, flags: ['dirty'] }), wt('/2', { pr: { number: 1, url: '', title: '', state: 'OPEN' } }), wt('/3', { flags: ['cleanup'] }),
    ] }] } as Parameters<typeof summarize>[0];
    expect(summarize(state, NOW).map((t) => t.value)).toEqual([1, 1, 1, 1]);
  });
});

describe('cleanupCommand', () => {
  it('deletes a merged PR\'s branch with -D, and keeps a closed one\'s', () => {
    const merged = wt('/code/shop-login', { branch: 'login', pr: { number: 1, url: '', title: '', state: 'MERGED' } });
    expect(cleanupCommand({ mainPath: '/code/shop' }, merged)).toBe('git -C /code/shop worktree remove /code/shop-login && git -C /code/shop branch -D login');
    expect(cleanupCommand({ mainPath: '/code/shop' }, { ...merged, pr: { ...merged.pr!, state: 'CLOSED' } })).toBe('git -C /code/shop worktree remove /code/shop-login');
  });
});
