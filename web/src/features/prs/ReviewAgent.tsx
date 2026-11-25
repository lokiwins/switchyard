import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/Button';
import { Menu, MenuHint, MenuItem, MenuLabel, MenuTitle } from '../../components/Menu';
import { post } from '../../lib/api';
import { cx } from '../../lib/cx';
import { shortPath } from '../../lib/paths';
import { timeAgo } from '../../lib/time';
import type { Capabilities } from '../../lib/types';
import { openPane } from '../../stores/panes';
import { toast } from '../../stores/toast';
import { agentReviewLabel, isRunning, type ReviewBadge } from './review-agent';
import type { AgentReview, Pr } from './types';

/*
 * Review on a PR awaiting your review (see src/pr-review.js): a read-only
 * Claude reviews it in its own checkout and reports back here; it never posts
 * to GitHub. Once started, the button says how it's going or went, and opens
 * to the report, the reviewer's terminal, Review again and Discard.
 */

const DOT_TONES: Record<ReviewBadge['tone'], string> = { amber: 'bg-amber', green: 'bg-green', red: 'bg-red', muted: 'bg-gray-400' };
const LOOK = { variant: 'secondary', size: 'sm' } as const;

function useReviewAction(pr: Pr, action: 'start' | 'discard', onDone: () => void) {
  const ref = { repo: pr.repo, number: pr.number };
  return useMutation({
    mutationFn: () => post(action === 'start' ? '/api/prs/review' : '/api/prs/review/discard', ref),
    onSuccess: () => {
      onDone();
      toast(action === 'start' ? `Reviewing #${pr.number}` : `Review of #${pr.number} discarded`);
    },
    onError: (error) => toast(action === 'start' ? `Could not start the review: ${error.message}` : `Could not discard the review: ${error.message}`),
  });
}

function ReviewMenu({ pr, review, caps }: { pr: Pr; review: AgentReview; caps: Capabilities }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const again = useReviewAction(pr, 'start', close);
  const discard = useReviewAction(pr, 'discard', close);
  const { text, tone } = agentReviewLabel(review);
  const running = isRunning(review);
  const name = `${pr.repo.split('/').pop()}#${pr.number}`;
  const readReport = () => {
    close();
    openPane({ kind: 'report', heading: `Review of ${name}`, sub: pr.title, markdown: review.summary ?? '' });
  };
  const watch = () => {
    close();
    if (review.session) openPane({ kind: 'terminal', session: review.session });
  };
  const label = (
    <span className="inline-flex items-center gap-1.5">
      <span className={cx('size-1.5 rounded-full', DOT_TONES[tone])} aria-hidden="true" />
      {`${text} ▾`}
    </span>
  );
  return (
    <Menu label={label} title="What the review agent found, and what to do with it" look={LOOK}
      roomy width={[240, 340]} panelClass="gap-1.5" focusInput={false} open={open} onOpenChange={setOpen}>
      <MenuLabel divided={false}>Review agent</MenuLabel>
      <MenuHint>{`Started ${timeAgo(review.startedAt)}. It reports here, and posts nothing to GitHub.`}</MenuHint>
      {review.outdated && <MenuHint className="text-amber">The PR has new commits since this review.</MenuHint>}
      {review.summary && <MenuItem onClick={readReport}><MenuTitle>Read the report</MenuTitle></MenuItem>}
      {review.session && caps.tmux && <MenuItem onClick={watch}><MenuTitle>Watch in terminal</MenuTitle></MenuItem>}
      {!running && (
        <MenuItem disabled={again.isPending} title="Review the PR's newest commits, in the same checkout; ends the last reviewer if its terminal is still open" onClick={() => again.mutate()}>
          <MenuTitle>Review again</MenuTitle>
        </MenuItem>
      )}
      <MenuLabel>Put away</MenuLabel>
      <MenuHint>
        {'Ends the reviewer if it runs and removes its checkout, '}
        <span className="font-mono [overflow-wrap:anywhere]" title={review.path}>{shortPath(review.path)}</span>
        {'. It goes by itself once the PR is merged or closed.'}
      </MenuHint>
      <MenuItem disabled={discard.isPending} onClick={() => discard.mutate()}><MenuTitle>Discard</MenuTitle></MenuItem>
    </Menu>
  );
}

/** Review, or the review agent's review; nothing on a PR that isn't awaiting your review. */
export function ReviewAgent({ pr, caps }: { pr: Pr; caps: Capabilities }) {
  const start = useReviewAction(pr, 'start', () => {});
  if (pr.agentReview) return <ReviewMenu pr={pr} review={pr.agentReview} caps={caps} />;
  if (pr.canAgentReview === undefined) return null;
  const title = pr.canAgentReview
    ? 'A read-only Claude reviews this PR in its own checkout and reports back here; it posts nothing to GitHub'
    : `Clone ${pr.repo} into one of your folders to review its PRs here`;
  return (
    <Button type="button" variant="secondary" size="sm" disabled={!pr.canAgentReview || start.isPending || start.isSuccess} title={title} onClick={() => start.mutate()}>
      Review
    </Button>
  );
}
