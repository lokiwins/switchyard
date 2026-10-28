import { copyButton, h, shellQuote, shortPath, timeAgo } from './dom.js';
import { jumpButton } from './actions.js';
import { sessionRow, statusBadge, whereLabel } from './session-row.js';

const STATUS_LABELS = { busy: 'Working', idle: 'Waiting', shell: 'Shell' };

export function sessionLabel(session) {
  return session.parked ? 'Parked' : STATUS_LABELS[session.status] ?? session.status;
}

export function sessionDot(session) {
  return session.parked ? 'parked' : session.status;
}

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

/** @param {{ isOpen: (id: string) => boolean, toggle: (id: string) => void } | null} prompts */
export function renderLiveRow(state, session, prompts = null) {
  const where = locateSession(state, session);
  const pr = where?.worktree.pr;
  return sessionRow({
    className: session.parked ? 'is-parked' : null,
    badge: statusBadge({ tone: sessionTone(session), dot: sessionDot(session), label: sessionLabel(session) }),
    title: session.name ?? session.sessionId.slice(0, 8),
    titleHint: session.host ? `${session.cwd} · running in ${session.host.label}` : session.cwd,
    where: whereLabel({
      repoName: where?.repo.name,
      branch: where?.worktree.branch ?? session.transcript?.gitBranch,
      path: shortPath(session.cwd),
    }),
    prompt: session.transcript?.lastPrompt,
    promptOpen: prompts?.isOpen(session.sessionId) ?? false,
    onPromptToggle: prompts ? () => prompts.toggle(session.sessionId) : null,
    time: timeAgo(session.statusUpdatedAt),
    timeHint: `${sessionLabel(session)} since ${new Date(session.statusUpdatedAt).toLocaleString()}`,
    actions: [
      pr && h('a', { href: pr.url, target: '_blank', rel: 'noopener', class: 'small' }, `#${pr.number}`),
      jumpButton(session),
      copyButton('cd', `cd ${shellQuote(session.cwd)}`),
    ],
  });
}

const rank = (s) => (s.status === 'busy' ? 2 : 1);
const byRecent = (a, b) => (b.statusUpdatedAt ?? 0) - (a.statusUpdatedAt ?? 0);

/**
 * Running sessions: working and waiting first, parked ones (idle over a day)
 * behind a toggle unless `parkedOpen` is forced on.
 */
export function renderLiveList(state, sessions, { showParked, onToggleParked, prompts, emptyText }) {
  if (sessions.length === 0) return [h('div', { class: 'empty' }, emptyText)];
  const active = sessions.filter((s) => !s.parked).sort((a, b) => rank(b) - rank(a) || byRecent(a, b));
  const parked = sessions.filter((s) => s.parked).sort(byRecent);
  const row = (s) => renderLiveRow(state, s, prompts);
  return [
    active.length > 0 && h('ul', { class: 'list' }, active.map(row)),
    parked.length > 0 && active.length > 0 && h('button', { type: 'button', class: 'list-toggle', onclick: onToggleParked },
      showParked ? 'Hide parked sessions' : `Show ${parked.length} parked session${parked.length > 1 ? 's' : ''} (idle over a day)`),
    parked.length > 0 && (showParked || active.length === 0) && h('ul', { class: 'list' }, parked.map(row)),
  ].filter(Boolean);
}
