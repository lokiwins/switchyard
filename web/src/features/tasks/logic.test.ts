import { describe, expect, it } from 'vitest';
import { canStart, parentWorkFor, rowDue } from './logic';
import type { ShownTask, Work } from './types';

const NOW = Date.UTC(2026, 10, 19, 12);
const WORK: Work = { path: '/code/billing-api-fix', repoName: 'billing-api', branch: 'sy-1-fix', pr: null, live: [], recent: [], checks: [], checkNames: [] };
const TASK: ShownTask = { id: 'sy-1', title: 'Fix the totals', notes: '', links: [], dueOn: null, state: 'working', start: null, work: [WORK] };
const REPOS = [{ name: 'billing-api', mainPath: '/code/billing-api' }];

describe('canStart', () => {
  it('offers Start for a task not started yet, with tmux and a repo to start in', () => {
    const fresh = { ...TASK, state: 'not-started', work: [] };
    expect(canStart(fresh, { tmux: true, repos: REPOS })).toBe(true);
    expect(canStart(fresh, { tmux: false, repos: REPOS })).toBe(false);
    expect(canStart(fresh, { tmux: true, repos: [] })).toBe(false);
    expect(canStart(TASK, { tmux: true, repos: REPOS })).toBe(false);
  });
});

describe('parentWorkFor', () => {
  it('a subtask starts from its parent\'s worktree with a branch, in a repo switchyard knows', () => {
    expect(parentWorkFor(TASK, REPOS)?.branch).toBe('sy-1-fix');
    expect(parentWorkFor({ ...TASK, work: [{ ...WORK, branch: null }] }, REPOS)).toBeNull();
    expect(parentWorkFor(TASK, [{ name: 'other' }])).toBeNull();
    expect(parentWorkFor(null, REPOS)).toBeNull();
  });
});

describe('rowDue', () => {
  it('is the due date as of now, and none once closed', () => {
    const due = { ...TASK, dueOn: '2026-11-19' };
    expect(rowDue(due, NOW)?.text).toBe('Due today');
    expect(rowDue(due, NOW + 2 * 86_400_000)?.text).toBe('Overdue 2d');
    expect(rowDue({ ...due, state: 'done' }, NOW)).toBeNull();
  });
});
