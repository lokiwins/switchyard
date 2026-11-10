import { h, liveTime } from './dom.js';

/*
 * The Tasks page's parts: a card for each task management tool, and the
 * tasks the connected one has assigned to you.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HELP_URL = 'https://app.clickup.com/settings/apps';
const PRIORITY_TONES = { urgent: 'red', high: 'amber', normal: null, low: null };

const startOfDay = (time) => {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

/** "Overdue 3d", "Due today", "Due tomorrow" or "Due Nov 20", with a tone for the first three; null without a date. */
export function dueLabel(dueAt, now = Date.now()) {
  if (!dueAt) return null;
  const days = Math.round((startOfDay(dueAt) - startOfDay(now)) / DAY_MS);
  if (days < 0) return { text: `Overdue ${-days}d`, tone: 'red' };
  if (days === 0) return { text: 'Due today', tone: 'amber' };
  if (days === 1) return { text: 'Due tomorrow', tone: 'amber' };
  return { text: `Due ${new Date(dueAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, tone: null };
}

/** Whether a task matches the filter box: its name, ids, status, list, or a branch working on it. */
export function matchesTask(task, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return [task.name, task.id, task.customId, task.status?.name, task.where, ...(task.links ?? []).map((link) => link.branch)]
    .some((field) => typeof field === 'string' && field.toLowerCase().includes(q));
}

/** The token form on the ClickUp card, before it's connected. `onConnect` resolves whether it worked. */
function connectForm(onConnect) {
  return h('form', {
    class: 'tool-connect',
    onsubmit: async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button');
      button.disabled = true;
      try {
        // Kept after a failure, so a mistyped token can be fixed rather than pasted again.
        if (await onConnect(form.elements.token.value)) form.reset();
      } finally {
        button.disabled = false;
      }
    },
  },
  h('label', { class: 'tool-label', for: 'clickup-token' }, 'Personal API token'),
  h('div', { class: 'reply-form' },
    h('input', {
      id: 'clickup-token', name: 'token', type: 'password', required: true, autocomplete: 'off', spellcheck: 'false', placeholder: 'pk_…',
    }),
    h('button', { type: 'submit', class: 'btn btn-sm' }, 'Connect')),
  h('p', { class: 'tool-help' },
    'Make one in ClickUp under ',
    h('a', { href: HELP_URL, target: '_blank', rel: 'noopener noreferrer' }, 'Settings › Apps'),
    '. switchyard keeps it in ~/.config/switchyard, readable only by you, and sends it only to ClickUp.'));
}

function workspacePicker(tool, onWorkspace) {
  if (tool.workspaces.length === 1) return h('span', { class: 'tool-meta' }, tool.workspaces[0].name);
  return h('select', {
    class: 'tool-select',
    'aria-label': 'ClickUp workspace',
    onchange: (event) => onWorkspace(event.target.value),
  }, tool.workspaces.map((w) => h('option', { value: w.id, selected: w.id === tool.workspaceId }, w.name)));
}

function connectedBody(tool, { onDisconnect, onWorkspace }) {
  return [
    h('p', { class: 'tool-meta' }, h('span', { class: 'dot connected', 'aria-hidden': 'true' }), `Connected as ${tool.user.username}`),
    h('div', { class: 'tool-row' },
      workspacePicker(tool, onWorkspace),
      h('button', { type: 'button', class: 'btn btn-sm btn-secondary', onclick: onDisconnect, title: 'Forget the token' }, 'Disconnect')),
  ];
}

/** One card per tool: ClickUp to connect or connected; the rest marked as coming later. */
export function renderToolCards(tools, handlers) {
  return tools.map((tool) => h('article', { class: `tool-card${tool.connected ? ' is-connected' : ''}${tool.available ? '' : ' is-later'}` },
    h('header', { class: 'tool-head' },
      h('h3', {}, tool.name),
      !tool.available && h('span', { class: 'pill' }, 'Coming later')),
    tool.available && (tool.connected ? connectedBody(tool, handlers) : connectForm(handlers.onConnect))));
}

function statusPill(status) {
  const pill = h('span', { class: 'pill task-status', title: `Status: ${status.name}` }, status.name);
  // Set through the style object, which the page's CSP allows, unlike a style attribute.
  if (status.color) pill.style.setProperty('--status', status.color);
  return pill;
}

// Questions waiting on you first, then working, then waiting; parked ones last.
const jumpRank = (s) => (s.needsYou ? 3 : s.parked ? 0 : s.status === 'busy' ? 2 : 1);

/** The session a worktree's Jump and Terminal go to: the one that most needs you, then the latest; null when none runs. */
export function sessionToJump(link) {
  return [...link.live].sort((a, b) => jumpRank(b) - jumpRank(a) || (b.statusUpdatedAt ?? 0) - (a.statusUpdatedAt ?? 0))[0] ?? null;
}

function taskRow(task, now, renderLinks) {
  const due = dueLabel(task.dueAt, now);
  const tone = PRIORITY_TONES[task.priority];
  const links = task.links ?? [];
  return h('li', { class: `list-row task-row${links.length ? ' has-links' : ''}` },
    statusPill(task.status),
    h('div', { class: 'row-who' },
      task.url
        ? h('a', { class: 'row-title', href: task.url, target: '_blank', rel: 'noopener noreferrer', title: 'Open in ClickUp' }, task.name)
        : h('span', { class: 'row-title' }, task.name),
      h('span', { class: 'row-where' }, h('span', { class: 'mono' }, task.customId ?? task.id), task.where && h('span', { class: 'sep' }, task.where))),
    h('span', { class: `task-priority${tone ? ` ${tone}` : ''}` }, task.priority ? `⚑ ${task.priority}` : ''),
    h('span', { class: `task-due${due?.tone ? ` ${due.tone}` : ''}` }, due?.text ?? ''),
    liveTime(task.updatedAt, '', { class: 'row-time' }),
    links.length > 0 && renderLinks && h('div', { class: 'task-links', 'aria-label': 'Worktrees working on this task' }, links.map(renderLinks)));
}

/** The tasks assigned to you, or a line saying why there are none; `renderLinks` draws a worktree working on one. */
export function renderTasks(tasks, { emptyText, now = Date.now(), renderLinks = null }) {
  if (tasks.length === 0) return [h('div', { class: 'empty' }, emptyText)];
  return [h('ul', { class: 'list' }, tasks.map((task) => taskRow(task, now, renderLinks)))];
}
