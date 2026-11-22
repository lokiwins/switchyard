import { cx } from '../lib/cx';

/*
 * A status dot: green and pulsing while an agent works, amber while it waits
 * on you, green for a connected tracker, grey for anything else (parked,
 * ended). The pulse stops for anyone who asks for less motion.
 */

const GLOW = 'shadow-[0_0_0_3px_color-mix(in_srgb,var(--glow)_22%,transparent)]';

const STATES: Record<string, string> = {
  busy: `bg-green [--glow:var(--green)] ${GLOW} animate-dot-pulse motion-reduce:animate-none`,
  idle: `bg-amber [--glow:var(--amber)] ${GLOW}`,
  connected: `bg-green [--glow:var(--green)] ${GLOW}`,
};

export function Dot({ state, className }: { state?: string | null; className?: string }) {
  return <span className={cx('size-1.5 shrink-0 rounded-full', (state && STATES[state]) || 'bg-gray-400', className)} aria-hidden="true" />;
}
