import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { pillClass } from '../../components/Pill';
import type { Capabilities } from '../../lib/types';
import { cssSource } from '../../styles/source';
import { ChecksControl } from './ChecksControl';
import { TaskGroups } from './TaskGroups';
import { TaskRow, type RowContext } from './TaskRow';
import type { CheckResult, ShownTask, Work } from './types';

/*
 * The Tasks page carries its own look as utilities. These check what one
 * screenshot can't: how a row is laid out narrower than a tablet and on a
 * phone, the states a row and its work can be in, and that legacy.css no
 * longer styles any of it.
 */

afterEach(cleanup);

const legacy = cssSource('legacy');
const classes = (el: Element | null | undefined) => (el?.getAttribute('class') ?? '').split(/\s+/);

const CONTEXT: RowContext = { now: Date.parse('2026-11-20T12:00:00Z'), caps: { tmux: true } as Capabilities, repos: [{ name: 'shop', mainPath: '/code/shop' }], approvals: [] };

const task = (over: Partial<ShownTask> = {}): ShownTask => ({
  id: 'sy-abc123', title: 'Email a receipt', notes: 'After each charge', dueOn: null, links: [], work: [], state: 'not-started', start: null, ...over,
});

const work = (over: Partial<Work> = {}): Work => ({
  path: '/code/shop-sy-abc123', repoName: 'shop', branch: 'sy-abc123-receipt', live: [], recent: [], checks: [], checkNames: [], ...over,
});

function withQueries(children: ReactNode) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

/** The task's own row (its subtasks' rows come after it). */
const row = (shown: ShownTask): HTMLElement => {
  render(withQueries(<ul><TaskRow task={shown} context={CONTEXT} /></ul>));
  const [li] = screen.getAllByRole('listitem');
  if (!li) throw new Error('no row');
  return li;
};

describe('TaskRow', () => {
  it('narrower than a tablet puts the line under the title; on a phone keeps ⋯ beside the title', () => {
    const li = row(task());
    expect(classes(li)).toEqual(expect.arrayContaining([
      'grid-cols-[112px_minmax(200px,360px)_minmax(0,1fr)_108px_auto]', 'max-phone:grid-cols-[auto_minmax(0,1fr)_auto]',
    ]));
    expect(classes(screen.getByText('After each charge'))).toEqual(expect.arrayContaining(['max-tablet:row-start-2', 'max-phone:[grid-column:1/-1]']));
    const actions = screen.getByRole('button', { name: '⋯' }).parentElement;
    expect(classes(actions)).toEqual(expect.arrayContaining(['max-phone:[grid-column:3]', 'max-phone:row-start-1']));
  });

  it('on a phone leaves out an empty line or due day rather than an empty row', () => {
    const due = row(task({ notes: '' })).querySelector('[data-due]');
    expect(classes(due)).toContain('max-phone:empty:hidden');
  });

  it('greys a done task\'s title and strikes a dropped one through', () => {
    row(task({ state: 'done', closedAs: 'done' }));
    expect(classes(screen.getByRole('button', { name: 'Email a receipt' }))).toContain('text-gray-500');
    cleanup();
    row(task({ state: 'dropped', closedAs: 'dropped' }));
    expect(classes(screen.getByRole('button', { name: 'Email a receipt' }))).toEqual(expect.arrayContaining(['text-gray-500', 'line-through']));
    cleanup();
    row(task());
    expect(classes(screen.getByRole('button', { name: 'Email a receipt' }))).toContain('text-gray-900');
  });

  it('marks a ticket link with its tracker\'s colour, and a link it can\'t place plainly', () => {
    row(task({ links: ['https://app.clickup.com/t/86b4fx1', 'https://example.com/x'] }));
    expect(classes(screen.getByRole('link', { name: /ClickUp/ }))).toContain('[--tracker:#7b68ee]');
    expect(classes(screen.getByRole('link', { name: 'example.com' })).some((c) => c.startsWith('[--tracker'))).toBe(false);
  });

  it('colours a due day by how near it is', () => {
    const due = row(task({ dueOn: '2026-11-19' })).querySelector('[data-due]');
    expect(classes(due)).toEqual(expect.arrayContaining(['text-red', 'font-semibold']));
    expect(classes(due)).not.toContain('text-gray-500');
  });

  it('sets its work under its title, and its subtasks in, with a rule down the side', () => {
    const li = row(task({ work: [work()], subtasks: [task({ id: 'sy-sub1', title: 'Its subtask' })] }));
    expect(classes(within(li).getByLabelText('Work on this task'))).toEqual(expect.arrayContaining(['[grid-column:2/-1]', 'max-tablet:[grid-column:1/-1]']));
    const subs = within(li).getByRole('list', { name: 'Subtasks of Email a receipt' });
    expect(classes(subs)).toEqual(expect.arrayContaining(['border-l-2', 'list-none']));
    expect(classes(within(subs).getByRole('listitem'))).toContain('py-2');
  });

  it('strikes a closed PR through', () => {
    row(task({ work: [work({ pr: { url: 'https://github.com/o/r/pull/9', number: 9, state: 'CLOSED' } })] }));
    expect(classes(screen.getByRole('link', { name: '#9' }))).toEqual(expect.arrayContaining(['line-through', 'text-gray-500']));
  });
});

describe('TaskGroups', () => {
  it('colours a group\'s head by what it holds, and folds Done with an arrow', () => {
    render(withQueries(<TaskGroups searching={false} context={CONTEXT} groups={[
      { key: 'needs-you', label: 'Needs you', tasks: [task()] },
      { key: 'overdue', label: 'Overdue', tasks: [] },
      { key: 'done', label: 'Done', tasks: [] },
    ]} />));
    expect(classes(screen.getByRole('heading', { name: /Needs you/ }))).toContain('text-amber');
    expect(classes(screen.getByRole('heading', { name: /Overdue/ }))).toContain('text-red');
    const done = screen.getByText('Done', { selector: 'summary' });
    expect(classes(done)).toEqual(expect.arrayContaining(["before:content-['▸']", "group-open:before:content-['▾']"]));
  });
});

describe('ChecksControl', () => {
  it('tints a check\'s badge by its result', () => {
    const check = (state: CheckResult['state']): CheckResult => ({ name: 'test', command: 'npm test', state, startedAt: 1, finishedAt: 2 });
    render(withQueries(<ChecksControl checks={[check('failed')]} names={['test']} onRun={async () => undefined} />));
    expect(classes(screen.getByText(/test/, { selector: 'summary' }))).toEqual(expect.arrayContaining(['text-red', 'bg-red-soft']));
  });
});

describe('Pill', () => {
  it('has a tone in a tracker status\'s own colour', () => {
    expect(pillClass('status')).toContain('var(--status');
    expect(pillClass('status')).not.toContain('bg-neutral-soft');
  });
});

describe('legacy.css', () => {
  it('no longer styles the Tasks page', () => {
    const moved = ['.list', '.list-row', '.row-who', '.row-title', '.row-where', '.row-detail', '.row-detail-label', '.actions', '.hub-row', '.hub-new',
      '.hub-new-row', '.hub-new-more', '.hub-group', '.hub-group-head', '.hub-count', '.ticket-badge', '.ticket-status', '.task-due', '.task-links',
      '.task-link', '.task-link-where', '.task-link-pr', '.subtasks', '.check-status', '.checks', '.check-body', '.check-output', '.check-meta',
      '.review-actions', '.review-reasons', '.row-title-btn', '.tool-card', '.tool-head', '.tool-connect', '.tool-label', '.tool-help', '.tool-meta',
      '.tool-row', '.tool-select', '.picker-tabs', '.picker-tab', '.picker-panel', '.picker-filter', '.picker-list', '.picker-item', '.picker-note',
      '.connections-panel', '.worktree-choices', '.worktree-choice', '.subhead', '.sep', '.row-note', '.row-time', '.row-detail-cell', '.row-detail-full'];
    for (const selector of moved) {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(legacy, selector).not.toMatch(new RegExp(`${escaped}(?![\\w-])`));
    }
  });
});
