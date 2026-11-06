import { h, toast } from './dom.js';
import { announceChange, closeDropdown, dropdown, post } from './actions.js';

/*
 * "New task ▾": a worktree on a new branch beside the repo, with Claude Code
 * started in a window of the same name in the switchyard tmux session.
 */

const REPO_PREF = 'switchyard.newTaskRepo';

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

/** What will be created, shown as you type the branch. */
function preview(form, repos) {
  const repo = repos.find((r) => r.mainPath === form.elements.repo.value);
  const branch = form.elements.branch.value.trim();
  form.querySelector('.reply-hint').textContent = repo && branch
    ? `Creates folder ${repo.name}-${lastSegment(branch)} beside ${repo.name}, from origin's branch of that name or its default branch, and starts claude in a new tab of the switchyard tmux session.`
    : 'Creates a worktree beside the repo and starts claude in a new tab of the switchyard tmux session.';
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
    field('Branch', h('input', {
      name: 'branch', type: 'text', required: true, maxlength: '100', autocomplete: 'off', placeholder: 'fix/login-redirect',
      pattern: '[A-Za-z0-9._/\\-]+', title: 'Letters, digits, ".", "_", "-" and "/"',
    })),
    field('Task (optional)', h('input', {
      name: 'prompt', type: 'text', maxlength: '2000', autocomplete: 'off', placeholder: 'What should Claude do first?',
    })),
    h('div', { class: 'task-actions' },
      h('p', { class: 'reply-hint' }),
      h('button', { type: 'submit', class: 'btn btn-sm' }, 'Start')));
  preview(form, repos);
  return dropdown({ key: 'new-task', label: 'New task ▾', title: 'Start Claude on a new branch in its own worktree', className: 'btn', panelClass: 'reply-panel' }, form);
}

/** Whether you're filling in the form, so a re-render mustn't replace it. */
export const isEditingTask = () => Boolean(document.activeElement?.closest('.task-form'));
