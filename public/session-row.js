import { h, liveTime } from './dom.js';

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
  badge, title, titleHint, where, detail, note = null, since, timeHint, actions, className, detailOpen = false, onDetailToggle = null,
}) {
  return h('li', { class: rowClass(className) },
    badge,
    rowWho({ title, titleHint, where }),
    rowDetail({ detail, note, open: detailOpen, onToggle: onDetailToggle }),
    rowTime({ since, hint: timeHint }),
    rowActions(actions));
}

/* The parts of a row, for a page that keeps the parts that didn't change (see row-parts.js). */

export const rowClass = (className) => ['list-row', className].filter(Boolean).join(' ');

export function rowWho({ title, titleHint, where }) {
  return h('div', { class: 'row-who' },
    h('span', { class: 'row-title', title: titleHint ?? title }, title),
    where && h('span', { class: 'row-where' }, where));
}

export function rowDetail({
  detail, note = null, open = false, onToggle = null, alerts = null,
}) {
  const detailLine = renderDetail(detail, { open, onToggle });
  if (!note && !alerts) return detailLine;
  // A note, and the session's alerts (see session-alerts.js), go on their own lines under the detail.
  return h('div', { class: 'row-detail-cell' }, detailLine,
    note && h('span', { class: 'row-note', title: note }, note),
    alerts && h('span', { class: 'row-alerts' }, alerts));
}

/** "5m ago", kept current by the page's clock (refreshLiveTimes) rather than by drawing the row again. */
export const rowTime = ({ since, hint }) => liveTime(since, '', { class: 'row-time', title: hint });

export const rowActions = (actions) => h('div', { class: 'actions' }, actions);

/** A session's one-line detail; with onToggle it becomes a button that expands it in place. */
function renderDetail(detail, { open, onToggle }) {
  if (!detail) return h('span', { class: 'row-detail muted' }, 'Nothing yet');
  const kind = `row-detail is-${detail.kind}`;
  // Some details have a fuller form to show when opened, e.g. a dialog as the terminal draws it.
  const body = open && detail.full ? h('span', { class: 'row-detail-full' }, detail.full) : detail.text;
  const content = [detail.label && h('span', { class: 'row-detail-label' }, `${detail.label}:`), body];
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

/** A link back to the ClickUp task a session's branch names; null without one. */
export function taskLink(task) {
  if (!task?.url) return null;
  return h('a', {
    href: task.url, target: '_blank', rel: 'noopener noreferrer', class: 'small task-ref', title: `ClickUp task: ${task.name}`,
  }, task.customId ?? 'ClickUp');
}
