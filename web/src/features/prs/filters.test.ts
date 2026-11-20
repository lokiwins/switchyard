import { describe, expect, it } from 'vitest';
import { matchesQuery, prTiles, visiblePrs } from './filters';
import type { Pr, PrsData } from './types';

const pr = (number: number, stage: string, extra: Partial<Pr> = {}): Pr =>
  ({ repo: 'acme/shop', number, title: `PR ${number}`, url: '', stage, updatedAt: '2026-11-20T00:00:00Z', ...extra });

describe('matchesQuery', () => {
  it('matches title, repo, number, branch and author, every word', () => {
    const one = pr(42, 'ready', { title: 'Dark mode', headRefName: 'feat/dark', author: { login: 'sam' } });
    expect(matchesQuery(one, 'dark #42')).toBe(true);
    expect(matchesQuery(one, 'shop sam')).toBe(true);
    expect(matchesQuery(one, 'dark light')).toBe(false);
  });

  it('reads a team request\'s author, which is a plain name', () => {
    expect(matchesQuery({ title: 'x', repo: 'r', number: 1, author: 'kim' }, 'kim')).toBe(true);
  });
});

describe('prTiles and visiblePrs', () => {
  const data = {
    authored: [pr(1, 'ready'), pr(2, 'blocked'), pr(3, 'checks-failing'), pr(4, 'needs-update'), pr(5, 'checks-running'), pr(6, 'awaiting-review'), pr(7, 'draft')],
    reviewRequested: [pr(8, 'awaiting-review')],
  } as PrsData;

  it('counts PRs by where they stand', () => {
    expect(prTiles(data).map((t) => [t.label, t.value])).toEqual([
      ['Ready to merge', 2], ['Need fixes', 2], ['Checks running', 1], ['Awaiting review', 1], ['Reviews requested of you', 1],
    ]);
  });

  it('lists only those the filter and search pick', () => {
    expect(visiblePrs(data.authored, 'fix', '').map((p) => p.number)).toEqual([3, 4]);
    expect(visiblePrs(data.authored, 'all', '#7').map((p) => p.number)).toEqual([7]);
  });
});
