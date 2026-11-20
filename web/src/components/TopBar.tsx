import type { ReactNode } from 'react';
import { cx } from '../lib/cx';
import { useNav } from './nav-api';
import { ThemeMenu } from './ThemeMenu';

/* The header on every page: the pages, with a badge where something needs you, the theme menu and the page's own actions. */

const PAGES = [
  { href: '/', label: 'Agents', badge: 'agents' },
  { href: '/worktrees', label: 'Worktrees' },
  { href: '/prs', label: 'Pull requests', badge: 'prs' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/settings', label: 'Settings' },
] as const;

const BADGE_TITLES: Record<string, (c: Record<string, unknown>) => string> = {
  agents: (c) => `${c.waiting} waiting on you · ${c.interrupted} interrupted · ${c.working} working`,
  prs: (c) => `${c.needFixes} need fixes · ${c.reviewRequests} review requests`,
};

function NavLinks({ current }: { current: string }) {
  const { data: nav } = useNav();
  return (
    <nav className="nav" aria-label="Pages">
      {PAGES.map((page) => {
        const counts = 'badge' in page ? nav?.[page.badge] : undefined;
        return (
          <a key={page.href} href={page.href} aria-current={page.href === current ? 'page' : undefined}
            title={counts && 'badge' in page ? BADGE_TITLES[page.badge]?.(counts) : undefined}>
            {page.label}
            {'badge' in page && ' '}
            {'badge' in page && (
              <span className={cx('nav-badge', counts?.tone)} data-badge={page.badge} hidden={!counts?.count}>
                {counts?.count ? String(counts.count) : ''}
              </span>
            )}
          </a>
        );
      })}
    </nav>
  );
}

export function TopBar({ current, children }: { current: string; children?: ReactNode }) {
  return (
    <header className="topbar">
      <div className="brand">
        <h1>Switchyard</h1>
        <NavLinks current={current} />
      </div>
      <div className="topbar-actions">
        <ThemeMenu />
        {children}
      </div>
    </header>
  );
}
