/*
 * The words for a worktree's review (see src/review.js), kept apart from the
 * DOM so they can be tested.
 */

const LABELS = {
  reviewing: { text: 'Reviewing…', tone: 'is-running' },
  'needs you': { text: 'Review: needs you', tone: 'is-needs-you' },
  passed: { text: 'Review passed', tone: 'is-passed' },
  changes: { text: 'Review: changes asked for', tone: 'is-failed' },
  'no verdict': { text: 'Review: no verdict', tone: 'is-stale' },
};

/** A review's badge: its words and a tone class, as a check's (see check-status.js). */
export const reviewLabel = (review) => LABELS[review.state] ?? LABELS['no verdict'];

/** The reviewer's reasons: its last reply, without the VERDICT word it starts with. */
export const reviewReasons = (summary) => String(summary ?? '').replace(/^\s*verdict:\s*(?:pass|changes)\b[\s.:;,—–-]*/i, '');
