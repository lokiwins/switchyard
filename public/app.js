import { h, readPref, shortPath, timeAgo, writePref } from './dom.js';
import {
  SEGMENTED_VIEWS, VIEWS, renderOrphanPrs, renderRepos, renderTiles, summarize,
} from './views.js';
import { startNavBadges } from './nav.js';

const POLL_MS = 15_000;
const VIEW_PREF = 'switchyard.view';
const COLLAPSED_PREF = 'switchyard.collapsed';

function readCollapsed() {
  try {
    const value = JSON.parse(readPref(COLLAPSED_PREF, '[]'));
    return new Set(Array.isArray(value) ? value : []);
  } catch {
    return new Set();
  }
}

const ui = {
  state: null,
  view: VIEWS[readPref(VIEW_PREF, 'active')] ? readPref(VIEW_PREF, 'active') : 'active',
  query: '',
  collapsed: readCollapsed(),
  loading: false,
};

const $ = (id) => document.getElementById(id);

function setView(view) {
  ui.view = view;
  writePref(VIEW_PREF, view);
  render();
}

function toggleCollapsed(path, isCollapsed) {
  if (isCollapsed) ui.collapsed.add(path);
  else ui.collapsed.delete(path);
  writePref(COLLAPSED_PREF, JSON.stringify([...ui.collapsed]));
}

/**
 * The segmented control, plus a removable chip when a tile picked a view that
 * has no segment (e.g. "Uncommitted"), so every filter can be seen and cleared.
 */
function renderViews() {
  const extra = !SEGMENTED_VIEWS.includes(ui.view) && h('button', {
    type: 'button',
    class: 'filter-chip',
    title: 'Clear this filter',
    'aria-label': `Clear filter: ${VIEWS[ui.view].label}`,
    onclick: () => setView('all'),
  }, VIEWS[ui.view].label, h('span', { 'aria-hidden': 'true' }, '✕'));
  $('views').replaceChildren(...[extra, ...SEGMENTED_VIEWS.map((view) => h('button', {
    type: 'button',
    role: 'radio',
    'aria-checked': String(ui.view === view),
    onclick: () => setView(view),
  }, VIEWS[view].label))].filter(Boolean));
}

function showAll() {
  ui.query = '';
  $('search').value = '';
  setView('all');
}

function renderErrors(errors) {
  const el = $('errors');
  el.hidden = errors.length === 0;
  el.replaceChildren(...errors.map((e) => h('div', {}, `${e.source}: ${e.message}`)));
}

function render() {
  renderViews();
  const { state } = ui;
  if (!state) return;
  $('roots').textContent = `Scanning ${state.roots.map(shortPath).join(', ')}`;
  $('updated').textContent = `Updated ${timeAgo(state.generatedAt)}`;
  renderErrors(state.errors);
  $('tiles').replaceChildren(...renderTiles(summarize(state), ui.view, setView));
  $('repos').replaceChildren(...renderRepos(state, {
    view: ui.view, query: ui.query, collapsed: ui.collapsed, onToggle: toggleCollapsed, onShowAll: showAll,
  }));
  $('orphans-panel').hidden = state.prsWithoutWorktree.length === 0;
  $('orphans').replaceChildren(...renderOrphanPrs(state.prsWithoutWorktree));
}

async function load({ force = false } = {}) {
  if (ui.loading) return;
  ui.loading = true;
  $('refresh').disabled = true;
  if (!ui.state) $('repos').replaceChildren(h('div', { class: 'empty' }, 'Scanning worktrees, PRs and agent sessions…'));
  try {
    const res = await fetch(`/api/state${force ? '?refresh=1' : ''}`);
    const body = await res.json();
    if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`);
    ui.state = body.data;
    render();
  } catch (error) {
    renderErrors([{ source: 'monitor', message: `Could not load state: ${error.message}` }]);
  } finally {
    ui.loading = false;
    $('refresh').disabled = false;
  }
}

$('refresh').addEventListener('click', () => load({ force: true }));
$('search').addEventListener('input', (event) => {
  ui.query = event.target.value.trim();
  render();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) load();
});
setInterval(() => {
  if (!document.hidden) load();
}, POLL_MS);

startNavBadges();
renderViews();
load();
