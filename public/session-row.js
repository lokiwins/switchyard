import { h } from './dom.js';

/** A small status badge, optionally led by a status dot. */
export function statusBadge({ tone = '', dot = null, label, hint }) {
  return h('span', { class: `pill ${tone}`, title: hint },
    dot && h('span', { class: `dot ${dot}`, 'aria-hidden': 'true' }),
    label);
}

/**
 * One line in a session list, shared by live and ended sessions so both read
 * the same way: status, who/where, what it's doing or said, time, actions.
 */
export function sessionRow({
  badge, title, titleHint, where, detail, time, timeHint, actions, className, detailOpen = false, onDetailToggle = null,
}) {
  return h('li', { class: ['list-row', className].filter(Boolean).join(' ') },
    badge,
    h('div', { class: 'row-who' },
      h('span', { class: 'row-title', title: titleHint ?? title }, title),
      where && h('span', { class: 'row-where' }, where)),
    renderDetail(detail, { open: detailOpen, onToggle: onDetailToggle }),
    h('span', { class: 'row-time', title: timeHint }, time),
    h('div', { class: 'actions' }, actions));
}

/** A session's one-line detail; with onToggle it becomes a button that expands it in place. */
function renderDetail(detail, { open, onToggle }) {
  if (!detail) return h('span', { class: 'row-detail muted' }, 'Nothing yet');
  const kind = `row-detail is-${detail.kind}`;
  const content = [detail.label && h('span', { class: 'row-detail-label' }, `${detail.label}:`), detail.text];
  if (!onToggle) return h('span', { class: kind, title: detail.text }, content);
  return h('button', {
    type: 'button',
    class: `${kind} is-expandable${open ? ' is-open' : ''}`,
    'aria-expanded': String(open),
    title: open ? 'Click to collapse' : 'Click to show all of it',
    onclick: onToggle,
  }, content);
}

/** "repo · branch" when the session is in a known worktree, otherwise its folder. */
export function whereLabel({ repoName, branch, path }) {
  if (!repoName) return h('span', { class: 'mono' }, path);
  return [repoName, branch && [' · ', h('span', { class: 'mono' }, branch)]];
}
