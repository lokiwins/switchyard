import type { AgentReview } from './types';

/* The words for a PR review agent's review (see src/pr-review.js), apart from the DOM so they can be tested. */

export interface ReviewBadge { text: string; tone: 'amber' | 'green' | 'red' | 'muted' }

const LABELS: Record<AgentReview['state'], ReviewBadge> = {
  reviewing: { text: 'Reviewing…', tone: 'amber' },
  'needs you': { text: 'Review needs you', tone: 'amber' },
  approve: { text: '✓ Approve', tone: 'green' },
  changes: { text: '✗ Request changes', tone: 'red' },
  clarify: { text: '? Needs clarification', tone: 'amber' },
  'no verdict': { text: 'Review: no verdict', tone: 'muted' },
};

/** How a review went, as its button says it, and its tone. */
export const agentReviewLabel = (review: Pick<AgentReview, 'state'>): ReviewBadge => LABELS[review.state] ?? LABELS['no verdict'];

/** Whether the reviewer is still at it: reviewing, asking you, or busy on a follow-up. Done, its terminal may still be open. */
export const isRunning = (review: Pick<AgentReview, 'state' | 'session'>): boolean =>
  review.state === 'reviewing' || review.state === 'needs you' || review.session?.status === 'busy';
