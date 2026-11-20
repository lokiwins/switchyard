import { h, liveTime } from './dom.js';
import { reviewLabel, reviewReasons } from './review-status.js';

/*
 * A worktree's review on the Tasks page (see src/review.js): Review to start
 * one; then its badge, opening to the reviewer's reasons, with its session's
 * Terminal and Jump while it runs, and Review again once it's done.
 */

function reviewButton(label, onReview) {
  const button = h('button', {
    type: 'button',
    class: 'btn btn-sm btn-secondary',
    title: 'A second Claude reads this work, without changing it, and says whether it does what the task asks',
    onclick: async () => {
      button.disabled = true;
      try {
        await onReview();
      } finally {
        button.disabled = false;
      }
    },
  }, label);
  return button;
}

/**
 * Review, or the latest review's badge. `onReview()` starts one; `controls`
 * are the running reviewer's session's (answer its prompts, Terminal, Jump…).
 */
export function reviewControl(review, { onReview, controls = null }) {
  if (!review) return reviewButton('Review', onReview);
  const { text, tone } = reviewLabel(review);
  const reasons = reviewReasons(review.summary);
  const running = review.state === 'reviewing' || Boolean(review.session);
  return h('details', { class: `check-status review-status ${tone}` },
    h('summary', { title: 'What the reviewer said' }, text),
    h('div', { class: 'check-body' },
      h('p', { class: 'check-meta' }, liveTime(review.startedAt, 'started ')),
      reasons && h('p', { class: 'review-reasons' }, reasons),
      // Kept in the panel and named, apart from the work's own session's Terminal and Jump on the line.
      h('div', { class: 'review-actions' },
        controls && [h('span', { class: 'check-meta' }, 'The reviewer\'s session:'), controls],
        !running && reviewButton('Review again', onReview))));
}
