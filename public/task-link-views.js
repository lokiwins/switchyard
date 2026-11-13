import { h } from './dom.js';
import { jumpButton, openMenu } from './actions.js';
import { terminalButton } from './live-terminal.js';
import { sessionToJump } from './task-views.js';
import { approvalButtons, endMenu, replyMenu, stopButton } from './session-controls.js';
import { answerMenu, planButton } from './screen-answer.js';

/*
 * The worktrees working on a task, under its row on the Tasks page: kept
 * apart from task-views.js because the buttons need the page's document.
 */

const PR_STATES = { OPEN: 'open', MERGED: 'merged', CLOSED: 'closed' };

/** What you can do with a running session, as on the Agents page: answer it, reply, stop it, or get to it. */
function sessionControls(session, approvals) {
  const mine = approvals.filter((a) => a.sessionId === session.sessionId);
  return [
    mine.length > 0 && approvalButtons(mine, session),
    planButton(session, mine),
    answerMenu(session, mine),
    replyMenu(session),
    stopButton(session),
    terminalButton(session),
    jumpButton(session),
    endMenu(session),
  ];
}

/** A worktree working on the task: where, its PR, and its session's controls (or a way to start one). */
export function linkLine(link, caps, approvals = []) {
  const session = sessionToJump(link);
  const state = PR_STATES[link.pr?.state];
  return h('div', { class: 'task-link' },
    h('span', { class: 'task-link-where', title: link.path }, link.repoName, ' · ', h('span', { class: 'mono' }, link.branch)),
    link.pr && h('a', {
      class: `small task-link-pr${state ? ` is-${state}` : ''}`, href: link.pr.url, target: '_blank', rel: 'noopener noreferrer', title: `Pull request${state ? ` (${state})` : ''}`,
    }, `#${link.pr.number}`),
    h('div', { class: 'actions' },
      session ? sessionControls(session, approvals) : openMenu(link.path, link.recent, caps)));
}
