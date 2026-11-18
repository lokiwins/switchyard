import { h } from './dom.js';

/*
 * After a task is closed or deleted, its work is put away (see
 * src/task-cleanup.js). This says what happened, and asks about each worktree
 * that was kept because it has uncommitted changes or unmerged commits: keep
 * it, or delete it.
 */

const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const folderName = (path) => path.replace(/\/+$/, '').split('/').pop();

/** "ended 1 session · removed 2 worktrees · 1 worktree needs your choice", or '' when nothing was there to put away. */
export function cleanupSummary(cleanup) {
  if (!cleanup) return '';
  return [
    cleanup.ended.length > 0 && `ended ${count(cleanup.ended.length, 'session')}`,
    cleanup.removed.length > 0 && `removed ${count(cleanup.removed.length, 'worktree')}`,
    cleanup.choices.length > 0 && `${count(cleanup.choices.length, 'worktree')} ${cleanup.choices.length === 1 ? 'needs' : 'need'} your choice`,
  ].filter(Boolean).join(' · ');
}

/** What's in a kept worktree that deleting it would touch. */
export function whatsLeft({ changes, unmerged }) {
  return [
    changes > 0 && count(changes, 'uncommitted file'),
    unmerged > 0 && `${count(unmerged, 'commit')} not merged`,
  ].filter(Boolean).join(' and ');
}

/** One notice per worktree waiting: Keep it, or Delete it. `onChoose(choice, keep)` resolves when done. */
export function renderWorktreeChoices(choices, onChoose) {
  return choices.map((choice) => {
    const act = (keep) => async (event) => {
      const buttons = event.currentTarget.parentElement.querySelectorAll('button');
      buttons.forEach((b) => { b.disabled = true; });
      try {
        await onChoose(choice, keep);
      } finally {
        buttons.forEach((b) => { b.disabled = false; });
      }
    };
    return h('div', { class: 'worktree-choice', role: 'group', 'aria-label': `Keep or delete ${folderName(choice.path)}` },
      h('p', { class: 'worktree-choice-text' },
        h('strong', {}, choice.taskTitle), ' is closed. Its worktree ',
        h('code', { title: choice.path }, folderName(choice.path)),
        choice.branch ? [' on ', h('code', {}, choice.branch)] : '',
        ` has ${whatsLeft(choice)}. Keep it, or delete it?`),
      h('p', { class: 'reply-hint' }, choice.changes > 0
        ? 'Delete removes the folder, and its uncommitted changes are gone for good. The branch and its commits stay.'
        : 'Delete removes the folder. The branch and its commits stay.'),
      h('div', { class: 'worktree-choice-actions' },
        h('button', { type: 'button', class: 'btn btn-sm btn-secondary', onclick: act(true) }, 'Keep worktree'),
        h('button', { type: 'button', class: 'btn btn-sm btn-danger', onclick: act(false) }, 'Delete worktree')));
  });
}
