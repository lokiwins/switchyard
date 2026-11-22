import type { ReactNode } from 'react';
import { cx } from '../lib/cx';
import { useNav } from './nav-api';
import { ThemeMenu } from './ThemeMenu';

/*
 * The header on every page: the pages, with a badge where something needs you,
 * the theme menu and the page's own actions. On a phone it takes two rows: the
 * name with the buttons, then the pages across the full width, wrapping rather
 * than widening the page.
 *
 * A theme can restyle the name (--brand-size, --brand-tracking, --brand-case)
 * and draw a stripe along the bottom (--topbar-stripe); see themes.css.
 */

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

const BADGE = 'min-w-[18px] px-1.25 rounded-[9px] text-2xs font-bold leading-[18px] text-center tabular-nums shadow-[inset_0_0_0_1px_var(--ring-tone)]';
const BADGE_TONES: Record<string, string> = {
  amber: 'bg-amber-soft text-amber [--ring-tone:color-mix(in_srgb,var(--amber)_30%,transparent)]',
  red: 'bg-red-soft text-red [--ring-tone:color-mix(in_srgb,var(--red)_30%,transparent)]',
  purple: 'bg-purple-soft text-purple [--ring-tone:color-mix(in_srgb,var(--purple)_30%,transparent)]',
};
const BADGE_NEUTRAL = 'bg-neutral-soft text-gray-700 [--ring-tone:var(--hairline)]';

const LINK = [
  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-sm font-semibold text-gray-500',
  'hover:text-gray-900 hover:bg-hover hover:no-underline',
  'aria-[current=page]:text-gray-900 aria-[current=page]:bg-neutral-soft',
  'max-phone:px-1.5 max-phone:whitespace-nowrap max-tiny:px-1 max-tiny:gap-1 max-tiny:text-xs',
].join(' ');

function NavLinks({ current }: { current: string }) {
  const { data: nav } = useNav();
  return (
    <nav className="flex gap-0.5 max-phone:order-3 max-phone:basis-full max-phone:min-w-0 max-phone:flex-wrap" aria-label="Pages">
      {PAGES.map((page) => {
        const counts = 'badge' in page ? nav?.[page.badge] : undefined;
        return (
          <a key={page.href} href={page.href} className={LINK} aria-current={page.href === current ? 'page' : undefined}
            title={counts && 'badge' in page ? BADGE_TITLES[page.badge]?.(counts) : undefined}>
            {page.label}
            {'badge' in page && ' '}
            {'badge' in page && (
              <span className={cx(BADGE, (counts?.tone && BADGE_TONES[counts.tone]) || BADGE_NEUTRAL)} data-badge={page.badge} hidden={!counts?.count}>
                {counts?.count ? String(counts.count) : ''}
              </span>
            )}
          </a>
        );
      })}
    </nav>
  );
}

/** The page's status line in the top bar (Updated 5s ago, Live, Loading…), read out as it changes; a phone leaves it out. */
export function TopBarStatus({ children }: { children: ReactNode }) {
  return <span id="updated" className="text-gray-500 max-phone:hidden" aria-live="polite">{children}</span>;
}

export function TopBar({ current, brand, children }: {
  current: string;
  /** A line beside the pages (what the page looks through), cut short where it doesn't fit; a phone leaves it out. */
  brand?: { id: string; text: ReactNode };
  children?: ReactNode;
}) {
  return (
    <header className={cx(
      'sticky top-0 z-5 flex justify-between items-center gap-3 px-5 py-2',
      'bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] backdrop-saturate-140 backdrop-blur-[10px] shadow-[0_1px_0_var(--hairline)]',
      'after:absolute after:inset-x-0 after:-bottom-px after:h-[3px] after:pointer-events-none after:[background:var(--topbar-stripe,none)]',
      'max-phone:flex-wrap max-phone:gap-y-1 max-phone:px-4',
    )}>
      <div className="flex items-center gap-4 min-w-0 max-phone:contents">
        <h1 className={cx(
          '[font-family:var(--font-display)] [font-weight:var(--font-weight-display)] max-phone:order-1',
          'text-[length:var(--brand-size,var(--text-base))] tracking-[var(--brand-tracking,-0.01em)] [text-transform:var(--brand-case,none)]',
        )}>
          Switchyard
        </h1>
        <NavLinks current={current} />
        {brand && <span id={brand.id} className="truncate text-xs text-gray-500 max-phone:hidden">{brand.text}</span>}
      </div>
      <div className="flex items-center gap-3 shrink-0 text-xs max-phone:order-2 max-phone:ml-auto">
        <ThemeMenu />
        {children}
      </div>
    </header>
  );
}
