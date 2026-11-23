import { useMutation } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { LiveTime } from '../../components/LiveTime';
import { reviewLabel, reviewReasons } from './review-status';
import type { Review } from './types';
import { Button } from '../../components/Button';
import { resultBodyClass, resultClass, resultMetaClass, resultSummaryClass } from './badge';

/*
 * A worktree's review (see src/review.js): Review to start one; then its
 * badge, opening to the reviewer's reasons, with its session's controls while
 * it runs, and Review again once it's done.
 */

function ReviewButton({ label, onReview }: { label: string; onReview: () => Promise<unknown> }) {
  const start = useMutation({ mutationFn: onReview });
  return (
    <Button type="button" variant="secondary" size="sm" disabled={start.isPending} onClick={() => start.mutate()}
      title="A second Claude reads this work, without changing it, and says whether it does what the task asks">
      {label}
    </Button>
  );
}

/** `controls` are the running reviewer's session's (answer its prompts, Terminal, Jump…). */
export function ReviewControl({ review, onReview, controls }: { review?: Review | null; onReview: () => Promise<unknown>; controls?: ReactNode }) {
  if (!review) return <ReviewButton label="Review" onReview={onReview} />;
  const { text, tone } = reviewLabel(review);
  const reasons = reviewReasons(review.summary);
  const running = review.state === 'reviewing' || Boolean(review.session);
  return (
    <details className={resultClass}>
      <summary className={resultSummaryClass(tone)} title="What the reviewer said">{text}</summary>
      <div className={resultBodyClass}>
        <p className={resultMetaClass}><LiveTime since={review.startedAt} prefix="started " /></p>
        {reasons && <p className="m-0 text-xs leading-xs text-gray-900 whitespace-pre-wrap [overflow-wrap:anywhere]">{reasons}</p>}
        {/* Kept in the panel and named, apart from the work's own session's Terminal and Jump on the line. */}
        <div className="flex flex-wrap items-center gap-2">
          {controls && <><span className={resultMetaClass}>The reviewer&apos;s session:</span>{controls}</>}
          {!running && <ReviewButton label="Review again" onReview={onReview} />}
        </div>
      </div>
    </details>
  );
}
