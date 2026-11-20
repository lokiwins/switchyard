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

/* A PR's card: where it stands, its branch and size, its checks, reviews and local checkout, and Copilot. */

const MAX_LISTED_CHECKS = 3;

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
  if (!checks || checks.total === 0) return <span className="sig muted">No checks</span>;
  return (
    <>
      {checks.failing > 0 && <span className="sig red">{`✗ ${checks.failing} failed: `}<CheckLinks checks={checks.failed} /></span>}
      {checks.pending > 0 && <span className="sig amber" title={checks.running.map((c) => c.name).join('\n')}>{`● ${checks.pending} running`}</span>}
      {checks.passing > 0 && <span className="sig green" title={`${checks.passing} checks passed`}>{`✓ ${checks.passing}`}</span>}
      {checks.heldCount > 0 && (
        <span className="sig muted" title={`Awaiting manual approval:\n${checks.held.map((c) => c.name).join('\n')}`}>{`⏸ ${checks.heldCount} on hold`}</span>
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
  if (reviews.length === 0 && requested.length === 0) return <span className="sig muted">No reviews</span>;
  return (
    <span className="chips">
      {reviews.map((r, i) => {
        const [glyph, tone, verb] = REVIEW_GLYPHS[r.state] ?? ['·', 'muted', r.state.toLowerCase()];
        return <span key={`${r.login}:${i}`} className={`chip ${tone}`} title={`${r.login} ${verb} ${timeAgo(Date.parse(r.submittedAt))}`}>{`${glyph} ${shortLogin(r.login)}`}</span>;
      })}
      {requested.map((r) => (
        <span key={r.name} className="chip waiting" title={`Review requested from ${r.name}`}>{`⏳ ${r.isTeam ? r.name.split('/').pop() : shortLogin(r.name)}`}</span>
      ))}
    </span>
  );
}

const agentLabel = (a: { status: string; parked?: boolean }) => (a.parked ? 'parked' : ({ busy: 'working', idle: 'waiting' } as Record<string, string>)[a.status] ?? a.status);

/** Where it's checked out here, who's working in it, and ways in; or how to check it out. */
function LocalCheckout({ pr, caps }: { pr: Pr; caps: Capabilities }) {
  const local = pr.local;
  if (!local) {
    return <span className="sig muted">Not checked out<CopyButton label="checkout" text={`gh pr checkout ${pr.number} --repo ${pr.repo}`} /></span>;
  }
  return (
    <span className="sig">
      <span className="path-inline" title={local.path}>{shortPath(local.path)}</span>
      {local.dirty && <span className="sig amber">uncommitted</span>}
      {local.agents.map((a, i) => (
        <span key={i} className="sig muted" title={a.name}>
          <span className={`dot ${a.parked ? 'parked' : a.status}`} aria-hidden="true" />{agentLabel(a)}
        </span>
      ))}
      {caps.terminal ? <OpenMenu path={local.path} sessions={local.sessions ?? []} caps={caps} /> : <CopyButton label="cd" text={`cd ${shellQuote(local.path)}`} />}
      <EditorLink path={local.path} caps={caps} />
    </span>
  );
}

function Meta({ pr, showAuthor }: { pr: Pr; showAuthor: boolean }) {
  return (
    <div className="pr-meta">
      {pr.headRefName && <span className="mono">{pr.headRefName}<span className="arrow"> → </span>{pr.baseRefName}</span>}
      {showAuthor && pr.author?.login && <span className="sep">{pr.author.login}</span>}
      <LiveTime since={Date.parse(pr.updatedAt)} prefix="updated " className="sep" />
      {pr.fetchedAt && (
        <LiveTime since={pr.fetchedAt} prefix="checked " className={pr.refreshError ? 'sep stale' : 'sep'}
          label={pr.refreshError ? `Last refresh failed: ${pr.refreshError}` : undefined} />
      )}
      {Number.isFinite(pr.additions) && (
        <span className="sep">
          <span className="num add">{`+${pr.additions}`}</span>{' '}<span className="num del">{`−${pr.deletions}`}</span>
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
    <li>
      <article className="pr">
        <div className="pr-line">
          <span className={`pill ${stage.tone}`}>{stage.label}</span>
          <a className="pr-title" href={pr.url} target="_blank" rel="noopener" title={pr.title}>{pr.title}</a>
          <span className="pr-ref">{`${pr.repo.split('/').pop()}#${pr.number}`}</span>
        </div>
        <Meta pr={pr} showAuthor={showAuthor} />
        <div className="pr-signals">
          {pr.error ? <span className="sig red">{`Could not load details: ${pr.error}`}</span> : (
            <>
              <span className="sig-group"><CheckSignals checks={pr.checks} /></span>
              <Reviews pr={pr} />
              <LocalCheckout pr={pr} caps={caps} />
            </>
          )}
        </div>
        <div className="pr-side">{canAskCopilot && <CopilotButton pr={pr} />}</div>
      </article>
    </li>
  );
}
