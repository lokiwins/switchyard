import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Capabilities, LiveSession } from '../../lib/types';
import { TaskRow, type RowContext } from './TaskRow';
import type { CheckResult, ShownTask, Work } from './types';

/*
 * A running session on a task's work offers "Mark as ▾" where End ▾ was:
 * mark the task done or drop it from where you're looking at its work, or
 * end just the session.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const CONTEXT: RowContext = { now: Date.parse('2026-11-20T12:00:00Z'), caps: { tmux: true } as Capabilities, repos: [{ name: 'shop', mainPath: '/code/shop' }], approvals: [] };

const SESSION = {
  sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', pid: 42, cwd: '/code/shop-sy-abc123', status: 'idle', statusUpdatedAt: 0, kind: 'interactive',
  host: { kind: 'tmux', label: 'tmux', session: 'switchyard', window: 'shop' },
} as unknown as LiveSession;

const work = (over: Partial<Work> = {}): Work => ({
  path: '/code/shop-sy-abc123', repoName: 'shop', branch: 'sy-abc123-receipt', live: [SESSION], recent: [], checks: [], checkNames: [], ...over,
});

const task = (over: Partial<ShownTask> = {}): ShownTask => ({
  id: 'sy-abc123', title: 'Email a receipt', notes: '', dueOn: null, links: [], work: [work()], state: 'needs-you', start: null, ...over,
});

function workLine(shown: ShownTask) {
  render(<QueryClientProvider client={new QueryClient()}><ul><TaskRow task={shown} context={CONTEXT} /></ul></QueryClientProvider>);
  return within(screen.getByLabelText('Work on this task'));
}

function stubFetch() {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, data: {} })));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const lastPost = (fetchMock: ReturnType<typeof stubFetch>) => {
  const [url, init] = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit];
  return { url, body: JSON.parse(String(init.body)) as unknown };
};

describe('Mark as ▾ on a task\'s work', () => {
  it('takes End ▾\'s place on an open task\'s running session', () => {
    const line = workLine(task());
    expect(line.getByRole('button', { name: 'Mark as ▾' })).toBeTruthy();
    expect(line.queryByRole('button', { name: 'End ▾' })).toBeNull();
  });

  it('marks the task done', async () => {
    const fetchMock = stubFetch();
    const line = workLine(task());
    fireEvent.click(line.getByRole('button', { name: 'Mark as ▾' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastPost(fetchMock)).toEqual({ url: '/api/hub/tasks/close', body: { id: 'sy-abc123', as: 'done' } });
  });

  it('drops the task', async () => {
    const fetchMock = stubFetch();
    const line = workLine(task());
    fireEvent.click(line.getByRole('button', { name: 'Mark as ▾' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Dropped' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastPost(fetchMock)).toEqual({ url: '/api/hub/tasks/close', body: { id: 'sy-abc123', as: 'dropped' } });
  });

  it('names a failed check on Done, which still works', async () => {
    const failed = { name: 'check', state: 'failed', exitCode: 1 } as CheckResult;
    const line = workLine(task({ work: [work({ checks: [failed] })] }));
    fireEvent.click(line.getByRole('button', { name: 'Mark as ▾' }));
    expect(await screen.findByRole('button', { name: 'Done anyway (check failed)' })).toBeTruthy();
  });

  it('still ends just the session, leaving the task open', async () => {
    const fetchMock = stubFetch();
    const line = workLine(task());
    fireEvent.click(line.getByRole('button', { name: 'Mark as ▾' }));
    fireEvent.click(await screen.findByRole('button', { name: 'End session' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastPost(fetchMock)).toEqual({ url: '/api/terminal/end', body: { sessionId: SESSION.sessionId } });
  });

  it('keeps End ▾ on a closed task\'s session: there is nothing to mark', () => {
    const line = workLine(task({ state: 'done', closedAs: 'done' }));
    expect(line.getByRole('button', { name: 'End ▾' })).toBeTruthy();
    expect(line.queryByRole('button', { name: 'Mark as ▾' })).toBeNull();
  });
});
