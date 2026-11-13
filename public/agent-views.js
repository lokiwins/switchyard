import { copyButton, h, shellQuote, shortPath, timeAgo } from './dom.js';
import { actionButton, jumpButton, post, tmuxPlace } from './actions.js';
import { sessionRow, statusBadge, taskLink, whereLabel } from './session-row.js';
import { answerElsewhere, foldsWhenParked, sessionDetail, sessionDot, sessionLabel, sessionTitle } from './session-text.js';
import { approvalButtons, approvalDetail, approvalsFor, endMenu, replyMenu, stopButton } from './session-controls.js';
import { terminalButton } from './live-terminal.js';
import { answerMenu, planButton } from './screen-answer.js';
import { pendingText } from './pending-tasks.js';

function sessionTone(session) {
  if (session.status === 'busy') return 'green';
  return session.status === 'idle' && !session.parked ? 'amber' : '';
}

/** The repo and worktree a live session is running in, if it is inside one. */
export function locateSession(state, session) {
  for (const repo of state.repos) {
    const worktree = repo.worktrees.find((w) => w.agents.live.some((s) => s.pid === session.pid));
    if (worktree) return { repo, worktree };
  }
  return null;
}

/** @param {{ isOpen: (id: string) => boolean, toggle: (id: string) => void } | null} details */
export function renderLiveRow(state, session, details = null) {
  const where = locateSession(state, session);
  const pr = where?.worktree.pr;
  const approvals = approvalsFor(state, session);
  return sessionRow({
    className: session.parked ? 'is-parked' : null,
    badge: statusBadge({ tone: sessionTone(session), dot: sessionDot(session), label: sessionLabel(session) }),
    title: sessionTitle(session),
    titleHint: [session.cwd, session.host && `running in ${session.host.kind === 'tmux' ? `tmux window ${tmuxPlace(session.host)}` : session.host.label}`].filter(Boolean).join(' · '),
    where: whereLabel({
      repoName: where?.repo.name,
      branch: where?.worktree.branch ?? session.transcript?.gitBranch,
      path: shortPath(session.cwd),
    }),
    detail: approvals.length > 0 ? approvalDetail(approvals) : sessionDetail(session),
    note: answerElsewhere(session, approvals),
    detailOpen: details?.isOpen(session.sessionId) ?? false,
    onDetailToggle: details ? () => details.toggle(session.sessionId) : null,
    time: timeAgo(session.statusUpdatedAt),
    timeHint: `${sessionLabel(session)} since ${new Date(session.statusUpdatedAt).toLocaleString()}`,
    actions: [
      approvals.length > 0 && approvalButtons(approvals, session),
      planButton(session, approvals),
      answerMenu(session, approvals),
      replyMenu(session),
      stopButton(session),
      taskLink(where?.worktree.task),
      pr && h('a', { href: pr.url, target: '_blank', rel: 'noopener', class: 'small' }, `#${pr.number}`),
      terminalButton(session),
      jumpButton(session),
      endMenu(session),
      copyButton('cd', `cd ${shellQuote(session.cwd)}`),
    ],
  });
}

/** A task started from New task whose session hasn't shown up yet. */
const PENDING_TONE = { trust: 'amber', exited: 'red' };
const PENDING_DOT = { trust: 'idle', exited: null };

/** Answer Claude's trust question for a starting task (anything with its worktree's `path`), as you would in its tmux window. */
export function trustButtons(task) {
  const answer = (trust) => async () => {
    await post('/api/tasks/trust', { path: task.path, trust });
    return trust ? 'Trusted the folder; Claude is starting' : 'Not trusted; Claude will exit';
  };
  return [
    actionButton('Trust folder', `Let Claude read, edit and run files in ${task.path}`, answer(true), 'btn btn-sm'),
    actionButton("Don't trust", 'Claude exits; the worktree is kept', answer(false), 'btn btn-sm btn-secondary'),
  ];
}

/** A task started from New task whose session hasn't shown up yet. */
export function renderPendingRow(task, now = Date.now()) {
  const text = pendingText(task, now);
  return sessionRow({
    className: `is-pending is-${task.stage}`,
    badge: statusBadge({ tone: PENDING_TONE[task.stage] ?? '', dot: task.stage in PENDING_DOT ? PENDING_DOT[task.stage] : 'busy', label: text.label }),
    title: task.prompt,
    titleHint: [task.path, task.place && `in tmux window ${task.place}`].filter(Boolean).join(' · ') || task.prompt,
    where: whereLabel({ repoName: task.repoName, branch: task.branch, path: task.path ?? '' }),
    detail: { kind: task.stage === 'trust' ? 'needs-you' : 'pending', text: text.detail },
    note: text.note,
    time: timeAgo(task.createdAt, now),
    timeHint: `Started ${new Date(task.createdAt).toLocaleString()}`,
    actions: task.stage === 'trust' ? trustButtons(task) : [],
  });
}

// Questions waiting on you first, then working, then the rest.
const rank = (s) => (s.needsYou ? 3 : s.status === 'busy' ? 2 : 1);
const byRecent = (a, b) => (b.statusUpdatedAt ?? 0) - (a.statusUpdatedAt ?? 0);

/**
 * Running sessions: working and waiting first, then parked ones (idle over a
 * day) whose tab is still open. Parked ones with no tab to go back to sit
 * behind a toggle (none without `onToggleParked`) unless `showParked` is on.
 */
export function renderLiveList(state, sessions, { showParked, onToggleParked, details, emptyText }) {
  if (sessions.length === 0) return [h('div', { class: 'empty' }, emptyText)];
  const working = sessions.filter((s) => !s.parked).sort((a, b) => rank(b) - rank(a) || byRecent(a, b));
  const parkedInTabs = sessions.filter((s) => s.parked && !foldsWhenParked(s)).sort(byRecent);
  const active = [...working, ...parkedInTabs];
  const parked = sessions.filter(foldsWhenParked).sort(byRecent);
  const row = (s) => renderLiveRow(state, s, details);
  return [
    active.length > 0 && h('ul', { class: 'list' }, active.map(row)),
    parked.length > 0 && active.length > 0 && onToggleParked && h('button', { type: 'button', class: 'list-toggle', onclick: onToggleParked },
      showParked ? 'Hide parked sessions' : `Show ${parked.length} parked session${parked.length > 1 ? 's' : ''} (idle over a day, no open tab)`),
    parked.length > 0 && (showParked || active.length === 0) && h('ul', { class: 'list' }, parked.map(row)),
  ].filter(Boolean);
}
