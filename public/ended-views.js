import { copyButton, h, shellQuote, shortPath, timeAgo } from './dom.js';
import { sessionRow, statusBadge, whereLabel } from './session-row.js';

const COLLAPSED_LIMIT = 5;

export const END_STATES = {
  interrupted: { label: 'Interrupted', tone: 'amber', hint: 'The terminal closed while the agent was mid-turn' },
  stopped: { label: 'Stopped', tone: '', hint: 'You pressed Esc to interrupt the agent' },
  exited: { label: 'Exited', tone: '', hint: 'You ran /exit' },
  finished: { label: 'Finished', tone: '', hint: 'The agent completed its last turn' },
  unknown: { label: 'Ended', tone: '', hint: 'Could not tell how the last turn ended' },
};

export function endStateOf(session) {
  return END_STATES[session.endState] ?? END_STATES.unknown;
}

export function renderEndedRow(session, prompts = null) {
  const state = endStateOf(session);
  const t = session.transcript;
  return sessionRow({
    // Only recent interruptions are highlighted; older ones are history.
    className: session.needsAttention ? 'is-interrupted' : null,
    badge: statusBadge({ tone: state.tone, label: state.label, hint: state.hint }),
    title: t.title ?? t.agentName ?? session.cwd.split('/').pop(),
    titleHint: [t.title, t.agentName, session.cwd].filter(Boolean).join(' · '),
    where: whereLabel({ repoName: session.repoName, branch: session.branch, path: shortPath(session.cwd) }),
    prompt: t.lastPrompt,
    promptOpen: prompts?.isOpen(session.sessionId) ?? false,
    onPromptToggle: prompts ? () => prompts.toggle(session.sessionId) : null,
    time: timeAgo(session.endedAt),
    timeHint: `Ended ${new Date(session.endedAt).toLocaleString()}`,
    actions: [
      session.prUrl && h('a', { href: session.prUrl, target: '_blank', rel: 'noopener', class: 'small' }, `#${session.prNumber}`),
      copyButton('cd', `cd ${shellQuote(session.cwd)}`),
      copyButton('resume', session.resumeCommand),
    ],
  });
}

/**
 * Interrupted sessions that still need attention always show; the rest
 * collapse behind a toggle unless `collapse` is off.
 */
export function renderEnded(sessions, { expanded, onToggle, prompts = null, collapse = true, emptyText = null }) {
  if (sessions.length === 0) return emptyText ? [h('div', { class: 'empty' }, emptyText)] : [];
  const interrupted = sessions.filter((s) => s.needsAttention);
  const others = sessions.filter((s) => !s.needsAttention);
  const row = (s) => renderEndedRow(s, prompts);
  if (!collapse) return [h('ul', { class: 'list' }, [...interrupted, ...others].map(row))];
  const collapsedCount = Math.max(0, COLLAPSED_LIMIT - interrupted.length);
  const canCollapse = others.length > collapsedCount;
  const shownOthers = expanded ? others : others.slice(0, collapsedCount);
  return [
    h('ul', { class: 'list' }, [...interrupted, ...shownOthers].map(row)),
    canCollapse && h('button', { type: 'button', class: 'list-toggle', onclick: onToggle },
      expanded ? 'Show fewer' : `Show ${others.length - collapsedCount} more`),
  ].filter(Boolean);
}
