import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import legacy from '../styles/legacy.css?raw';
import { NAV_KEY } from './nav-api';
import { Menu, MenuItem, MenuLabel } from './Menu';
import { Panel } from './Panel';
import { Pill } from './Pill';
import { Segmented } from './Segmented';
import { Tiles } from './Tiles';
import { TopBar, TopBarStatus } from './TopBar';

/*
 * The shared components carry their own look as utilities. These check the
 * parts a screenshot at one width can't: what changes on a phone, and that a
 * menu never outgrows the window.
 */

afterEach(cleanup);

function withNav(children: ReactNode, nav: Record<string, unknown> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(NAV_KEY, nav);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const classes = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/);

describe('TopBar', () => {
  it('on a phone wraps: the name and buttons, then the page links across the full width', () => {
    render(withNav(<TopBar current="/"><TopBarStatus>Updated now</TopBarStatus></TopBar>));
    const header = screen.getByRole('banner');
    expect(classes(header)).toContain('max-phone:flex-wrap');
    expect(classes(header.querySelector('h1')?.parentElement ?? null)).toContain('max-phone:contents');
    expect(classes(screen.getByRole('navigation'))).toEqual(expect.arrayContaining(['max-phone:basis-full', 'max-phone:flex-wrap']));
  });

  it('marks the current page and hides its status line on a phone', () => {
    render(withNav(<TopBar current="/prs"><TopBarStatus>Live</TopBarStatus></TopBar>));
    expect(screen.getByRole('link', { name: /Pull requests/ }).getAttribute('aria-current')).toBe('page');
    const status = document.getElementById('updated');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(classes(status)).toContain('max-phone:hidden');
  });

  it('shows a badge in its tone only when something needs you', () => {
    render(withNav(<TopBar current="/" />, { agents: { count: 2, tone: 'amber', waiting: 2, interrupted: 0, working: 1 }, prs: { count: 0 } }));
    const agents = document.querySelector('[data-badge="agents"]');
    expect(agents?.textContent).toBe('2');
    expect(agents?.hasAttribute('hidden')).toBe(false);
    expect(classes(agents)).toContain('text-amber');
    expect(document.querySelector('[data-badge="prs"]')?.hasAttribute('hidden')).toBe(true);
  });
});

describe('Menu', () => {
  it('is never wider (or narrower) than the window less a margin', () => {
    render(<Menu label="Open" open><MenuLabel>Resume</MenuLabel><MenuItem>One</MenuItem></Menu>);
    const panel = screen.getByText('One').closest('[data-radix-popper-content-wrapper] > *');
    const sizes = classes(panel).filter((c) => /^(min|max)-w-/.test(c));
    expect(sizes).toHaveLength(2);
    for (const size of sizes) expect(size).toMatch(/100vw/);
  });

  it('gives its items and labels the menu look, keeping a caller\'s own classes', () => {
    render(<Menu label="Open" open><MenuLabel>Resume</MenuLabel><MenuItem className="picker-item">One</MenuItem></Menu>);
    const item = screen.getByRole('button', { name: 'One' });
    expect(classes(item)).toContain('picker-item');
    expect(item.getAttribute('type')).toBe('button');
    expect(classes(screen.getByText('Resume'))).toContain('uppercase');
  });
});

describe('Panel', () => {
  it('is padded less on a phone', () => {
    render(<Panel id="t" title="Tasks">body</Panel>);
    const panel = screen.getByRole('region', { name: 'Tasks' });
    expect(classes(panel)).toEqual(expect.arrayContaining(['px-4', 'max-phone:p-3']));
  });
});

describe('Segmented', () => {
  it('wraps on a phone and clears a filter picked elsewhere', () => {
    const onClear = vi.fn();
    render(<Segmented label="Show" value="all" onChange={() => {}} choices={[{ key: 'all', label: 'All' }]} extra={{ label: 'Waiting', onClear }} />);
    expect(classes(screen.getByRole('radiogroup'))).toContain('max-phone:flex-wrap');
    fireEvent.click(screen.getByRole('button', { name: 'Clear filter: Waiting' }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});

describe('Tiles', () => {
  it('presses a tile to filter and again to show everything; an empty count stays grey', () => {
    const onSelect = vi.fn();
    const tiles = [{ filter: 'waiting' as const, label: 'Waiting', value: 2, tone: 'amber' }, { filter: 'idle' as const, label: 'Idle', value: 0 }];
    const { rerender } = render(<Tiles tiles={tiles} current="all" all="all" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /Waiting/ }));
    expect(onSelect).toHaveBeenLastCalledWith('waiting');
    rerender(<Tiles tiles={tiles} current="waiting" all="all" onSelect={onSelect} />);
    const waiting = screen.getByRole('button', { name: /Waiting/ });
    expect(waiting.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(waiting);
    expect(onSelect).toHaveBeenLastCalledWith('all');
    expect(classes(screen.getByText('0'))).toContain('text-gray-400');
  });
});

describe('Pill', () => {
  it('reads its tone, and anything else as neutral', () => {
    render(<><Pill tone="red">Bad</Pill><Pill tone="nonsense">Plain</Pill></>);
    expect(classes(screen.getByText('Bad'))).toContain('text-red');
    expect(classes(screen.getByText('Plain'))).toContain('text-gray-700');
  });
});

describe('legacy.css', () => {
  it('no longer styles the components that carry their own look', () => {
    const moved = ['.topbar', '.brand', '.nav', '.nav-badge', '.menu-panel', '.menu-item', '.menu-label', '.menu-title', '.menu-meta',
      '.theme-panel', '.toast', '.panel', '.panel-head', '.tiles', '.tile', '.segmented', '.pill', '.errors', '.visually-hidden'];
    for (const selector of moved) {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(legacy, selector).not.toMatch(new RegExp(`${escaped}(?![\\w-])`));
    }
  });
});
