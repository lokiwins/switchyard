import { h, liveTime, readPref, refreshLiveTimes, shortPath, writePref } from './dom.js';
import {
  SEGMENTED_VIEWS, VIEWS, renderOrphanPrs, renderRepos, renderTiles, summarize,
} from './views.js';
import { applyNav, startNavBadges } from './nav.js';
import { nextAgeOut } from './worktree-age.js';

// Rebuilds reuse git status where nothing changed and cached GitHub data, so this can poll often.
const POLL_MS = 5_000;
// "3m ago" and the like are brought up to date this often, without drawing the list again.
const CLOCK_MS = 5_000;
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
  // The version of ui.state (its ETag): a poll that finds it unchanged leaves the list alone.
  etag: null,
  // When a worktree next stops counting as recent (Active view and tiles), which needs a fresh draw.
  ageOutAt: Infinity,
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
  $('updated').replaceChildren(liveTime(state.generatedAt, 'Updated '));
  renderErrors(state.errors);
  $('tiles').replaceChildren(...renderTiles(summarize(state), ui.view, setView));
  renderRepos($('repos'), state, {
    view: ui.view, query: ui.query, collapsed: ui.collapsed, onToggle: toggleCollapsed, onShowAll: showAll,
  });
  $('orphans-panel').hidden = state.prsWithoutWorktree.length === 0;
  $('orphans').replaceChildren(...renderOrphanPrs(state.prsWithoutWorktree));
  ui.ageOutAt = nextAgeOut(state);
}

/** The server's answer to a poll: the new state, or that the page already has it (304). */
async function fetchState(force) {
  // Refresh always gets everything, and draws it, so it visibly did something.
  const ask = ui.state && ui.etag && !force ? { 'If-None-Match': ui.etag } : {};
  const res = await fetch(`/api/state${force ? '?refresh=1' : ''}`, { cache: 'no-store', headers: ask });
  if (res.status === 304) {
    const built = Number(res.headers.get('X-Generated-At'));
    return { unchanged: true, generatedAt: Number.isFinite(built) && built > 0 ? built : Date.now() };
  }
  const body = await res.json();
  if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`);
  return { unchanged: false, state: body.data, etag: res.headers.get('ETag') };
}

/** Nothing changed: only when it was checked, and any error from a failed poll, are drawn again. */
function showUnchanged(generatedAt) {
  ui.state = { ...ui.state, generatedAt };
  // The list's Active view and tiles judge "recent" by this clock; past an age-out they're redrawn.
  if (Date.now() >= ui.ageOutAt) return render();
  $('updated').replaceChildren(liveTime(generatedAt, 'Updated '));
  return renderErrors(ui.state.errors);
}

async function load({ force = false } = {}) {
  if (ui.loading) return;
  ui.loading = true;
  $('refresh').disabled = true;
  if (!ui.state) $('repos').replaceChildren(h('div', { class: 'empty' }, 'Scanning worktrees, PRs and agent sessions…'));
  try {
    const answer = await fetchState(force);
    if (answer.unchanged) {
      showUnchanged(answer.generatedAt);
    } else {
      ui.state = answer.state;
      ui.etag = answer.etag;
      applyNav(answer.state.nav);
      render();
    }
  } catch (error) {
    // The next poll gets everything, which draws the list and clears this error.
    ui.etag = null;
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
document.addEventListener('switchyard:changed', (event) => load({ force: Boolean(event.detail?.force) }));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) load();
});
setInterval(() => {
  if (!document.hidden) load();
}, POLL_MS);
setInterval(() => {
  if (!document.hidden) refreshLiveTimes();
}, CLOCK_MS);

startNavBadges();
renderViews();
load();
