import { h, liveTime } from './dom.js';
import {
  changeSummary, commitSummary, contextSummary, fileLine, stateLabel,
} from './attempt-cards.js';
import { checksControl } from './check-view.js';
import { anyRunning, failedNow } from './check-status.js';

/*
 * Compare attempts: a task's attempts side by side (see src/attempt-compare.js),
 * each a card saying what it changed, its commits, PR, session and context,
 * with Pick this one. Picking asks once more first, since the other attempts'
 * sessions end and their worktrees are put away.
 */

const PR_STATES = { OPEN: 'open', MERGED: 'merged', CLOSED: 'closed' };
// How often the pane looks again while a check runs.
const CHECK_POLL_MS = 2000;
const PICK_NOTE = 'Pick keeps that attempt as the task\'s work. The others\' sessions end and their worktrees are put away; one with changes or commits asks Keep or Delete first. Branches stay.';

function prLink(pr) {
  const state = PR_STATES[pr.state];
  return h('a', {
    class: `task-link-pr${state ? ` is-${state}` : ''}`, href: pr.url, target: '_blank', rel: 'noopener noreferrer',
  }, `PR #${pr.number}${state ? ` (${state})` : ''}`);
}

function filesList(changes) {
  if (!changes || changes.files.length === 0) return null;
  return h('details', { class: 'attempt-files' },
    h('summary', {}, 'Files'),
    h('ul', { class: 'attempt-file-list mono' }, changes.files.map((file) => h('li', { title: file.path }, fileLine(file)))));
}

/**
 * Pick this one, asking once more: the first click says what will happen (and
 * that its check failed, when it did; checks only warn), the second does it.
 */
function pickButton(attempt, onPick) {
  let armed = false;
  const failed = (attempt.checks ?? []).some(failedNow);
  const button = h('button', {
    type: 'button',
    class: 'btn btn-sm',
    onclick: async () => {
      if (!armed) {
        armed = true;
        button.textContent = failed ? 'A check failed. Keep it anyway, put the others away' : 'Keep this one, put the others away';
        button.classList.add('btn-danger');
        return;
      }
      await onPick(attempt);
    },
  }, 'Pick this one');
  return button;
}

function card(attempt, {
  picked, onPick, checkNames, onRunCheck,
}) {
  const head = h('header', { class: 'attempt-card-head' },
    h('h3', { class: 'attempt-card-title' }, `Attempt ${attempt.n}`),
    attempt.present && h('span', { class: `pane-pill attempt-state is-${attempt.state}` }, stateLabel(attempt.state)),
    picked === attempt.branch && h('span', { class: 'pane-pill is-picked' }, 'Picked'));
  const branch = h('p', { class: 'attempt-branch mono', title: attempt.path ?? attempt.branch }, attempt.branch);
  if (!attempt.present) {
    return h('article', { class: 'attempt-card is-gone', 'aria-label': `Attempt ${attempt.n}` },
      head, branch, h('p', { class: 'pane-note' }, 'Its worktree is gone; the branch may still be there.'));
  }
  const stats = [
    changeSummary(attempt.changes),
    commitSummary(attempt.commits),
    attempt.pr && prLink(attempt.pr),
    attempt.lastActivityAt && liveTime(attempt.lastActivityAt, 'Active '),
    contextSummary(attempt.contextTokens),
  ].filter(Boolean);
  return h('article', { class: `attempt-card${picked === attempt.branch ? ' is-picked' : ''}`, 'aria-label': `Attempt ${attempt.n}` },
    head,
    branch,
    h('ul', { class: 'attempt-stats' }, stats.map((stat) => h('li', {}, stat))),
    filesList(attempt.changes),
    checksControl(attempt.checks, { names: checkNames, onRun: (name) => onRunCheck(attempt, name) }),
    !picked && h('div', { class: 'attempt-card-actions' }, pickButton(attempt, onPick)));
}

/**
 * Open Compare attempts for `task`. `load()` resolves to the attempts (see
 * attempt-compare.js); `pick(attempt)` resolves whether picking worked, and
 * the pane closes when it did. `runCheck(path, name?)` starts an attempt's check (or all of them),
 * and the pane looks again until it's done.
 */
export function openAttemptPane(task, { load, pick, runCheck }) {
  const grid = h('div', { class: 'attempt-grid' }, h('p', { class: 'pane-note' }, 'Looking at each attempt…'));
  const close = () => dialog.close();

  async function onPick(attempt) {
    grid.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    const done = await pick(attempt);
    if (done) close();
    else grid.querySelectorAll('button').forEach((b) => { b.disabled = false; });
  }

  let soon = null;
  async function onRunCheck(attempt, name) {
    if (await runCheck(attempt.path, name)) await show();
  }

  async function show() {
    clearTimeout(soon);
    try {
      const data = await load();
      if (!dialog.open) return;
      grid.replaceChildren(...data.attempts.map((attempt) => card(attempt, {
        picked: data.picked, onPick, checkNames: data.checkNames, onRunCheck,
      })));
      // While a check runs, look again shortly, so its result shows when it's done.
      if (data.attempts.some((a) => anyRunning(a.checks))) soon = setTimeout(show, CHECK_POLL_MS);
    } catch (error) {
      grid.replaceChildren(h('p', { class: 'pane-note' }, `Couldn't compare the attempts: ${error.message}`));
    }
  }

  const dialog = h('dialog', {
    class: 'glass-pane attempt-pane',
    'aria-label': `Compare attempts: ${task.title}`,
    onclose: () => { clearTimeout(soon); dialog.remove(); },
  },
    h('header', { class: 'pane-header' },
      h('span', { class: 'pane-dot', 'aria-hidden': 'true' }),
      h('div', { class: 'pane-heading' },
        h('strong', {}, 'Compare attempts'),
        h('span', { class: 'pane-sub' }, task.title)),
      h('button', { type: 'button', class: 'pane-btn', title: 'Look at each attempt again', onclick: () => show() }, 'Refresh'),
      h('button', { type: 'button', class: 'pane-btn', onclick: close }, 'Close')),
    h('div', { class: 'review-body attempt-pane-body' }, grid),
    h('footer', { class: 'pane-footer' }, h('span', { class: 'pane-note pane-footer-note' }, PICK_NOTE)));
  document.body.append(dialog);
  dialog.showModal();
  show();
  return dialog;
}
