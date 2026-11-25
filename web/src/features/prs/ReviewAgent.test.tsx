import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LiveSession } from '../../lib/types';
import { usePaneStore } from '../../stores/panes';
import { PrCard } from './PrCard';
import { agentReviewLabel } from './review-agent';
import type { AgentReview, Pr } from './types';

/*
 * A PR awaiting your review has Review: a read-only Claude reviews it in its
 * own checkout and reports back here. Then the button shows how it went, and
 * opens to its report, its terminal, Review again and Discard.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  usePaneStore.getState().close();
});

const PR: Pr = {
  repo: 'acme/storefront', number: 42, title: 'Show order history', url: 'https://github.com/acme/storefront/pull/42', stage: 'open',
  headRefName: 'order-history', baseRefName: 'main', updatedAt: '2026-11-20T11:00:00Z', canAgentReview: true, agentReview: null,
};

const SESSION = { sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', status: 'busy', host: { kind: 'tmux', label: 'tmux' } } as unknown as LiveSession;

const review = (over: Partial<AgentReview> = {}): AgentReview => ({
  state: 'changes', summary: '**Summary:** fine.\n\n**Verdict:** `Request Changes`: the totals skip tax.', startedAt: Date.parse('2026-11-20T10:00:00Z'),
  path: '/code/storefront-review-42', session: null, outdated: false, ...over,
});

function card(pr: Pr) {
  render(<QueryClientProvider client={new QueryClient()}><ul><PrCard pr={pr} showAuthor={false} canAskCopilot={false} caps={{ tmux: true }} /></ul></QueryClientProvider>);
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

describe('agentReviewLabel', () => {
  it('says how the review went, in its tone', () => {
    expect(agentReviewLabel(review({ state: 'reviewing' }))).toEqual({ text: 'Reviewing…', tone: 'amber' });
    expect(agentReviewLabel(review({ state: 'needs you' }))).toEqual({ text: 'Review needs you', tone: 'amber' });
    expect(agentReviewLabel(review({ state: 'approve' }))).toEqual({ text: '✓ Approve', tone: 'green' });
    expect(agentReviewLabel(review({ state: 'changes' }))).toEqual({ text: '✗ Request changes', tone: 'red' });
    expect(agentReviewLabel(review({ state: 'clarify' }))).toEqual({ text: '? Needs clarification', tone: 'amber' });
    expect(agentReviewLabel(review({ state: 'no verdict' }))).toEqual({ text: 'Review: no verdict', tone: 'muted' });
  });
});

describe('Review on a PR awaiting your review', () => {
  it('starts a review agent on the PR', async () => {
    const fetchMock = stubFetch();
    card(PR);
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    await waitFor(() => expect(lastPost(fetchMock)).toEqual({ url: '/api/prs/review', body: { repo: 'acme/storefront', number: 42 } }));
  });

  it('is there but off when the repo isn\'t cloned here, saying why', () => {
    card({ ...PR, canAgentReview: false });
    const button = screen.getByRole('button', { name: 'Review' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toMatch(/clone acme\/storefront/i);
  });

  it('is not offered on a PR that isn\'t awaiting your review', () => {
    const { canAgentReview: _c, agentReview: _a, ...yours } = PR;
    card(yours);
    expect(screen.queryByRole('button', { name: /review/i })).toBeNull();
  });

  it('once done, shows the verdict and opens the report in a pane', () => {
    card({ ...PR, agentReview: review() });
    fireEvent.click(screen.getByRole('button', { name: '✗ Request changes ▾' }));
    fireEvent.click(screen.getByRole('button', { name: /Read the report/ }));
    const pane = usePaneStore.getState().pane;
    expect(pane).toMatchObject({ kind: 'report', heading: 'Review of storefront#42' });
    expect(pane?.kind === 'report' && pane.markdown).toMatch(/the totals skip tax/);
  });

  it('while it runs, its terminal opens from the menu, and Review again waits', () => {
    card({ ...PR, agentReview: review({ state: 'reviewing', summary: null, session: SESSION }) });
    fireEvent.click(screen.getByRole('button', { name: 'Reviewing… ▾' }));
    fireEvent.click(screen.getByRole('button', { name: /Watch in terminal/ }));
    expect(usePaneStore.getState().pane).toMatchObject({ kind: 'terminal', session: { sessionId: SESSION.sessionId } });
    expect(screen.queryByRole('button', { name: /Review again/ })).toBeNull();
  });

  it('once it gives its verdict, Review again is there even with its terminal still open, and says it ends it', () => {
    card({ ...PR, agentReview: review({ session: { ...SESSION, status: 'idle' } }) });
    fireEvent.click(screen.getByRole('button', { name: '✗ Request changes ▾' }));
    expect(screen.getByRole('button', { name: /Watch in terminal/ })).toBeTruthy();
    expect((screen.getByRole('button', { name: /Review again/ }) as HTMLButtonElement).title).toMatch(/ends the last reviewer/i);
  });

  it('a reviewer busy after its verdict (on something you asked) is waited for', () => {
    card({ ...PR, agentReview: review({ session: SESSION }) });
    fireEvent.click(screen.getByRole('button', { name: '✗ Request changes ▾' }));
    expect(screen.queryByRole('button', { name: /Review again/ })).toBeNull();
  });

  it('says when the PR has new commits since, and Review again reviews it afresh', async () => {
    const fetchMock = stubFetch();
    card({ ...PR, agentReview: review({ outdated: true }) });
    fireEvent.click(screen.getByRole('button', { name: '✗ Request changes ▾' }));
    expect(screen.getByText(/new commits since/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Review again/ }));
    await waitFor(() => expect(lastPost(fetchMock)).toEqual({ url: '/api/prs/review', body: { repo: 'acme/storefront', number: 42 } }));
  });

  it('Discard removes the review and its checkout', async () => {
    const fetchMock = stubFetch();
    card({ ...PR, agentReview: review() });
    fireEvent.click(screen.getByRole('button', { name: '✗ Request changes ▾' }));
    expect(screen.getByText(/\/code\/storefront-review-42/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Discard/ }));
    await waitFor(() => expect(lastPost(fetchMock)).toEqual({ url: '/api/prs/review/discard', body: { repo: 'acme/storefront', number: 42 } }));
  });
});
