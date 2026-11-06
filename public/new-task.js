import { h, toast } from './dom.js';
import { announceChange, closeDropdown, dropdown, post } from './actions.js';
import { branchFromTask } from './branch-name.js';

/*
 * "New task ▾": Claude Code on a task, in a worktree on its own branch beside
 * the repo, in a window of the same name in the switchyard tmux session. The
 * branch is optional: left empty, it's named after the task.
 */

const REPO_PREF = 'switchyard.newTaskRepo';
// Claude takes a few seconds to register a new session; look again over that time, so it shows as soon as it's there.
const LOOK_AGAIN_MS = [1500, 3000, 5000, 8000];

const lastSegment = (branch) => branch.split('/').pop();

function readRepoPref() {
  try {
    return localStorage.getItem(REPO_PREF);
  } catch {
    return null;
  }
}

function writeRepoPref(path) {
  try {
    localStorage.setItem(REPO_PREF, path);
  } catch {
    // Remembering the repo is a convenience.
  }
}

/** What will be created, shown as you type. */
function preview(form, repos) {
  const repo = repos.find((r) => r.mainPath === form.elements.repo.value);
  const typed = form.elements.branch.value.trim();
  const task = form.elements.prompt.value.trim();
  const hint = form.querySelector('.reply-hint');
  if (!repo || (!typed && !task)) {
    hint.textContent = 'Starts claude on the task in a worktree beside the repo, in a new tab of the switchyard tmux session.';
    return;
  }
  const branch = typed || branchFromTask(task);
  hint.textContent = typed
    ? `Folder ${repo.name}-${lastSegment(branch)}, on ${branch}: yours if it exists, else origin's, else new from the default branch.`
    : `New branch ${branch} (or ${branch}-2… if taken) in folder ${repo.name}-${branch}, from the default branch.`;
}

async function startTask(event, repos) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const { repo, branch, prompt } = form.elements;
  button.disabled = true;
  try {
    const result = await post('/api/tasks/new', { repo: repo.value, branch: branch.value, prompt: prompt.value });
    writeRepoPref(repo.value);
    form.reset();
    preview(form, repos);
    closeDropdown(form);
    toast(`Started ${result.branch} in tmux window ${result.session}:${result.window}`);
    announceChange();
    LOOK_AGAIN_MS.forEach((ms) => setTimeout(() => announceChange({ force: true }), ms));
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
}

function field(label, control) {
  return h('label', { class: 'task-field' }, h('span', {}, label), control);
}

/** The New task menu, or null when tmux isn't installed. */
export function newTaskMenu(state) {
  if (!state.capabilities?.tmux || state.repos.length === 0) return null;
  const repos = [...state.repos].sort((a, b) => a.name.localeCompare(b.name));
  const remembered = readRepoPref();
  const form = h('form', { class: 'task-form', onsubmit: (event) => startTask(event, repos), oninput: (event) => preview(event.currentTarget, repos) },
    field('Repository', h('select', { name: 'repo', required: true },
      repos.map((r) => h('option', { value: r.mainPath, selected: r.mainPath === remembered }, r.name)))),
    field('Task', h('input', {
      name: 'prompt', type: 'text', required: true, maxlength: '2000', autocomplete: 'off', placeholder: 'What should Claude do?',
    })),
    field('Branch (optional)', h('input', {
      name: 'branch', type: 'text', maxlength: '100', autocomplete: 'off', placeholder: 'Named after the task',
      pattern: '[A-Za-z0-9._/\\-]+', title: 'Letters, digits, ".", "_", "-" and "/"',
    })),
    h('div', { class: 'task-actions' },
      h('p', { class: 'reply-hint' }),
      h('button', { type: 'submit', class: 'btn btn-sm' }, 'Start')));
  preview(form, repos);
  return dropdown({ key: 'new-task', label: 'New task ▾', title: 'Start Claude on a new branch in its own worktree', className: 'btn', panelClass: 'reply-panel' }, form);
}

/** Whether you're filling in the form, so a re-render mustn't replace it. */
export const isEditingTask = () => Boolean(document.activeElement?.closest('.task-form'));
