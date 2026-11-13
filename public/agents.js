import { h, readPref, timeAgo, toast, writePref } from './dom.js';
import { canShowTerminalSessions, sessionSearchText } from './session-text.js';
import { locateSession, renderLiveList, renderPendingRow } from './agent-views.js';
import { actionButton, post } from './actions.js';
import { renderEnded } from './ended-views.js';
import { applyNav, startNavBadges } from './nav.js';
import { isTypingReply } from './session-controls.js';
import { isEditingTask, newTaskMenu, pendingTasks, replacePending } from './new-task.js';
import { EXITED_SHOW_MS, settlePending } from './pending-tasks.js';

// Changes are pushed as they happen (see /api/agents/stream). Without the stream the page polls
// this often; with it, it only checks in after this long without an update, in case one was missed.
const POLL_MS = 4_000;
const STREAM_POLL_MS = 15_000;
const FILTER_PREF = 'switchyard.agentFilter';

// Tasks just started from New task show under these filters: as working once they start, or as waiting on you
// while Claude asks whether to trust the folder.
const PENDING_FILTERS = { all: () => true, working: (t) => t.stage !== 'trust', waiting: (t) => t.stage === 'trust' };

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
  newTaskSignature: null,
  exitTimers: new Set(),
  stream: null,
  receivedAt: 0,
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

/** Shown when a session needs you but its prompts can't be answered here yet. */
function hookHint(state, sessions) {
  if (state.capabilities?.approvalsHook !== false || !sessions.some((s) => s.needsYou)) return null;
  return h('p', { class: 'hint' }, 'To allow or deny permission prompts from this page, run ',
    h('code', {}, 'npm run hook -- install'), ' in the switchyard folder.');
}

/** Drop started tasks whose session is here now, and give up on ones that never came. */
function settleTasks(state) {
  const { pending, expired } = settlePending(pendingTasks(), state.liveSessions, Date.now(), state.taskStarts ?? []);
  replacePending(pending);
  expired.forEach((t) => toast(`Claude hasn't shown up from tmux window ${t.place} yet. Look there.`));
  // A task whose Claude quit shows a while; redraw when it's time for it to go.
  pending.filter((t) => t.stage === 'exited' && !ui.exitTimers.has(t.id)).forEach((t) => {
    ui.exitTimers.add(t.id);
    setTimeout(() => {
      ui.exitTimers.delete(t.id);
      render();
    }, EXITED_SHOW_MS + 100);
  });
}

function pendingRows() {
  const shows = PENDING_FILTERS[ui.filter];
  if (!shows) return [];
  const now = Date.now();
  return pendingTasks()
    .filter(shows)
    .filter((t) => matches([t.prompt, t.repoName, t.branch, t.path], ui.query))
    .map((t) => renderPendingRow(t, now));
}

function renderRunning(state, filter) {
  const panel = $('running').closest('.panel');
  panel.hidden = !filter.live;
  if (!filter.live) return;
  // Replacing the list would take away the reply box you're typing in; the next refresh catches up.
  if (isTypingReply()) return;
  const sessions = state.liveSessions.filter((s) => filter.live(s) && liveMatches(state, s));
  const starting = pendingRows();
  const list = sessions.length === 0 && starting.length > 0 ? [] : renderLiveList(state, sessions, {
    showParked: ui.showParked || ui.filter === 'parked',
    // The Parked filter always shows them all, so there's nothing to toggle there.
    onToggleParked: ui.filter === 'parked' ? null : () => {
      ui.showParked = !ui.showParked;
      render();
    },
    details,
    emptyText: ui.query || ui.filter !== 'all' ? 'No running sessions match.' : 'No agent sessions are running.',
  });
  $('running').replaceChildren(
    hookHint(state, sessions) ?? '',
    starting.length > 0 ? h('ul', { class: 'list pending-list' }, starting) : '',
    ...list,
  );
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

/** The repo list changes rarely; rebuilding the form only then keeps what you've typed. */
function renderNewTask(state) {
  const signature = JSON.stringify([state.capabilities?.tmux, state.repos.map((r) => r.mainPath)]);
  if (signature === ui.newTaskSignature || isEditingTask()) return;
  ui.newTaskSignature = signature;
  $('new-task').replaceChildren(newTaskMenu(state) ?? '');
}

/** One button that shows every task's tmux window in iTerm, or brings them forward. */
function renderShowSessions(state) {
  const slot = $('show-sessions');
  const wanted = canShowTerminalSessions(state.capabilities);
  if (wanted === (slot.childElementCount > 0)) return;
  slot.replaceChildren(wanted ? actionButton('Show Terminal Sessions', 'Show every task\'s tmux window in iTerm, through its tmux integration', async () => {
    const result = await post('/api/terminal/show-sessions', {});
    return result.precision === 'opened' ? 'Opening your terminal sessions in iTerm' : null;
  }, 'btn') : '');
}

function render() {
  renderViews();
  const { state } = ui;
  if (!state) return;
  renderNewTask(state);
  renderShowSessions(state);
  $('updated').textContent = `Updated ${timeAgo(state.generatedAt)}`;
  renderErrors(state.errors);
  settleTasks(state);
  renderTiles(state);
  const filter = FILTERS[ui.filter];
  renderRunning(state, filter);
  renderEndedPanel(state, filter);
}

/** Show newer data; a poll answered from an older snapshot than a pushed update is dropped. */
function show(data) {
  ui.receivedAt = Date.now();
  if (ui.state && data.generatedAt < ui.state.generatedAt) return;
  ui.state = data;
  applyNav(data.nav);
  render();
}

function openStream() {
  if (ui.stream || typeof EventSource === 'undefined') return;
  ui.stream = new EventSource('/api/agents/stream');
  ui.stream.addEventListener('agents', (event) => show(JSON.parse(event.data)));
}

function closeStream() {
  ui.stream?.close();
  ui.stream = null;
}

const streaming = () => ui.stream?.readyState === EventSource.OPEN;

async function load({ force = false } = {}) {
  if (ui.loading) return;
  ui.loading = true;
  $('refresh').disabled = true;
  if (!ui.state) $('running').replaceChildren(h('div', { class: 'empty' }, 'Looking for agent sessions…'));
  try {
    const res = await fetch(`/api/agents${force ? '?refresh=1' : ''}`);
    const body = await res.json();
    if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`);
    show(body.data);
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
document.addEventListener('switchyard:pending', () => render());
document.addEventListener('switchyard:changed', (event) => load({ force: Boolean(event.detail?.force) }));
// A hidden tab gives up its stream (browsers allow few connections per site) and catches up on return.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return closeStream();
  openStream();
  return load();
});
setInterval(() => {
  if (document.hidden) return;
  if (!streaming() || Date.now() - ui.receivedAt > STREAM_POLL_MS) load();
}, POLL_MS);

startNavBadges();
renderViews();
load();
if (!document.hidden) openStream();
