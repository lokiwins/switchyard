import { h, readPref, timeAgo, writePref } from './dom.js';
import { sessionSearchText } from './session-text.js';
import { locateSession, renderLiveList } from './agent-views.js';
import { renderEnded } from './ended-views.js';
import { startNavBadges } from './nav.js';

const POLL_MS = 15_000;
const FILTER_PREF = 'switchyard.agentFilter';

const isWaiting = (s) => s.status === 'idle' && !s.parked;

/** Each filter picks which live and which ended sessions to show. */
const FILTERS = {
  all: { label: 'All', live: () => true, ended: () => true },
  working: { label: 'Working', live: (s) => s.status === 'busy', ended: null },
  waiting: { label: 'Waiting', live: isWaiting, ended: null },
  interrupted: { label: 'Interrupted', live: null, ended: (s) => s.endState === 'interrupted' },
  parked: { label: 'Parked', live: (s) => s.parked, ended: null },
  ended: { label: 'Ended', live: null, ended: () => true },
};

const ui = {
  state: null,
  filter: FILTERS[readPref(FILTER_PREF, 'all')] ? readPref(FILTER_PREF, 'all') : 'all',
  query: '',
  showParked: false,
  showAllEnded: false,
  openDetails: new Set(),
  loading: false,
};

const $ = (id) => document.getElementById(id);

const details = {
  isOpen: (id) => ui.openDetails.has(id),
  toggle: (id) => {
    if (ui.openDetails.has(id)) ui.openDetails.delete(id);
    else ui.openDetails.add(id);
    render();
  },
};

function setFilter(filter) {
  ui.filter = filter;
  writePref(FILTER_PREF, filter);
  render();
}

function matches(fields, query) {
  if (!query) return true;
  const haystack = fields.filter(Boolean).join(' ').toLowerCase();
  return query.toLowerCase().split(/\s+/).every((term) => haystack.includes(term));
}

function liveMatches(state, s) {
  const where = locateSession(state, s);
  return matches([...sessionSearchText(s), s.cwd, where?.repo.name, where?.worktree.branch], ui.query);
}

function endedMatches(s) {
  return matches([...sessionSearchText(s), s.cwd, s.repoName, s.branch], ui.query);
}

function tiles(state) {
  const live = state.liveSessions;
  const count = (key) => live.filter(FILTERS[key].live ?? (() => false)).length;
  const interrupted = state.endedSessions.filter((s) => s.endState === 'interrupted').length;
  return [
    { filter: 'working', label: 'Working', value: count('working'), tone: 'green' },
    { filter: 'waiting', label: 'Waiting on you', value: count('waiting'), tone: 'amber' },
    { filter: 'interrupted', label: 'Interrupted', value: interrupted, tone: 'amber' },
    { filter: 'parked', label: 'Parked', value: count('parked') },
    { filter: 'ended', label: `Ended (${state.endedHistoryDays}d)`, value: state.endedSessions.length },
  ];
}

function renderTiles(state) {
  $('tiles').replaceChildren(...tiles(state).map((tile) => h('button', {
    type: 'button',
    class: ['tile', tile.tone && `tone-${tile.tone}`, tile.value > 0 && 'has-value'].filter(Boolean).join(' '),
    'aria-pressed': String(ui.filter === tile.filter),
    onclick: () => setFilter(ui.filter === tile.filter ? 'all' : tile.filter),
  }, h('div', { class: 'value' }, tile.value), h('div', { class: 'label' }, tile.label))));
}

function renderViews() {
  $('views').replaceChildren(...Object.entries(FILTERS).map(([key, f]) => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(ui.filter === key), onclick: () => setFilter(key),
  }, f.label)));
}

function renderErrors(errors) {
  const el = $('errors');
  el.hidden = errors.length === 0;
  el.replaceChildren(...errors.map((e) => h('div', {}, `${e.source}: ${e.message}`)));
}

function renderRunning(state, filter) {
  const panel = $('running').closest('.panel');
  panel.hidden = !filter.live;
  if (!filter.live) return;
  const sessions = state.liveSessions.filter((s) => filter.live(s) && liveMatches(state, s));
  $('running').replaceChildren(...renderLiveList(state, sessions, {
    showParked: ui.showParked || ui.filter === 'parked',
    onToggleParked: () => {
      ui.showParked = !ui.showParked;
      render();
    },
    details,
    emptyText: ui.query || ui.filter !== 'all' ? 'No running sessions match.' : 'No agent sessions are running.',
  }));
}

function renderEndedPanel(state, filter) {
  $('ended-panel').hidden = !filter.ended;
  if (!filter.ended) return;
  const sessions = state.endedSessions.filter((s) => filter.ended(s) && endedMatches(s));
  const interrupted = sessions.filter((s) => s.needsAttention).length;
  $('ended-count').replaceChildren(
    `${sessions.length} in the last ${state.endedHistoryDays} days`,
    interrupted > 0 ? ' · ' : '',
    interrupted > 0 ? h('span', { class: 'pill amber' }, `${interrupted} interrupted`) : '',
  );
  $('ended').replaceChildren(...renderEnded(sessions, {
    expanded: ui.showAllEnded,
    onToggle: () => {
      ui.showAllEnded = !ui.showAllEnded;
      render();
    },
    details,
    caps: state.capabilities,
    collapse: ui.filter === 'all' && !ui.query,
    emptyText: 'No ended sessions match.',
  }));
}

function render() {
  renderViews();
  const { state } = ui;
  if (!state) return;
  $('updated').textContent = `Updated ${timeAgo(state.generatedAt)}`;
  renderErrors(state.errors);
  renderTiles(state);
  const filter = FILTERS[ui.filter];
  renderRunning(state, filter);
  renderEndedPanel(state, filter);
}

async function load({ force = false } = {}) {
  if (ui.loading) return;
  ui.loading = true;
  $('refresh').disabled = true;
  if (!ui.state) $('running').replaceChildren(h('div', { class: 'empty' }, 'Looking for agent sessions…'));
  try {
    const res = await fetch(`/api/state${force ? '?refresh=1' : ''}`);
    const body = await res.json();
    if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`);
    ui.state = body.data;
    render();
  } catch (error) {
    renderErrors([{ source: 'monitor', message: `Could not load sessions: ${error.message}` }]);
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
