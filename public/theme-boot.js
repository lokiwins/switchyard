/*
 * Sets the page's theme before it draws: <html data-theme data-mode data-terminal data-scheme>.
 * The server fills in the Settings default (see src/theme-boot.js); this
 * browser's own choice, made in the top bar, is kept in localStorage and wins
 * over it, theme, mode and terminal separately. "system" mode follows the OS as it
 * changes. A plain script, not a module, so it runs before the stylesheets.
 */
(function () {
  var SETUP = /*APPEARANCE*/null;
  var KEY = 'switchyard.appearance';
  var defaults = SETUP.defaults;
  var system = window.matchMedia('(prefers-color-scheme: dark)');
  // Where storage is blocked, a choice lasts for this page only.
  var unsaved = null;

  function known(value, list) { return typeof value === 'string' && list.indexOf(value) >= 0 ? value : null; }

  /** This browser's own choice: { theme?, mode? }, each only if it's one switchyard knows. */
  function own() {
    var saved = unsaved;
    try { saved = JSON.parse(window.localStorage.getItem(KEY)) || unsaved; } catch (e) { /* blocked or garbled */ }
    var choice = {};
    if (saved && known(saved.theme, SETUP.themes)) choice.theme = saved.theme;
    if (saved && known(saved.mode, SETUP.modes)) choice.mode = saved.mode;
    if (saved && known(saved.terminal, SETUP.terminals)) choice.terminal = saved.terminal;
    return choice;
  }

  function current() {
    var choice = own();
    return {
      theme: choice.theme || defaults.theme,
      mode: choice.mode || defaults.mode,
      terminal: choice.terminal || defaults.terminal,
      own: choice,
      defaults: defaults,
    };
  }

  function apply() {
    var now = current();
    var html = document.documentElement;
    html.dataset.theme = now.theme;
    html.dataset.mode = now.mode;
    html.dataset.terminal = now.terminal;
    html.dataset.scheme = now.mode === 'system' ? (system.matches ? 'dark' : 'light') : now.mode;
    document.dispatchEvent(new CustomEvent('switchyard:theme'));
  }

  /** Change this browser's choice: { theme, mode }, where null means "use the Settings default". */
  function choose(change) {
    var next = own();
    for (var key in change) {
      if (change[key] === null) delete next[key];
      else next[key] = change[key];
    }
    var empty = !next.theme && !next.mode && !next.terminal;
    try {
      if (empty) window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, JSON.stringify(next));
      unsaved = null;
    } catch (e) {
      unsaved = empty ? null : next;
    }
    apply();
  }

  /** The Settings page saved a new default: use it here too. */
  function setDefaults(next) {
    defaults = { theme: next.theme, mode: next.mode, terminal: next.terminal || 'match' };
    apply();
  }

  system.addEventListener('change', apply);
  window.addEventListener('storage', function (event) { if (event.key === KEY) apply(); });
  window.switchyardAppearance = { current: current, choose: choose, setDefaults: setDefaults };
  apply();
}());
