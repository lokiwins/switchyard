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
  showErrors([]);
  showChanged();
});
window.addEventListener('beforeunload', (event) => {
  if (hasChanges()) event.preventDefault();
});

startNavBadges();
load();
