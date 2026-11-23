import type { ReactNode } from 'react';
import { LiveTime } from '../../components/LiveTime';
import { cx } from '../../lib/cx';
import { isDue, useNow } from '../../lib/time';
import type { Detail, LiveSession, TrackerTask } from '../../lib/types';
import { Pill } from '../../components/Pill';
import { Dot } from '../../components/Dot';

/*
 * One line in a session list, shared by live, starting and ended sessions so
 * they read the same: status, who and where, what it's doing or said, when,
 * and what you can do.
 */

export function StatusBadge({ tone = '', dot, label, hint }: { tone?: string; dot?: string | null; label: string; hint?: string }) {
  return (
    <Pill tone={tone} title={hint}>
      {dot && <Dot state={dot} />}
      {label}
    </Pill>
  );
}

/** "repo · branch" when the session is in a known worktree, otherwise its folder. */
export function WhereLabel({ repoName, branch, path }: { repoName?: string | null; branch?: string | null; path: string }) {
  if (!repoName) return <span className={MONO}>{path}</span>;
  return <>{repoName}{branch && <>{' · '}<span className={MONO}>{branch}</span></>}</>;
}

const MONO = 'font-mono text-[11.5px]';

/*
 * A row's columns: status, who and where, what it's doing, when, and its
 * buttons. Narrower than a tablet, the detail goes under the title and the
 * time is left out; on a phone the row stacks: status and title, then the
 * detail, then the buttons.
 */
const ROW = [
  'grid items-center gap-3 py-[7px] px-2 -mx-2 has-[[data-detail-open]]:items-start',
  'grid-cols-[104px_minmax(200px,320px)_minmax(0,1fr)_72px_auto] max-tablet:grid-cols-[96px_minmax(0,1fr)_auto]',
  'max-phone:grid-cols-[auto_minmax(0,1fr)] max-phone:gap-y-1',
].join(' ');

/** A row's state, as its background: a task starting, waiting to be trusted or failed to start; an interruption; parked, faded. */
export type RowTone = 'pending' | 'trust' | 'exited' | 'interrupted' | 'parked';

// A tinted row keeps its tint under the pointer; a plain one lights up.
const ROW_TONES: Record<RowTone, string> = {
  pending: 'bg-[color-mix(in_srgb,var(--green)_5%,transparent)]',
  trust: 'bg-[color-mix(in_srgb,var(--amber)_7%,transparent)]',
  exited: 'bg-[color-mix(in_srgb,var(--red)_5%,transparent)]',
  interrupted: 'bg-[color-mix(in_srgb,var(--amber-soft)_70%,transparent)]',
  parked: 'opacity-60 hover:opacity-100 hover:bg-hover',
};

// Where the detail (or its cell, with a note or alerts) sits in the row: see ROW.
const DETAIL_PLACE = 'max-tablet:[grid-column:2/-1] max-tablet:row-start-2 max-phone:[grid-column:1/-1] max-phone:min-w-0';
const CELL_PLACE = 'max-phone:[grid-column:1/-1] max-phone:row-start-2 max-phone:min-w-0';

function RowWho({ title, titleHint, where }: { title: string; titleHint?: string; where: ReactNode }) {
  return (
    <div className="flex flex-col gap-px min-w-0 max-phone:col-start-2 max-phone:row-start-1">
      <span className="text-sm font-semibold truncate" title={titleHint ?? title}>{title}</span>
      {where && <span className="text-xs text-gray-500 truncate min-w-0">{where}</span>}
    </div>
  );
}

// A detail's colour by what it is; a task that failed to start shows its pending line in red, upright.
const DETAIL_TONES: Record<string, string> = {
  activity: 'text-green',
  prompt: 'text-gray-500',
  pending: 'text-gray-500 italic',
  failed: 'text-red',
};

function detailTone(kind: string, exited: boolean, open: boolean): string {
  if (exited && kind === 'pending') return 'text-red';
  return DETAIL_TONES[kind] ?? (open ? 'text-gray-900' : 'text-gray-700');
}

/** A session's one-line detail; with `onToggle` it's a button that shows all of it in place. `placed`: straight in the row's grid. */
function DetailLine({ detail, open, onToggle, exited, placed }: {
  detail: Detail | null; open: boolean; onToggle?: () => void; exited: boolean; placed: boolean;
}) {
  const place = placed ? DETAIL_PLACE : '';
  if (!detail) return <span className={cx('text-xs text-gray-400 truncate min-w-0', place)}>Nothing yet</span>;
  const label = detail.kind === 'needs-you' || detail.kind === 'cut-off' ? 'text-amber' : 'text-gray-500';
  // Some details have a fuller form to show when opened, e.g. a dialog as the terminal draws it.
  const content = (
    <>
      {detail.label && <span className={cx('mr-1 font-semibold', label)}>{`${detail.label}:`}</span>}
      {open && detail.full ? <span className="block mt-1 font-mono text-[11.5px] leading-[1.5]">{detail.full}</span> : detail.text}
    </>
  );
  const shown = open ? 'whitespace-pre-wrap overflow-visible' : 'truncate';
  const look = cx('text-xs min-w-0', detailTone(detail.kind, exited, open), shown, place);
  if (!onToggle) return <span className={look} title={detail.text}>{content}</span>;
  return (
    <button type="button" className={cx(look, '[font-family:inherit] [line-height:inherit] text-left cursor-pointer p-0 border-0 bg-transparent rounded-xs hover:text-gray-900')}
      aria-expanded={open} data-detail-open={open || undefined}
      title={open ? 'Click to collapse' : 'Click to show all of it'} onClick={onToggle}>
      {content}
    </button>
  );
}

const thousands = (tokens: number) => `${Math.round(tokens / 1000)}k`;

const ALERT = 'inline-block text-xs leading-xs px-1.5 rounded-full text-amber bg-amber-soft whitespace-nowrap';

/**
 * A running session's alerts (see src/stuck.js): stuck, once it has been
 * working with nothing new for the time set in Settings › Agents (shown by
 * the page's clock, so nothing else redraws); and context over the size set
 * there. Alerts only: nothing is stopped.
 */
export function SessionAlerts({ session }: { session: LiveSession }) {
  const now = useNow();
  const stuck = Boolean(session.stuckAt) && isDue(session.stuckAt, now);
  if (!stuck && !session.contextHigh) return null;
  return (
    <span className="flex flex-wrap gap-2">
      {stuck && (
        <span className={ALERT}
          title="Working, with nothing new in its transcript for the time set in Settings › Agents. It may be stuck, or running something long.">
          {'Stuck? '}<LiveTime since={session.lastActivityAt} prefix="last activity " />
        </span>
      )}
      {session.contextHigh && (
        <span className={ALERT} title="Its context is over the size set in Settings › Agents; /compact or a fresh session may help">
          {`Context ${thousands(session.transcript?.contextTokens ?? 0)} tokens`}
        </span>
      )}
    </span>
  );
}

/** A row's buttons, at its end; on a phone, a line of their own under it. */
export const rowActionsClass = 'flex flex-wrap justify-end gap-1 max-phone:[grid-column:1/-1] max-phone:row-start-3 max-phone:justify-start';

export interface RowProps {
  tone?: RowTone | null;
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
  /** Rows nested under this one, across its full width (a lead's workers). */
  nested?: ReactNode;
}

export function SessionRow({
  tone, badge, title, titleHint, where, detail, note, alertsFor, detailOpen = false, onDetailToggle, since, timeHint, actions, nested,
}: RowProps) {
  const exited = tone === 'exited';
  const celled = Boolean(note || alertsFor);
  const line = <DetailLine detail={detail} open={detailOpen} onToggle={onDetailToggle} exited={exited} placed={!celled} />;
  return (
    <li className={cx(ROW, tone ? ROW_TONES[tone] : 'hover:bg-hover')}>
      {badge}
      <RowWho title={title} titleHint={titleHint} where={where} />
      {celled ? (
        // A note, and a running session's alerts, go on their own lines under the detail.
        <div className={cx('flex flex-col gap-px min-w-0', CELL_PLACE)}>
          {line}
          {note && <span className="text-2xs text-gray-500 truncate" title={note}>{note}</span>}
          {alertsFor && <SessionAlerts session={alertsFor} />}
        </div>
      ) : line}
      <LiveTime since={since} className="text-xs text-gray-500 text-right whitespace-nowrap tabular-nums max-tablet:hidden" title={timeHint} />
      <div className={rowActionsClass}>{actions}</div>
      {nested}
    </li>
  );
}

/** A link back to the ClickUp task a session's branch names. */
export function TrackerLink({ task }: { task?: TrackerTask | null }) {
  if (!task?.url) return null;
  return (
    <a href={task.url} target="_blank" rel="noopener noreferrer" className="text-xs leading-xs" title={`ClickUp task: ${task.name}`}>
      {task.customId ?? 'ClickUp'}
    </a>
  );
}
