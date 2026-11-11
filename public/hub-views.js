import { h, readPref, writePref } from './dom.js';
import { closeDropdown, dropdown } from './actions.js';
import { linkLine } from './task-link-views.js';
import { trustButtons } from './agent-views.js';
import { STATE_LABELS, dueOnLabel, ticketLabel } from './task-state.js';

/*
 * The Tasks page's parts: the box to add a task, and your tasks in their
 * groups (what needs you, then by when it's due, then done), each with the
 * work on it.
 */

/** The add-a-task form: a title and due day, with notes and links behind "Notes and links". */
export function newTaskForm(onCreate) {
  const form = h('form', {
    class: 'hub-new',
    'aria-label': 'Add a task',
    onsubmit: async (event) => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      const { title, dueOn, notes, links } = form.elements;
      button.disabled = true;
      try {
        const created = await onCreate({
          title: title.value, dueOn: dueOn.value || null, notes: notes.value, links: links.value.split(/\s+/).filter(Boolean),
        });
        // Kept after a failure, to fix rather than type again.
        if (created) {
          form.reset();
          form.querySelector('details').open = false;
          title.focus();
        }
      } finally {
        button.disabled = false;
      }
    },
  },
  h('div', { class: 'hub-new-row' },
    h('input', {
      name: 'title', type: 'text', required: true, maxlength: '200', autocomplete: 'off', 'aria-label': 'Task', placeholder: 'Add a task: what needs doing?',
    }),
    h('input', { name: 'dueOn', type: 'date', 'aria-label': 'Due date', title: 'Due date (optional)' }),
    h('button', { type: 'submit', class: 'btn' }, 'Add')),
  h('details', { class: 'hub-new-more' },
    h('summary', {}, 'Notes and links'),
    h('label', { class: 'task-field' }, h('span', {}, 'Notes (what Claude is told when you start it)'),
      h('textarea', { name: 'notes', rows: '3', maxlength: '10000' })),
    h('label', { class: 'task-field' }, h('span', {}, 'Ticket links (ClickUp, GitHub, Jira, Azure DevOps or any other), one per line'),
      h('textarea', { name: 'links', rows: '2', spellcheck: 'false', placeholder: 'https://app.clickup.com/t/…' }))));
  return form;
}

function stateBadge(state) {
  const { label, tone } = STATE_LABELS[state];
  const dot = state === 'working' ? 'busy' : state === 'needs-you' ? 'idle' : null;
  return h('span', { class: `pill ${tone}` }, dot && h('span', { class: `dot ${dot}`, 'aria-hidden': 'true' }), label);
}

function ticketLinks(links) {
  return links.map((link) => [' · ', h('a', { href: link, target: '_blank', rel: 'noopener noreferrer', title: link }, ticketLabel(link))]);
}

/** Mark done, drop, reopen or delete: the row's ⋯ menu. Delete asks once more inside the menu. */
function taskMenu(task, actions) {
  const item = (label, title, run) => h('button', {
    type: 'button',
    class: 'menu-item',
    role: 'menuitem',
    title,
    onclick: async (event) => {
      closeDropdown(event.currentTarget);
      await run();
    },
  }, h('span', { class: 'menu-title' }, label));
  const closed = task.closedAs;
  const remove = h('button', {
    type: 'button',
    class: 'menu-item',
    role: 'menuitem',
    title: 'Remove this task from switchyard (its worktree, branch and tickets are left alone)',
    onclick: async (event) => {
      const button = event.currentTarget;
      if (!button.dataset.confirm) {
        button.dataset.confirm = 'yes';
        button.querySelector('.menu-title').textContent = 'Click again to delete';
        return;
      }
      closeDropdown(button);
      await actions.remove(task);
    },
  }, h('span', { class: 'menu-title' }, 'Delete…'));
  return dropdown({ key: `task-${task.id}`, label: '⋯', title: 'More', className: 'btn btn-action', focusInput: false },
    closed ? item('Reopen', 'Put it back with your open tasks', () => actions.reopen(task)) : [
      item('Mark done', 'Done, without a merged PR to say so', () => actions.close(task, 'done')),
      item('Drop', "Not doing it after all", () => actions.close(task, 'dropped')),
    ],
    remove);
}

// The repo you last started a task in, shared with New task on the Agents page.
const REPO_PREF = 'switchyard.newTaskRepo';

/** Start ▾: pick the repo, then Start: Claude on the task in a new worktree, in the switchyard tmux session. */
function startMenu(task, { repos, actions }) {
  const sorted = [...repos].sort((a, b) => a.name.localeCompare(b.name));
  const remembered = readPref(REPO_PREF, null);
  const form = h('form', {
    class: 'task-form',
    onsubmit: async (event) => {
      event.preventDefault();
      const repo = form.elements.repo.value;
      writePref(REPO_PREF, repo);
      closeDropdown(form);
      await actions.start(task, repo);
    },
  },
  h('label', { class: 'task-field' }, h('span', {}, 'Repository'),
    h('select', { name: 'repo', required: true }, sorted.map((r) => h('option', { value: r.mainPath, selected: r.mainPath === remembered }, r.name)))),
  h('div', { class: 'task-actions' },
    h('p', { class: 'reply-hint' }, 'Starts Claude on this task in a new worktree beside the repo, on a branch that names the task, in the switchyard tmux session.'),
    h('button', { type: 'submit', class: 'btn btn-sm' }, 'Start')));
  return dropdown({ key: `start-${task.id}`, label: 'Start ▾', title: 'Start Claude on this task', className: 'btn btn-sm', panelClass: 'reply-panel', focusInput: false }, form);
}

/** The row's one line: how a start is going, or the first line of the notes. */
function detailLine(task) {
  const { start } = task;
  if (task.creating) return h('span', { class: 'row-detail is-pending' }, 'Creating the worktree…');
  if (start?.state === 'asking-trust') return h('span', { class: 'row-detail is-needs-you' }, h('span', { class: 'row-detail-label' }, 'Asks:'), ' trust this folder?');
  if (start?.state === 'starting') return h('span', { class: 'row-detail is-pending' }, `Starting Claude in tmux window ${start.place}`);
  if (start?.state === 'exited') {
    const text = start.detail ? `Claude quit before starting: ${start.detail}` : 'Claude quit before starting';
    return h('span', { class: 'row-detail is-failed', title: text }, text);
  }
  const firstLine = task.notes.split('\n')[0];
  return h('span', { class: 'row-detail muted', title: task.notes }, firstLine);
}

function rowActions(task, context) {
  if (task.start?.state === 'asking-trust') return trustButtons(task.start);
  const canStart = task.state === 'not-started' && context.caps?.tmux && context.repos.length > 0;
  return [canStart && startMenu(task, context), taskMenu(task, context.actions)];
}

function taskRow(task, context) {
  const { now, caps, approvals } = context;
  const due = task.state === 'done' || task.state === 'dropped' ? null : dueOnLabel(task.dueOn, now);
  return h('li', { class: `list-row hub-row is-${task.state}${task.work.length ? ' has-links' : ''}` },
    stateBadge(task.state),
    h('div', { class: 'row-who' },
      h('span', { class: 'row-title', title: task.title }, task.title),
      h('span', { class: 'row-where' }, h('span', { class: 'mono' }, task.id), ticketLinks(task.links))),
    detailLine(task),
    h('span', { class: `task-due${due?.tone ? ` ${due.tone}` : ''}` }, due?.text ?? ''),
    h('div', { class: 'actions' }, rowActions(task, context)),
    task.work.length > 0 && h('div', { class: 'task-links', 'aria-label': 'Work on this task' }, task.work.map((link) => linkLine(link, caps, approvals))));
}

/** The groups, each a heading and its tasks; Done is folded away until opened. */
export function renderGroups(groups, {
  now = Date.now(), caps, actions, repos = [], approvals = [], doneOpen, onDoneToggle,
}) {
  const context = {
    now, caps, actions, repos, approvals,
  };
  return groups.map((group) => {
    const list = h('ul', { class: 'list' }, group.tasks.map((task) => taskRow(task, context)));
    const heading = [group.label, h('span', { class: 'hub-count' }, String(group.tasks.length))];
    if (group.key !== 'done') {
      return h('section', { class: `hub-group is-${group.key}`, 'aria-label': group.label }, h('h3', { class: 'hub-group-head' }, heading), list);
    }
    return h('details', { class: 'hub-group is-done', open: doneOpen, ontoggle: (event) => onDoneToggle(event.currentTarget.open) },
      h('summary', { class: 'hub-group-head' }, heading), list);
  });
}
