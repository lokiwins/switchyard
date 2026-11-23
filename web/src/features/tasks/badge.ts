import { cx } from '../../lib/cx';

/*
 * A check's or a review's result on a worktree's line: a rounded badge in its
 * tone that opens (a <details>) to the end of its output, or the reviewer's
 * reasons. Open, it takes the whole line.
 */

const TONES: Record<string, string> = {
  'is-passed': 'text-green bg-green-soft',
  'is-failed': 'text-red bg-red-soft',
  'is-running': 'text-amber bg-amber-soft',
  'is-stale': 'text-gray-500',
  'is-needs-you': 'text-amber bg-amber-soft font-semibold',
};

/** The <details>. */
export const resultClass = 'text-xs min-w-0 open:basis-full';

/** Its <summary>: the badge, in `tone` (from check-status.js or review-status.js). */
export const resultSummaryClass = (tone: string) => cx(
  'inline-block cursor-pointer whitespace-nowrap list-none [&::-webkit-details-marker]:hidden py-px px-2 rounded-full border border-current',
  TONES[tone],
);

/** What it opens to. */
export const resultBodyClass = 'grid gap-2 mt-2 justify-items-start';
export const resultMetaClass = 'm-0 text-gray-500 [overflow-wrap:anywhere]';
