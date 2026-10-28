import { h } from './dom.js';

/** A small status badge, optionally led by a status dot. */
export function statusBadge({ tone = '', dot = null, label, hint }) {
  return h('span', { class: `pill ${tone}`, title: hint },
    dot && h('span', { class: `dot ${dot}`, 'aria-hidden': 'true' }),
    label);
}

/**
 * One line in a session list, shared by live and ended sessions so both read
 * the same way: status, who/where, last prompt, time, actions.
 */
export function sessionRow({
  badge, title, titleHint, where, prompt, time, timeHint, actions, className, promptOpen = false, onPromptToggle = null,
}) {
  return h('li', { class: ['list-row', className].filter(Boolean).join(' ') },
    badge,
    h('div', { class: 'row-who' },
      h('span', { class: 'row-title', title: titleHint ?? title }, title),
      where && h('span', { class: 'row-where' }, where)),
    renderPrompt(prompt, { open: promptOpen, onToggle: onPromptToggle }),
    h('span', { class: 'row-time', title: timeHint }, time),
    h('div', { class: 'actions' }, actions));
}

/** The last prompt; with onToggle it becomes a button that expands it in place. */
function renderPrompt(prompt, { open, onToggle }) {
  if (!prompt) return h('span', { class: 'row-prompt muted' }, 'No prompt yet');
  if (!onToggle) return h('span', { class: 'row-prompt', title: prompt }, prompt);
  return h('button', {
    type: 'button',
    class: `row-prompt is-expandable${open ? ' is-open' : ''}`,
    'aria-expanded': String(open),
    title: open ? 'Click to collapse' : 'Click to show the full prompt',
    onclick: onToggle,
  }, prompt);
}

/** "repo · branch" when the session is in a known worktree, otherwise its folder. */
export function whereLabel({ repoName, branch, path }) {
  if (!repoName) return h('span', { class: 'mono' }, path);
  return [repoName, branch && [' · ', h('span', { class: 'mono' }, branch)]];
}
