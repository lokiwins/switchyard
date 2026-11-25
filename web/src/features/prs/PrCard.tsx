import { useMutation } from '@tanstack/react-query';
import { Fragment, type ReactNode } from 'react';
import { CopyButton } from '../../components/CopyButton';
import { EditorLink } from '../../components/EditorLink';
import { LiveTime } from '../../components/LiveTime';
import { OpenMenu } from '../../components/OpenMenu';
import { post } from '../../lib/api';
import { shellQuote, shortPath } from '../../lib/paths';
import { timeAgo } from '../../lib/time';
import type { Capabilities } from '../../lib/types';
import { toast } from '../../stores/toast';
import { refreshPrs } from './api';
import { stageOf } from './filters';
import type { CheckRef, Checks, Pr } from './types';
import { Button } from '../../components/Button';
import { Pill } from '../../components/Pill';
import { cx } from '../../lib/cx';
import { Dot } from '../../components/Dot';
import { addedClass, removedClass, sepClass } from '../../components/classes';
import { ReviewAgent } from './ReviewAgent';

/* A PR's card: where it stands, its branch and size, its checks, reviews and local checkout, Copilot, and a review agent. */

const MAX_LISTED_CHECKS = 3;

/** A line of facts under a PR's title: its branch, author, when, size. */
export const metaClass = 'flex flex-wrap items-baseline gap-x-1.5 gap-y-0 min-w-0 text-xs leading-xs text-gray-500';

/** One signal (checks, reviews, the local checkout), in its tone. A red one wraps, and its links stay red. */
const SIG_TONES: Record<string, string> = {
  red: 'text-red font-semibold whitespace-normal [&_a]:[color:inherit] [&_a]:underline [&_a]:decoration-[color-mix(in_srgb,currentColor_40%,transparent)]',
  amber: 'text-amber font-medium whitespace-nowrap',
  green: 'text-green whitespace-nowrap',
  muted: 'text-gray-500 whitespace-nowrap',
  '': 'whitespace-nowrap',
};
const sig = (tone: keyof typeof SIG_TONES = '') => cx('inline-flex items-center gap-1.5', SIG_TONES[tone]);
/** A signal straight in the row: on a phone it shrinks rather than widen the page. */
const TOP = 'max-phone:max-w-full max-phone:min-w-0';

const CHIP_TONES: Record<string, string> = {
  green: 'font-semibold bg-green-soft text-green',
  red: 'font-semibold bg-red-soft text-red',
  muted: 'font-medium bg-neutral-soft text-gray-500',
  waiting: 'font-medium bg-transparent text-gray-500 shadow-[inset_0_0_0_1px_var(--hairline)]',
};
const chip = (tone: string) => cx('px-1.5 rounded-xs leading-[18px] text-2xs', CHIP_TONES[tone] ?? 'font-semibold bg-neutral-soft text-gray-700');

const MONO = 'font-mono text-[11.5px]';

function CheckLinks({ checks }: { checks: CheckRef[] }) {
  const shown = checks.slice(0, MAX_LISTED_CHECKS);
  const extra = checks.length - shown.length;
  return (
    <>
      {shown.map((c, i) => (
        <Fragment key={`${c.name}:${i}`}>
          {i > 0 && ', '}
          {c.url ? <a href={c.url} target="_blank" rel="noopener" title={c.name}>{c.label ?? c.name}</a> : <span title={c.name}>{c.label ?? c.name}</span>}
        </Fragment>
      ))}
      {extra > 0 && ` +${extra} more`}
    </>
  );
}

function CheckSignals({ checks }: { checks?: Checks | null }) {
  if (!checks || checks.total === 0) return <span className={sig('muted')}>No checks</span>;
  return (
    <>
      {checks.failing > 0 && <span className={sig('red')}>{`✗ ${checks.failing} failed: `}<CheckLinks checks={checks.failed} /></span>}
      {checks.pending > 0 && <span className={sig('amber')} title={checks.running.map((c) => c.name).join('\n')}>{`● ${checks.pending} running`}</span>}
      {checks.passing > 0 && <span className={sig('green')} title={`${checks.passing} checks passed`}>{`✓ ${checks.passing}`}</span>}
      {checks.heldCount > 0 && (
        <span className={sig('muted')} title={`Awaiting manual approval:\n${checks.held.map((c) => c.name).join('\n')}`}>{`⏸ ${checks.heldCount} on hold`}</span>
      )}
    </>
  );
}

const REVIEW_GLYPHS: Record<string, [string, string, string]> = {
  APPROVED: ['✓', 'green', 'approved'],
  CHANGES_REQUESTED: ['✗', 'red', 'requested changes'],
  COMMENTED: ['💬', 'muted', 'commented'],
  DISMISSED: ['–', 'muted', 'review dismissed'],
};

const shortLogin = (login: string) => login.replace(/-pull-request-reviewer$/, '');

function Reviews({ pr }: { pr: Pr }) {
  const reviews = pr.reviews ?? [];
  const requested = pr.requested ?? [];
  if (reviews.length === 0 && requested.length === 0) return <span className={cx(sig('muted'), TOP)}>No reviews</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {reviews.map((r, i) => {
        const [glyph, tone, verb] = REVIEW_GLYPHS[r.state] ?? ['·', 'muted', r.state.toLowerCase()];
        return <span key={`${r.login}:${i}`} className={chip(tone)} title={`${r.login} ${verb} ${timeAgo(Date.parse(r.submittedAt))}`}>{`${glyph} ${shortLogin(r.login)}`}</span>;
      })}
      {requested.map((r) => (
        <span key={r.name} className={chip('waiting')} title={`Review requested from ${r.name}`}>{`⏳ ${r.isTeam ? r.name.split('/').pop() : shortLogin(r.name)}`}</span>
      ))}
    </span>
  );
}

const agentLabel = (a: { status: string; parked?: boolean }) => (a.parked ? 'parked' : ({ busy: 'working', idle: 'waiting' } as Record<string, string>)[a.status] ?? a.status);

/** Where it's checked out here, who's working in it, and ways in; or how to check it out. */
function LocalCheckout({ pr, caps }: { pr: Pr; caps: Capabilities }) {
  const local = pr.local;
  if (!local) {
    return <span className={cx(sig('muted'), TOP)}>Not checked out<CopyButton label="checkout" text={`gh pr checkout ${pr.number} --repo ${pr.repo}`} /></span>;
  }
  return (
    <span className={cx(sig(), TOP)}>
      <span className={cx(MONO, 'text-gray-700 max-phone:min-w-0 max-phone:truncate')} title={local.path}>{shortPath(local.path)}</span>
      {local.dirty && <span className={sig('amber')}>uncommitted</span>}
      {local.agents.map((a, i) => (
        <span key={i} className={sig('muted')} title={a.name}>
          <Dot state={a.parked ? 'parked' : a.status} />{agentLabel(a)}
        </span>
      ))}
      {caps.terminal ? <OpenMenu path={local.path} sessions={local.sessions ?? []} caps={caps} /> : <CopyButton label="cd" text={`cd ${shellQuote(local.path)}`} />}
      <EditorLink path={local.path} caps={caps} />
    </span>
  );
}

function Meta({ pr, showAuthor }: { pr: Pr; showAuthor: boolean }) {
  return (
    <div className={metaClass}>
      {pr.headRefName && <span className={MONO}>{pr.headRefName}<span className="text-gray-400"> → </span>{pr.baseRefName}</span>}
      {showAuthor && pr.author?.login && <span className={sepClass}>{pr.author.login}</span>}
      <LiveTime since={Date.parse(pr.updatedAt)} prefix="updated " className={sepClass} />
      {pr.fetchedAt && (
        <LiveTime since={pr.fetchedAt} prefix="checked " className={cx(sepClass, pr.refreshError && 'text-amber')}
          label={pr.refreshError ? `Last refresh failed: ${pr.refreshError}` : undefined} />
      )}
      {Number.isFinite(pr.additions) && (
        <span className={sepClass}>
          <span className={addedClass}>{`+${pr.additions}`}</span>{' '}<span className={removedClass}>{`−${pr.deletions}`}</span>
          <span>{` · ${pr.changedFiles} file${pr.changedFiles === 1 ? '' : 's'}`}</span>
        </span>
      )}
    </div>
  );
}

/** Ask Copilot for a review; once asked, it says so until GitHub reports it. */
function CopilotButton({ pr }: { pr: Pr }) {
  const ask = useMutation({
    mutationFn: () => post('/api/prs/copilot-review', { repo: pr.repo, number: pr.number }),
    onSuccess: () => {
      toast(`Copilot review requested on #${pr.number}`);
      void refreshPrs().catch(() => {});
    },
    onError: (error) => toast(`Could not request Copilot review: ${error.message}`),
  });
  if (!pr.copilot) return null;
  if (pr.copilot.requested) return <Button type="button" variant="secondary" size="sm" disabled>Copilot requested</Button>;
  const last = pr.copilot.lastReviewedAt;
  let label: ReactNode = last ? '↻ Copilot review' : 'Copilot review';
  if (ask.isPending || ask.isSuccess) label = 'Requesting…';
  if (ask.isError) label = 'Retry Copilot review';
  return (
    <Button type="button" variant="secondary" size="sm" disabled={ask.isPending || ask.isSuccess} onClick={() => ask.mutate()}
      title={last ? `Ask Copilot to review again (last reviewed ${timeAgo(Date.parse(last))})` : 'Ask Copilot to review this PR'}>
      {label}
    </Button>
  );
}

export function PrCard({ pr, showAuthor, canAskCopilot, caps }: { pr: Pr; showAuthor: boolean; canAskCopilot: boolean; caps: Capabilities }) {
  const stage = stageOf(pr);
  return (
    <li className="py-2.5 px-2 -mx-2 hover:bg-hover">
      <article className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-[3px] items-center max-phone:grid-cols-1">
        <div className="flex items-center gap-2 min-w-0 max-tiny:flex-wrap max-tiny:gap-y-0">
          <Pill tone={stage.tone}>{stage.label}</Pill>
          <a className="truncate min-w-0 text-gray-900 font-semibold text-sm" href={pr.url} target="_blank" rel="noopener" title={pr.title}>{pr.title}</a>
          <span className="text-gray-400 font-mono text-[11.5px] whitespace-nowrap max-tiny:basis-full">{`${pr.repo.split('/').pop()}#${pr.number}`}</span>
        </div>
        <Meta pr={pr} showAuthor={showAuthor} />
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs leading-xs">
          {pr.error ? <span className={cx(sig('red'), TOP)}>{`Could not load details: ${pr.error}`}</span> : (
            <>
              <span className="contents"><CheckSignals checks={pr.checks} /></span>
              <Reviews pr={pr} />
              <LocalCheckout pr={pr} caps={caps} />
            </>
          )}
        </div>
        <div className="[grid-row:1/span_3] [grid-column:2] flex items-center gap-2 max-phone:[grid-row:auto] max-phone:[grid-column:1]">
          <ReviewAgent pr={pr} caps={caps} />
          {canAskCopilot && <CopilotButton pr={pr} />}
        </div>
      </article>
    </li>
  );
}
