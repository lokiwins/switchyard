import { h, liveTime, refreshLiveTimes, toast } from './dom.js';
import { post } from './actions.js';
import { applyNav, startNavBadges } from './nav.js';
import { matchesTask, renderTasks, renderToolCards } from './task-views.js';
import { linkLine } from './task-link-views.js';

// ClickUp is asked at most once a minute (the server answers from its cache in
// between); polling more often keeps the worktrees and sessions under each task current.
const POLL_MS = 10_000;
const CLOCK_MS = 5_000;

// `taskLoads` numbers each task fetch, so an older one landing late (say, from before a workspace change) is dropped.
const ui = { tools: null, result: null, query: '', loading: false, taskLoads: 0 };

const $ = (id) => document.getElementById(id);
const clickupTool = () => ui.tools?.find((tool) => tool.id === 'clickup');

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

/** After connecting, disconnecting or switching workspace: new cards, then that workspace's tasks. Resolves whether it worked. */
async function changeTools(url, body, { done, redrawOnFailure = false } = {}) {
  try {
    ui.tools = (await post(url, body)).tools;
  } catch (error) {
    toast(error.message);
    // A failed workspace switch puts the picker back; a failed connect keeps the token typed, to fix.
    if (redrawOnFailure) renderTools();
    return false;
  }
  ui.result = null;
  renderTools();
  if (done) toast(done);
  await loadTasks({ force: true });
  return true;
}

const handlers = {
  onConnect: (token) => changeTools('/api/task-tools/connect', { tool: 'clickup', token }, { done: 'Connected to ClickUp' }),
  onDisconnect: () => changeTools('/api/task-tools/disconnect', { tool: 'clickup' }, { done: 'Disconnected from ClickUp' }),
  onWorkspace: (workspaceId) => changeTools('/api/task-tools/workspace', { tool: 'clickup', workspaceId }, { redrawOnFailure: true }),
};

function renderTools() {
  $('tools').replaceChildren(...renderToolCards(ui.tools, handlers));
  const connected = Boolean(clickupTool()?.connected);
  $('tasks-panel').hidden = !connected;
  if (!connected) renderErrors([]);
  renderStatus();
}

function renderStatus() {
  const fetchedAt = ui.result?.fetchedAt;
  $('updated').replaceChildren(fetchedAt ? liveTime(fetchedAt, 'ClickUp checked ') : (clickupTool()?.connected ? 'Loading…' : ''));
}

function renderTaskList() {
  renderStatus();
  const result = ui.result;
  if (!result?.connected) return;
  renderErrors(result.error ? [`ClickUp: ${result.error}`] : []);
  const shown = result.tasks.filter((task) => matchesTask(task, ui.query));
  const count = result.truncated ? `The ${result.tasks.length} most recently updated` : `${result.tasks.length} open`;
  $('task-count').textContent = `${count}${result.workspace ? ` in ${result.workspace.name}` : ''}`;
  const emptyText = result.error ? 'Could not load your tasks.'
    : result.tasks.length ? `No tasks match “${ui.query}”.` : 'Nothing open is assigned to you.';
  $('tasks').replaceChildren(...renderTasks(shown, { emptyText, renderLinks: (link) => linkLine(link, result.capabilities) }));
}

async function loadTasks({ force = false } = {}) {
  if (!clickupTool()?.connected) return;
  if (!ui.result) $('tasks').replaceChildren(h('div', { class: 'empty' }, 'Loading your tasks from ClickUp…'));
  ui.taskLoads += 1;
  const load = ui.taskLoads;
  try {
    const result = await getJson(`/api/task-tools/tasks${force ? '?refresh=1' : ''}`);
    if (load !== ui.taskLoads) return;
    ui.result = result;
    renderTaskList();
  } catch (error) {
    if (load === ui.taskLoads) renderErrors([`Could not load tasks: ${error.message}`]);
  }
}

async function load({ force = false } = {}) {
  if (ui.loading) return;
  ui.loading = true;
  $('refresh').disabled = true;
  try {
    const data = await getJson('/api/task-tools');
    applyNav(data.nav);
    // Redrawn only when they change, so a token being typed isn't cleared by a refresh.
    if (JSON.stringify(data.tools) !== JSON.stringify(ui.tools)) {
      ui.tools = data.tools;
      renderTools();
    }
    renderErrors([]);
    await loadTasks({ force });
  } catch (error) {
    renderErrors([`Could not load task tools: ${error.message}`]);
  } finally {
    ui.loading = false;
    $('refresh').disabled = false;
    renderStatus();
  }
}

$('refresh').addEventListener('click', () => load({ force: true }));
$('search').addEventListener('input', (event) => {
  ui.query = event.target.value.trim();
  renderTaskList();
});
// After Jump, Open or a resume: show the session it started without waiting for the next poll.
document.addEventListener('switchyard:changed', () => load());
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) load();
});
setInterval(() => refreshLiveTimes(), CLOCK_MS);
setInterval(() => {
  if (!document.hidden) load();
}, POLL_MS);

startNavBadges();
load();
