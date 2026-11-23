import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { cssSource } from '../../styles/source';
import type { RepoGroup, WorktreeRow } from './types';
import { WorktreeRowView } from './WorktreeRowView';

afterEach(cleanup);

const base = cssSource('base');

const classes = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/);

const REPO = { name: 'storefront', mainPath: '/code/storefront', worktrees: [] } as unknown as RepoGroup;
const ROW = {
  path: '/code/storefront-fix', branch: 'a-very-long-branch-name-that-will-not-fit', isMain: false, flags: [], needsAttention: true,
  status: { changed: 2, untracked: 1, conflicted: 0, ahead: 3, behind: 0, upstream: 'origin/x' },
  agents: { live: [], last: null, recent: [] }, lastActivityAt: null,
} as unknown as WorktreeRow;

function row(w: WorktreeRow = ROW) {
  return render(<table><tbody><WorktreeRowView repo={REPO} w={w} caps={{}} /></tbody></table>);
}

describe('WorktreeRowView', () => {
  it('marks a row that needs you with a red edge on its first cell', () => {
    row();
    expect(classes(screen.getByRole('row'))).toContain('[&>td:first-child]:shadow-[inset_3px_0_0_var(--red)]');
  });

  it('cuts a long branch name short instead of widening its column', () => {
    row();
    expect(classes(screen.getByTitle(ROW.branch!))).toContain('truncate');
  });

  it('counts commits ahead in green, and keeps the buttons on one line', () => {
    row();
    expect(classes(screen.getByTitle('Commits ahead of upstream'))).toContain('text-green');
    expect(classes(screen.getAllByRole('cell').at(-1)!.firstElementChild)).toContain('flex-nowrap');
  });
});

describe('styles', () => {
  it('tables are styled as elements in base.css, which the Markdown in panes builds on', () => {
    expect(base).toMatch(/\btable\s*{[^}]*table-layout:\s*fixed/);
    expect(base).toMatch(/\bth\s*{[^}]*text-transform:\s*uppercase/);
    expect(base).toMatch(/max-width:\s*900px\)\s*{\s*table\s*{\s*table-layout:\s*auto/);
  });

});
