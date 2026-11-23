import { CopyButton } from '../../components/CopyButton';
import { EditorLink } from '../../components/EditorLink';
import { LiveTime } from '../../components/LiveTime';
import { OpenMenu } from '../../components/OpenMenu';
import { ResumeButton } from '../../components/ResumeButton';
import { endStateOf } from '../../lib/end-states';
import { shellQuote, shortPath } from '../../lib/paths';
import { sessionDetail, sessionDot, sessionLabel, sessionTitle, type SessionLike } from '../../lib/shared';
import type { Capabilities, LiveSession } from '../../lib/types';
import { TaskFromWork } from '../panes/TaskFromWork';
import { CleanupMenu } from './CleanupMenu';
import type { RepoGroup, WorktreeRow } from './types';
import { Pill } from '../../components/Pill';
import { Dot } from '../../components/Dot';
import { cx } from '../../lib/cx';
import { addedClass, removedClass } from '../../components/classes';

/* A worktree's row: its branch, local changes, PR, agents, last activity, and ways in. */

const MAX_INLINE_SESSIONS = 2;

// A cell's lines, one fact or a few chips each, cut short with … rather than wrapping.
const LINES = 'grid gap-0.5 min-w-0';
const LINE = 'flex items-center gap-1.5 min-w-0 *:min-w-0';
const SMALL = 'text-xs leading-xs';
const SECONDARY = 'text-xs leading-xs text-gray-500 truncate';
const TAG = 'text-xs font-medium whitespace-nowrap';
const STRONG = 'font-semibold text-gray-900';

function BranchCell({ w }: { w: WorktreeRow }) {
  const secondary = [shortPath(w.path), w.lastCommit?.subject].filter(Boolean).join('  ·  ');
  return (
    <td>
      <div className={LINES}>
        <div className={LINE}>
          <span className="font-mono text-[12.5px] font-semibold text-gray-900 truncate" title={w.branch ?? undefined}>{w.branch ?? (w.detached ? `detached @ ${w.head?.slice(0, 7)}` : '—')}</span>
          {w.isMain && <span className={cx(TAG, 'text-gray-500')}>main</span>}
          {w.hubTask && <a href={`/tasks#${encodeURIComponent(w.hubTask.id)}`} className={cx(TAG, 'text-accent')} title={`Task: ${w.hubTask.title}`}>Task</a>}
          {w.locked && <Pill tone="amber">locked</Pill>}
        </div>
        <span className={SECONDARY} title={`${w.path}${w.lastCommit?.subject ? `\n${w.lastCommit.subject}` : ''}`}>{secondary}</span>
      </div>
    </td>
  );
}

function LocalCell({ w }: { w: WorktreeRow }) {
  if (w.prunable) return <td><Pill tone="red">missing on disk</Pill></td>;
  const s = w.status;
  if (!s) return <td>—</td>;
  if (s.error) return <td><Pill tone="red" title={s.error}>git error</Pill></td>;
  const dirty = s.changed || s.untracked || s.conflicted;
  const notPushed = Boolean(w.branch) && !s.upstream;
  return (
    <td>
      <div className={LINES}>
        <div className={LINE}>
          {s.conflicted > 0 && <Pill tone="red">{`${s.conflicted} conflicted`}</Pill>}
          {s.changed > 0 && <Pill tone="amber">{`${s.changed} changed`}</Pill>}
          {s.untracked > 0 && <span className={cx(TAG, 'text-gray-500')}>{`${s.untracked} untracked`}</span>}
          {!dirty && <span className={cx(SMALL, 'text-gray-500')}>clean</span>}
        </div>
        {(s.ahead > 0 || s.behind > 0 || notPushed) && (
          <div className={cx(LINE, SECONDARY)}>
            {s.ahead > 0 && <span className={addedClass} title="Commits ahead of upstream">{`↑${s.ahead}`}</span>}
            {s.behind > 0 && <span className={removedClass} title="Commits behind upstream">{`↓${s.behind}`}</span>}
            {notPushed && <span>not pushed</span>}
          </div>
        )}
      </div>
    </td>
  );
}

const PR_STATE_PILLS: Record<string, [string, string]> = { MERGED: ['Merged', 'purple'], CLOSED: ['Closed', 'red'] };
const CHECK_PILLS: Record<string, [string, string, string]> = {
  passing: ['✓', 'green', 'Checks passing'],
  failing: ['✗ checks', 'red', 'Checks failing'],
  pending: ['● running', 'amber', 'Checks running'],
};
const REVIEW_PILLS: Record<string, [string, string]> = {
  APPROVED: ['Approved', 'green'],
  CHANGES_REQUESTED: ['Changes requested', 'red'],
  REVIEW_REQUIRED: ['Needs review', ''],
};

function PrCell({ w }: { w: WorktreeRow }) {
  const pr = w.pr;
  if (!pr) return <td><span className={cx(SMALL, 'text-gray-500')}>—</span></td>;
  const { checks } = pr;
  const isOpen = pr.state === 'OPEN';
  const checksTitle = checks
    ? `${checks.passing} passing · ${checks.failing} failing · ${checks.pending} running${checks.heldCount ? ` · ${checks.heldCount} awaiting approval` : ''}`
    : undefined;
  const closed = PR_STATE_PILLS[pr.state] ?? [pr.state, ''];
  const check = checks ? CHECK_PILLS[checks.state] : undefined;
  const review = pr.reviewDecision ? REVIEW_PILLS[pr.reviewDecision] : undefined;
  return (
    <td>
      <div className={LINES}>
        <div className={LINE}>
          <a href={pr.url} target="_blank" rel="noopener" className="font-mono text-xs">{`#${pr.number}`}</a>
          {!isOpen && <Pill tone={closed[1]}>{closed[0]}</Pill>}
          {isOpen && pr.isDraft && <Pill>Draft</Pill>}
          {isOpen && check && <Pill tone={check[1]} title={checksTitle ?? check[2]}>{check[0]}</Pill>}
          {isOpen && review && <Pill tone={review[1]}>{review[0]}</Pill>}
          {isOpen && pr.mergeStateStatus === 'DIRTY' && <Pill tone="red" title="Merge conflict with the base branch">Conflict</Pill>}
        </div>
        <span className={SECONDARY} title={pr.title}>{pr.title}</span>
      </div>
    </td>
  );
}

function DetailLine({ session }: { session: SessionLike }) {
  const detail = sessionDetail(session);
  if (!detail) return null;
  const text = detail.label ? `${detail.label}: ${detail.text}` : detail.text;
  return <span className={SECONDARY} title={text}>{text}</span>;
}

function InlineSession({ s }: { s: LiveSession }) {
  return (
    <div className={LINES}>
      <div className={LINE}>
        <Dot state={sessionDot(s)} />
        <span className={cx(SMALL, 'shrink-0 whitespace-nowrap')}>{sessionLabel(s)}</span>
        <span className={cx(SMALL, STRONG, 'truncate')} title={s.cwd}>{sessionTitle(s)}</span>
      </div>
      <DetailLine session={s} />
    </div>
  );
}

function AgentCell({ w, caps }: { w: WorktreeRow; caps: Capabilities }) {
  const live = [...w.agents.live].sort((a, b) => (b.statusUpdatedAt ?? 0) - (a.statusUpdatedAt ?? 0));
  if (live.length > 0) {
    const hidden = live.length - MAX_INLINE_SESSIONS;
    return (
      <td>
        <div className={LINES}>
          {live.slice(0, MAX_INLINE_SESSIONS).map((s) => <InlineSession key={s.sessionId} s={s} />)}
          {hidden > 0 && <a className={SECONDARY} href="/">{`+${hidden} more on the Agents page`}</a>}
        </div>
      </td>
    );
  }
  const last = w.agents.last;
  if (!last) return <td><span className={cx(SMALL, 'text-gray-500')}>—</span></td>;
  const ending = last.transcript ? endStateOf(last.transcript) : null;
  return (
    <td>
      <div className={LINES}>
        <div className={LINE}>
          {w.flags.includes('agent-interrupted')
            ? <Pill tone="amber" title={ending?.hint}><LiveTime since={last.updatedAt} prefix="Interrupted " /></Pill>
            : <span className={cx(SMALL, 'text-gray-500')} title={ending?.hint}><LiveTime since={last.updatedAt} prefix="Last session " /></span>}
          <ResumeButton session={last} caps={caps} />
        </div>
        <span className={cx(SMALL, STRONG)}>{sessionTitle(last)}</span>
        <DetailLine session={last} />
      </div>
    </td>
  );
}

function ActionsCell({ repo, w, caps }: { repo: RepoGroup; w: WorktreeRow; caps: Capabilities }) {
  return (
    <td>
      <div className="flex flex-nowrap justify-end gap-1">
        {!w.prunable && (caps.terminal ? <OpenMenu path={w.path} sessions={w.agents.recent ?? []} caps={caps} /> : <CopyButton label="cd" text={`cd ${shellQuote(w.path)}`} />)}
        {!w.prunable && <EditorLink path={w.path} caps={caps} />}
        {!w.prunable && !w.hubTask && w.canMakeTask && <TaskFromWork from={{ worktree: w.path }} />}
        {w.flags.includes('cleanup') && <CleanupMenu repo={repo} w={w} />}
      </div>
    </td>
  );
}

export function WorktreeRowView({ repo, w, caps }: { repo: RepoGroup; w: WorktreeRow; caps: Capabilities }) {
  return (
    <tr className={w.needsAttention ? '[&>td:first-child]:shadow-[inset_3px_0_0_var(--red)]' : undefined}>
      <BranchCell w={w} />
      <LocalCell w={w} />
      <PrCell w={w} />
      <AgentCell w={w} caps={caps} />
      <td className="whitespace-nowrap text-gray-500 text-xs tabular-nums"><LiveTime since={w.lastActivityAt} /></td>
      <ActionsCell repo={repo} w={w} caps={caps} />
    </tr>
  );
}
