import type { ReactNode } from 'react';
import { LiveTime } from '../../components/LiveTime';
import { cx } from '../../lib/cx';
import { isDue, useNow } from '../../lib/time';
import type { Detail, LiveSession, TrackerTask } from '../../lib/types';

/*
 * One line in a session list, shared by live, starting and ended sessions so
 * they read the same: status, who and where, what it's doing or said, when,
 * and what you can do.
 */

export function StatusBadge({ tone = '', dot, label, hint }: { tone?: string; dot?: string | null; label: string; hint?: string }) {
  return (
    <span className={cx('pill', tone)} title={hint}>
      {dot && <span className={cx('dot', dot)} aria-hidden="true" />}
      {label}
    </span>
  );
}

/** "repo · branch" when the session is in a known worktree, otherwise its folder. */
export function WhereLabel({ repoName, branch, path }: { repoName?: string | null; branch?: string | null; path: string }) {
  if (!repoName) return <span className="mono">{path}</span>;
  return <>{repoName}{branch && <>{' · '}<span className="mono">{branch}</span></>}</>;
}

function RowWho({ title, titleHint, where }: { title: string; titleHint?: string; where: ReactNode }) {
  return (
    <div className="row-who">
      <span className="row-title" title={titleHint ?? title}>{title}</span>
      {where && <span className="row-where">{where}</span>}
    </div>
  );
}

/** A session's one-line detail; with `onToggle` it's a button that shows all of it in place. */
function DetailLine({ detail, open, onToggle }: { detail: Detail | null; open: boolean; onToggle?: () => void }) {
  if (!detail) return <span className="row-detail muted">Nothing yet</span>;
  const kind = `row-detail is-${detail.kind}`;
  // Some details have a fuller form to show when opened, e.g. a dialog as the terminal draws it.
  const content = (
    <>
      {detail.label && <span className="row-detail-label">{`${detail.label}:`}</span>}
      {open && detail.full ? <span className="row-detail-full">{detail.full}</span> : detail.text}
    </>
  );
  if (!onToggle) return <span className={kind} title={detail.text}>{content}</span>;
  return (
    <button type="button" className={cx(kind, 'is-expandable', open && 'is-open')} aria-expanded={open}
      title={open ? 'Click to collapse' : 'Click to show all of it'} onClick={onToggle}>
      {content}
    </button>
  );
}

const thousands = (tokens: number) => `${Math.round(tokens / 1000)}k`;

/**
 * A running session's alerts (see src/stuck.js): stuck, once it has been
 * working with nothing new for the time set in Settings › Agents (shown by
 * the page's clock, so nothing else redraws); and context over the size set
 * there. Alerts only: nothing is stopped.
 */
function SessionAlerts({ session }: { session: LiveSession }) {
  const now = useNow();
  const stuck = Boolean(session.stuckAt) && isDue(session.stuckAt, now);
  if (!stuck && !session.contextHigh) return null;
  return (
    <span className="row-alerts">
      {stuck && (
        <span className="session-alert is-stuck"
          title="Working, with nothing new in its transcript for the time set in Settings › Agents. It may be stuck, or running something long.">
          {'Stuck? '}<LiveTime since={session.lastActivityAt} prefix="last activity " />
        </span>
      )}
      {session.contextHigh && (
        <span className="session-alert is-full" title="Its context is over the size set in Settings › Agents; /compact or a fresh session may help">
          {`Context ${thousands(session.transcript?.contextTokens ?? 0)} tokens`}
        </span>
      )}
    </span>
  );
}

export interface RowProps {
  className?: string | null;
  badge: ReactNode;
  title: string;
  titleHint?: string;
  where: ReactNode;
  detail: Detail | null;
  note?: string | null;
  alertsFor?: LiveSession;
  detailOpen?: boolean;
  onDetailToggle?: () => void;
  since: number | null | undefined;
  timeHint: string;
  actions: ReactNode;
}

export function SessionRow({
  className, badge, title, titleHint, where, detail, note, alertsFor, detailOpen = false, onDetailToggle, since, timeHint, actions,
}: RowProps) {
  const line = <DetailLine detail={detail} open={detailOpen} onToggle={onDetailToggle} />;
  return (
    <li className={cx('list-row', className)}>
      {badge}
      <RowWho title={title} titleHint={titleHint} where={where} />
      {note || alertsFor ? (
        // A note, and a running session's alerts, go on their own lines under the detail.
        <div className="row-detail-cell">
          {line}
          {note && <span className="row-note" title={note}>{note}</span>}
          {alertsFor && <SessionAlerts session={alertsFor} />}
        </div>
      ) : line}
      <LiveTime since={since} className="row-time" title={timeHint} />
      <div className="actions">{actions}</div>
    </li>
  );
}

/** A link back to the ClickUp task a session's branch names. */
export function TrackerLink({ task }: { task?: TrackerTask | null }) {
  if (!task?.url) return null;
  return (
    <a href={task.url} target="_blank" rel="noopener noreferrer" className="small task-ref" title={`ClickUp task: ${task.name}`}>
      {task.customId ?? 'ClickUp'}
    </a>
  );
}
