import { h } from './dom.js';
import { jumpButton, openMenu } from './actions.js';
import { terminalButton } from './live-terminal.js';
import { sessionToJump } from './task-views.js';

/*
 * The worktrees working on a task, under its row on the Tasks page: kept
 * apart from task-views.js because the buttons need the page's document.
 */

const PR_STATES = { OPEN: 'open', MERGED: 'merged', CLOSED: 'closed' };

/** A worktree working on the task: where, its PR, and a way into its session (or to start one). */
export function linkLine(link, caps) {
  const session = sessionToJump(link);
  const state = PR_STATES[link.pr?.state];
  return h('div', { class: 'task-link' },
    h('span', { class: 'task-link-where', title: link.path }, link.repoName, ' · ', h('span', { class: 'mono' }, link.branch)),
    link.pr && h('a', {
      class: `small task-link-pr${state ? ` is-${state}` : ''}`, href: link.pr.url, target: '_blank', rel: 'noopener noreferrer', title: `Pull request${state ? ` (${state})` : ''}`,
    }, `#${link.pr.number}`),
    h('div', { class: 'actions' },
      session ? [terminalButton(session), jumpButton(session)] : openMenu(link.path, link.recent, caps)));
}
