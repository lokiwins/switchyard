import { h, readPref, timeAgo, toast, writePref } from './dom.js';
import { startNavBadges } from './nav.js';
import {
  FILTERS, matchesQuery, prTiles, renderPrList, renderPrTiles, renderTeamList,
} from './pr-views.js';

const POLL_MS = 30_000;
const FILTER_PREF = 'switchyard.prFilter';

const ui = {
  data: null,
  filter: FILTERS[readPref(FILTER_PREF, 'all')] ? readPref(FILTER_PREF, 'all') : 'all',
  query: '',
  loading: false,
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
  $('updated').textContent = `Updated ${timeAgo(data.generatedAt)}`;
  renderErrors(data.errors);
  $('tiles').replaceChildren(...renderPrTiles(prTiles(data), ui.filter, setFilter));

  const filtered = ui.filter === 'all' ? '' : ` matching “${FILTERS[ui.filter].label}”`;
  $('authored').replaceChildren(...renderPrList(visible(data.authored), {
    emptyText: data.authored.length ? `No PRs${filtered}.` : 'You have no open pull requests.',
    showAuthor: false,
    onCopilot: requestCopilotReview,
  }));
  $('review-count').textContent = `${data.reviewRequested.length} open`;
  $('review').replaceChildren(...renderPrList(visible(data.reviewRequested), {
    emptyText: data.reviewRequested.length ? `No review requests${filtered}.` : 'No one is waiting on your review.',
    showAuthor: true,
  }));
  const team = data.teamReviewRequested.filter((pr) => matchesQuery(pr, ui.query));
  $('team-count').textContent = `${team.length} open`;
  $('team').replaceChildren(...renderTeamList(team));
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
load();
