/*
 * The words for a worktree's review (see src/review.js), kept apart from the
 * DOM so they can be tested.
 */

import type { Review } from './types';

interface Badge { text: string; tone: string }
const NO_VERDICT: Badge = { text: 'Review: no verdict', tone: 'is-stale' };

const LABELS: Record<Review['state'], Badge> = {
  reviewing: { text: 'Reviewing…', tone: 'is-running' },
  'needs you': { text: 'Review: needs you', tone: 'is-needs-you' },
  passed: { text: 'Review passed', tone: 'is-passed' },
  changes: { text: 'Review: changes asked for', tone: 'is-failed' },
  'no verdict': NO_VERDICT,
};

/** A review's badge: its words and a tone class, as a check's (see check-status.ts). */
export const reviewLabel = (review: Pick<Review, 'state'>): Badge => LABELS[review.state] ?? NO_VERDICT;

/** The reviewer's reasons: its last reply, without the VERDICT word it starts with. */
export const reviewReasons = (summary: string | null | undefined): string => String(summary ?? '').replace(/^\s*verdict:\s*(?:pass|changes)\b[\s.:;,—–-]*/i, '');
