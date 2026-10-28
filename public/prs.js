import { h, liveTime, readPref, refreshLiveTimes, toast, writePref } from './dom.js';
import { startNavBadges } from './nav.js';
import {
  FILTERS, matchesQuery, prTiles, renderPrList, renderPrTiles, renderTeamList,
} from './pr-views.js';

// The page listens to /api/prs/stream; polling is only a fallback while that is down.
const FALLBACK_POLL_MS = 60_000;
const CLOCK_MS = 5_000;
const FILTER_PREF = 'switchyard.prFilter';

const ui = {
  data: null,
  filter: FILTERS[readPref(FILTER_PREF, 'all')] ? readPref(FILTER_PREF, 'all') : 'all',
  query: '',
  loading: false,
  live: false,
};

const $ = (id) => document.getElementById(id);

function setFilter(filter) {
  ui.filter = filter;
  writePref(FILTER_PREF, filter);
  render();
}

function renderErrors(errors) {
  const el = $('errors');
  el.hidden = errors.length === 0;
  el.replaceChildren(...errors.map((e) => h('div', {}, `${e.source}: ${e.message}`)));
}

async function requestCopilotReview(pr, button) {
  button.disabled = true;
  button.textContent = 'Requesting…';
  try {
    const res = await fetch('/api/prs/copilot-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: pr.repo, number: pr.number }),
    });
    const body = await res.json();
    if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`);
    toast(`Copilot review requested on #${pr.number}`);
    await load();
  } catch (error) {
    toast(`Could not request Copilot review: ${error.message}`);
    button.disabled = false;
    button.textContent = 'Retry Copilot review';
  }
}

function visible(prs) {
  return prs.filter((pr) => FILTERS[ui.filter].test(pr) && matchesQuery(pr, ui.query));
}

function render() {
  const { data } = ui;
  if (!data) return;
  renderStatus();
  renderErrors(data.errors);
  $('tiles').replaceChildren(...renderPrTiles(prTiles(data), ui.filter, setFilter));

  const filtered = ui.filter === 'all' ? '' : ` matching “${FILTERS[ui.filter].label}”`;
  $('authored').replaceChildren(...renderPrList(visible(data.authored), {
    emptyText: data.authored.length ? `No PRs${filtered}.` : 'You have no open pull requests.',
    showAuthor: false,
    onCopilot: requestCopilotReview,
    caps: data.capabilities,
  }));
  $('review-count').textContent = `${data.reviewRequested.length} open`;
  $('review').replaceChildren(...renderPrList(visible(data.reviewRequested), {
    emptyText: data.reviewRequested.length ? `No review requests${filtered}.` : 'No one is waiting on your review.',
    showAuthor: true,
    caps: data.capabilities,
  }));
  const team = data.teamReviewRequested.filter((pr) => matchesQuery(pr, ui.query));
  $('team-count').textContent = `${team.length} open`;
  $('team').replaceChildren(...renderTeamList(team));
}

/** "● Live · GitHub checked 12s ago" while the stream is connected. */
function renderStatus() {
  const synced = ui.data?.syncedAt;
  $('updated').replaceChildren(
    h('span', { class: `live-dot${ui.live ? ' on' : ''}`, title: ui.live ? 'Receiving updates as they happen' : 'Reconnecting…' }),
    ui.live ? 'Live · ' : 'Reconnecting · ',
    synced ? liveTime(synced, 'GitHub checked ') : 'Loading…',
  );
}

async function load({ force = false } = {}) {
  if (ui.loading) return;
  ui.loading = true;
  $('refresh').disabled = true;
  if (!ui.data) $('authored').replaceChildren(h('div', { class: 'empty' }, 'Loading pull requests from GitHub…'));
  try {
    const res = await fetch(`/api/prs${force ? '?refresh=1' : ''}`);
    const body = await res.json();
    if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`);
    ui.data = body.data;
    render();
  } catch (error) {
    renderErrors([{ source: 'monitor', message: `Could not load pull requests: ${error.message}` }]);
  } finally {
    ui.loading = false;
    $('refresh').disabled = false;
  }
}

let stream = null;

/** Updates arrive as they happen; the browser reconnects on its own if the stream drops. */
function connect() {
  if (stream) return;
  stream = new EventSource('/api/prs/stream');
  stream.addEventListener('prs', (event) => {
    ui.data = JSON.parse(event.data);
    ui.live = true;
    render();
  });
  stream.addEventListener('failure', (event) => {
    renderErrors([{ source: 'monitor', message: JSON.parse(event.data).error }]);
  });
  stream.addEventListener('open', () => {
    ui.live = true;
    renderStatus();
  });
  stream.addEventListener('error', () => {
    ui.live = false;
    renderStatus();
  });
}

/** Closing the stream while the tab is hidden lets the server stop asking GitHub. */
function disconnect() {
  stream?.close();
  stream = null;
  ui.live = false;
}

$('refresh').addEventListener('click', () => load({ force: true }));
$('search').addEventListener('input', (event) => {
  ui.query = event.target.value.trim();
  render();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) disconnect();
  else connect();
});
setInterval(() => refreshLiveTimes(), CLOCK_MS);
setInterval(() => {
  if (!document.hidden && !ui.live) load();
}, FALLBACK_POLL_MS);

startNavBadges();
renderStatus();
connect();
