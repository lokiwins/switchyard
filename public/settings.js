import { h, shortPath, toast } from './dom.js';
import { applyNav, startNavBadges } from './nav.js';
import { post } from './actions.js';
import { FIELD_NAMES, editsFromFields, fieldsFromValues } from './settings-form.js';

const $ = (id) => document.getElementById(id);
const form = $('settings');
const ui = { saved: null };

const fieldOf = (name) => form.elements.namedItem(name);
const currentFields = () => Object.fromEntries(FIELD_NAMES.map((name) => [name, fieldOf(name).value]));
const hasChanges = () => ui.saved !== null && FIELD_NAMES.some((name) => fieldOf(name).value !== ui.saved[name]);

function showChanged() {
  $('save').disabled = !hasChanges();
  $('revert').disabled = !hasChanges();
  $('save-state').textContent = hasChanges() ? 'Not saved yet' : '';
}

function showErrors(messages) {
  $('errors').hidden = messages.length === 0;
  $('errors').replaceChildren(...messages.map((m) => h('div', { class: 'error' }, m)));
}

const REPOS_FIELD = 'github.issueRepos';
const linesOf = (text) => text.split('\n').filter(Boolean);
const sameSet = (a, b) => a.length === b.length && a.every((name) => b.some((other) => other.toLowerCase() === name.toLowerCase()));

/** Tick the boxes for the repos the hidden field holds. */
function tickRepos() {
  const chosen = linesOf(fieldOf(REPOS_FIELD).value).map((name) => name.toLowerCase());
  for (const box of $('issue-repos').querySelectorAll('input[type="checkbox"]')) box.checked = chosen.includes(box.value.toLowerCase());
}

/** The ticked repos into the hidden field; ticking back to what's saved reads as no change. */
function readRepos() {
  const ticked = [...$('issue-repos').querySelectorAll('input:checked')].map((box) => box.value);
  const saved = linesOf(ui.saved[REPOS_FIELD]);
  fieldOf(REPOS_FIELD).value = sameSet(ticked, saved) ? ui.saved[REPOS_FIELD] : ticked.join('\n');
  showChanged();
}

function repoNote(repo) {
  const issues = repo.issues > 0 ? `${repo.issues} issue${repo.issues > 1 ? 's' : ''} for you` : null;
  return [issues, repo.local ? 'in your folders' : null].filter(Boolean).join(' · ') || 'chosen before';
}

/** The checklist: the repos your issues are in and the ones in your folders. */
async function loadRepoChoices() {
  const list = $('issue-repos');
  try {
    const response = await fetch('/api/settings/github-repos');
    const body = await response.json();
    if (!body.success) throw new Error(body.error ?? 'Could not list repos');
    const { repos, connected, error } = body.data;
    const notes = [
      !connected && h('span', { class: 'setting-hint' }, 'gh isn\'t signed in, so only the repos in your folders are listed (run gh auth login).'),
      error && h('span', { class: 'setting-hint' }, `GitHub: ${error}`),
    ].filter(Boolean);
    const choices = repos.map((repo) => h('label', { class: 'repo-choice' },
      h('input', { type: 'checkbox', value: repo.name, onchange: readRepos }),
      h('span', { class: 'repo-name' }, repo.name),
      h('span', { class: 'setting-hint' }, repoNote(repo))));
    list.replaceChildren(...notes, ...(choices.length > 0 ? choices : [h('span', { class: 'setting-hint' }, 'No GitHub repos found yet.')]));
    tickRepos();
  } catch (error) {
    list.replaceChildren(h('span', { class: 'setting-hint' }, `Couldn't list repos: ${error.message}`));
  }
}

/** Fill the form from what the server says is saved. */
function show(view) {
  ui.saved = fieldsFromValues(view.values);
  for (const name of FIELD_NAMES) fieldOf(name).value = ui.saved[name];
  for (const name of FIELD_NAMES) {
    const value = fieldsFromValues(view.defaults)[name];
    fieldOf(name).placeholder = name === 'roots' ? '~/work' : value.split('\n')[0];
  }
  $('roots-now').textContent = view.rootsFromEnv
    ? `SWITCHYARD_ROOTS is set, so it decides for now: ${view.roots.map(shortPath).join(', ')}`
    : `Looking in: ${view.roots.map(shortPath).join(', ')}`;
  $('facts').replaceChildren(
    h('dt', {}, 'Port'), h('dd', {}, String(view.port)),
    h('dt', {}, 'Claude folder'), h('dd', {}, shortPath(view.claudeDir)),
    h('dt', {}, 'Config file'), h('dd', {}, shortPath(view.configPath)),
  );
  $('updated').textContent = '';
  tickRepos();
  showChanged();
}

async function load() {
  try {
    const response = await fetch('/api/settings');
    const body = await response.json();
    if (!body.success) throw new Error(body.error ?? 'Could not load settings');
    applyNav(body.data.nav);
    show(body.data);
    showErrors([]);
  } catch (error) {
    $('updated').textContent = '';
    showErrors([error.message]);
  }
}

form.addEventListener('input', showChanged);
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  $('save').disabled = true;
  $('save-state').textContent = 'Saving…';
  try {
    show(await post('/api/settings/save', editsFromFields(currentFields())));
    showErrors([]);
    toast('Settings saved. They apply now.');
  } catch (error) {
    showErrors([error.message]);
    $('save-state').textContent = 'Not saved';
    $('save').disabled = false;
  }
});
$('revert').addEventListener('click', () => {
  for (const name of FIELD_NAMES) fieldOf(name).value = ui.saved[name];
  tickRepos();
  showErrors([]);
  showChanged();
});
window.addEventListener('beforeunload', (event) => {
  if (hasChanges()) event.preventDefault();
});

startNavBadges();
load().then(loadRepoChoices);
