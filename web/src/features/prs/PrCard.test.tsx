import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import legacy from '../../styles/legacy.css?raw';
import { PrCard } from './PrCard';
import type { Pr } from './types';

afterEach(cleanup);

const classes = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/);

const PR: Pr = {
  repo: 'acme/storefront', number: 42, title: 'Show order history', url: 'https://github.com/acme/storefront/pull/42', stage: 'open',
  headRefName: 'order-history', baseRefName: 'main', updatedAt: '2026-11-20T11:00:00Z', additions: 12, deletions: 3, changedFiles: 2,
  checks: { total: 3, failing: 1, pending: 1, passing: 1, heldCount: 0, failed: [{ name: 'test', url: 'https://ci.example/1' }], running: [{ name: 'lint' }], held: [] },
  local: { path: '/Users/me/code/storefront-order-history', dirty: true, agents: [{ status: 'busy' }] },
};

function card(pr: Pr = PR) {
  const client = new QueryClient();
  return render(<QueryClientProvider client={client}><ul><PrCard pr={pr} showAuthor={false} canAskCopilot caps={{}} /></ul></QueryClientProvider>);
}

describe('PrCard', () => {
  it('on a phone stacks into one column, with Copilot under the signals', () => {
    card();
    const article = screen.getByRole('article');
    expect(classes(article)).toContain('max-phone:grid-cols-1');
    expect(classes(article.lastElementChild)).toContain('max-phone:[grid-column:1]');
  });

  it('lets a failure wrap, keeping its links red, while the other signals stay on one line', () => {
    card();
    const failed = screen.getByText(/1 failed/);
    expect(classes(failed)).toEqual(expect.arrayContaining(['text-red', 'whitespace-normal']));
    expect(screen.getByRole('link', { name: 'test' }).closest('span')).toBe(failed);
    expect(classes(screen.getByText(/1 running/))).toContain('whitespace-nowrap');
  });

  it('on a phone cuts a long checkout folder short instead of widening the page', () => {
    card();
    const folder = screen.getByTitle(PR.local!.path);
    expect(classes(folder)).toContain('max-phone:truncate');
    expect(classes(folder.parentElement)).toEqual(expect.arrayContaining(['max-phone:max-w-full', 'max-phone:min-w-0']));
  });

  it('shows a working agent in the checkout with a pulsing dot', () => {
    card();
    const dot = screen.getByText('working').querySelector('[aria-hidden="true"]');
    expect(classes(dot)).toEqual(expect.arrayContaining(['bg-green', 'animate-dot-pulse', 'motion-reduce:animate-none']));
  });
});

describe('legacy.css', () => {
  it('no longer styles the pull requests page, status dots or empty lists', () => {
    for (const selector of ['.pr', '.pr-list', '.pr-meta', '.sig', '.chip', '.chips', '.team-row', '.live-dot', '.dot', '.empty', '.path-inline', '.copy-icon']) {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(legacy, selector).not.toMatch(new RegExp(`${escaped}(?![\\w-])`));
    }
  });
});
