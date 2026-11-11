import { h, liveTime, refreshLiveTimes, toast } from './dom.js';
import { post } from './actions.js';
import { applyNav, startNavBadges } from './nav.js';
import { renderToolCards } from './task-views.js';
import { newTaskForm, renderGroups } from './hub-views.js';
import { groupTasks, matchesHubTask } from './task-state.js';

/*
 * The Tasks page: your own tasks, what needs you first, then by when they're
 * due, each with the work on it. Polling keeps the work (sessions, PRs) current.
 */
const POLL_MS = 10_000;
const CLOCK_MS = 5_000;

const ui = {
  tools: null, data: null, query: '', loading: false, loads: 0, doneOpen: false,
};

const $ = (id) => document.getElementById(id);

function renderErrors(messages) {
  const el = $('errors');
  el.hidden = messages.length === 0;
  el.replaceChildren(...messages.map((message) => h('div', {}, message)));
}

async function getJson(url) {
  const res = await fetch(url);
  const body = await res.json();
  if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body.data;
}

/** Run a change to a task, then show the tasks as they are now. Resolves whether it worked. */
async function change(url, body, done) {
  try {
    await post(url, body);
  } catch (error) {
    toast(error.message);
    return false;
  }
  if (done) toast(done);
  await loadTasks();
  return true;
}

const actions = {
  close: (task, as) => change('/api/hub/tasks/close', { id: task.id, as }, as === 'done' ? `Done: ${task.title}` : `Dropped: ${task.title}`),
  reopen: (task) => change('/api/hub/tasks/reopen', { id: task.id }, `Reopened: ${task.title}`),
  remove: (task) => change('/api/hub/tasks/delete', { id: task.id }, `Deleted: ${task.title}`),
};

function renderTasks() {
  const { data } = ui;
  if (!data) return;
  $('updated').replaceChildren(liveTime(data.checkedAt, 'Updated '));
  const shown = data.tasks.filter((task) => matchesHubTask(task, ui.query));
  const open = data.tasks.filter((task) => !task.closedAs).length;
  $('task-count').textContent = data.tasks.length ? `${open} open` : '';
  if (shown.length === 0) {
    $('tasks').replaceChildren(h('div', { class: 'empty' }, data.tasks.length
      ? `No tasks match “${ui.query}”.`
      : 'No tasks yet. Add what you’re working on above, with links to its tickets; its worktree, PR and Claude session show under it.'));
    return;
  }
  $('tasks').replaceChildren(...renderGroups(groupTasks(shown), {
    caps: data.capabilities,
    actions,
    doneOpen: ui.doneOpen || Boolean(ui.query),
    onDoneToggle: (open) => { ui.doneOpen = open; },
  }));
}

async function loadTasks({ force = false } = {}) {
  ui.loads += 1;
  const load = ui.loads;
  if (!ui.data) $('tasks').replaceChildren(h('div', { class: 'empty' }, 'Loading your tasks…'));
  try {
    const data = await getJson(`/api/hub/tasks${force ? '?refresh=1' : ''}`);
    // A slower, older load landing late is dropped.
    if (load !== ui.loads) return;
    ui.data = data;
    applyNav(data.nav);
    renderErrors([]);
    renderTasks();
  } catch (error) {
    if (load === ui.loads) renderErrors([`Could not load your tasks: ${error.message}`]);
  }
}

// ---------- connections (ClickUp for now) ----------

async function changeTools(url, body, { done, redrawOnFailure = false } = {}) {
  try {
    ui.tools = (await post(url, body)).tools;
  } catch (error) {
    toast(error.message);
    if (redrawOnFailure) renderTools();
    return false;
  }
  renderTools();
  if (done) toast(done);
  return true;
}

const toolHandlers = {
  onConnect: (token) => changeTools('/api/task-tools/connect', { tool: 'clickup', token }, { done: 'Connected to ClickUp' }),
  onDisconnect: () => changeTools('/api/task-tools/disconnect', { tool: 'clickup' }, { done: 'Disconnected from ClickUp' }),
  onWorkspace: (workspaceId) => changeTools('/api/task-tools/workspace', { tool: 'clickup', workspaceId }, { redrawOnFailure: true }),
};

function renderTools() {
  $('tools').replaceChildren(...renderToolCards(ui.tools, toolHandlers));
  const clickup = ui.tools?.find((tool) => tool.id === 'clickup');
  $('connections-summary').textContent = clickup?.connected ? `ClickUp: connected as ${clickup.user.username}` : 'ClickUp: not connected';
}

async function loadTools() {
  try {
    const data = await getJson('/api/task-tools');
    // Redrawn only when they change, so a token being typed isn't cleared by a refresh.
    if (JSON.stringify(data.tools) !== JSON.stringify(ui.tools)) {
      ui.tools = data.tools;
      renderTools();
    }
  } catch (error) {
    renderErrors([`Could not load connections: ${error.message}`]);
  }
}

async function load({ force = false } = {}) {
  if (ui.loading) return;
  ui.loading = true;
  $('refresh').disabled = true;
  try {
    await Promise.all([loadTasks({ force }), loadTools()]);
  } finally {
    ui.loading = false;
    $('refresh').disabled = false;
  }
}

$('new-task').replaceChildren(newTaskForm((fields) => change('/api/hub/tasks/create', fields, `Added: ${fields.title.trim()}`)));
$('refresh').addEventListener('click', () => load({ force: true }));
$('search').addEventListener('input', (event) => {
  ui.query = event.target.value.trim();
  renderTasks();
});
// After Jump, Open or a resume: show the session it started without waiting for the next poll.
document.addEventListener('switchyard:changed', () => loadTasks());
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) load();
});
setInterval(() => refreshLiveTimes(), CLOCK_MS);
setInterval(() => {
  if (!document.hidden) loadTasks();
}, POLL_MS);

startNavBadges();
load();
