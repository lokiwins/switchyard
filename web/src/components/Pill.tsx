import type { ComponentProps } from 'react';
import { cx } from '../lib/cx';

/*
 * A badge: a small rounded chip with a faint ring, its colour only there to
 * mean something (green done or working, amber waiting, red failing, purple
 * merged). Any other tone is the neutral grey.
 */

const RING = 'shadow-[inset_0_0_0_1px_var(--ring-tone)]';

const TONES: Record<string, string> = {
  green: `bg-green-soft text-green ${RING} [--ring-tone:color-mix(in_srgb,var(--green)_22%,transparent)]`,
  amber: `bg-amber-soft text-amber ${RING} [--ring-tone:color-mix(in_srgb,var(--amber)_25%,transparent)]`,
  red: `bg-red-soft text-red ${RING} [--ring-tone:color-mix(in_srgb,var(--red)_22%,transparent)]`,
  purple: `bg-purple-soft text-purple ${RING} [--ring-tone:color-mix(in_srgb,var(--purple)_22%,transparent)]`,
};
const NEUTRAL = `bg-neutral-soft text-gray-700 ${RING} [--ring-tone:var(--hairline)]`;

const BASE = 'inline-flex items-center gap-1.25 justify-self-start px-1.5 rounded-sm text-2xs font-semibold leading-[18px] whitespace-nowrap';

/** The classes for a badge in `tone`. */
export const pillClass = (tone?: string | null): string => cx(BASE, (tone && TONES[tone]) || NEUTRAL);

/** A badge in one of the tones; `className` adds layout or a caller's own colours (a tracker status's). */
export function Pill({ tone, className, ...props }: ComponentProps<'span'> & { tone?: string | null }) {
  return <span className={cx(pillClass(tone), className)} {...props} />;
}
