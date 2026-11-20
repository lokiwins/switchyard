import { useMutation } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { LiveTime } from '../../components/LiveTime';
import { reviewLabel, reviewReasons } from './logic';
import type { Review } from './types';

/*
 * A worktree's review (see src/review.js): Review to start one; then its
 * badge, opening to the reviewer's reasons, with its session's controls while
 * it runs, and Review again once it's done.
 */

function ReviewButton({ label, onReview }: { label: string; onReview: () => Promise<unknown> }) {
  const start = useMutation({ mutationFn: onReview });
  return (
    <button type="button" className="btn btn-sm btn-secondary" disabled={start.isPending} onClick={() => start.mutate()}
      title="A second Claude reads this work, without changing it, and says whether it does what the task asks">
      {label}
    </button>
  );
}

/** `controls` are the running reviewer's session's (answer its prompts, Terminal, Jump…). */
export function ReviewControl({ review, onReview, controls }: { review?: Review | null; onReview: () => Promise<unknown>; controls?: ReactNode }) {
  if (!review) return <ReviewButton label="Review" onReview={onReview} />;
  const { text, tone } = reviewLabel(review);
  const reasons = reviewReasons(review.summary);
  const running = review.state === 'reviewing' || Boolean(review.session);
  return (
    <details className={`check-status review-status ${tone}`}>
      <summary title="What the reviewer said">{text}</summary>
      <div className="check-body">
        <p className="check-meta"><LiveTime since={review.startedAt} prefix="started " /></p>
        {reasons && <p className="review-reasons">{reasons}</p>}
        {/* Kept in the panel and named, apart from the work's own session's Terminal and Jump on the line. */}
        <div className="review-actions">
          {controls && <><span className="check-meta">The reviewer&apos;s session:</span>{controls}</>}
          {!running && <ReviewButton label="Review again" onReview={onReview} />}
        </div>
      </div>
    </details>
  );
}
