import { h } from './dom.js';
import { dropdown } from './actions.js';
import { MODES, THEMES } from './themes.js';
import { TERMINAL_CHOICES } from './terminal-themes.js';

/*
 * The theme menu in the top bar: this browser's own theme, light/dark mode
 * and terminal colours, or the defaults chosen on the Settings page. theme-boot.js keeps the
 * choice (localStorage) and applies it; this only offers it.
 */

const labelOf = (list, id) => list.find((item) => item.id === id)?.label ?? id;
const CHOICES = { theme: THEMES, mode: MODES, terminal: TERMINAL_CHOICES };

/** One choice; `value` null means "use the Settings default". Ticked by update(). */
function choiceItem(appearance, key, value) {
  return h('button', {
    type: 'button',
    class: 'menu-item theme-choice',
    role: 'menuitemradio',
    'aria-checked': 'false',
    'data-key': key,
    'data-value': value ?? '',
    onclick: () => appearance.choose({ [key]: value }),
  }, h('span', { class: 'theme-tick', 'aria-hidden': 'true' }), h('span', { class: 'menu-title' }, value ? labelOf(CHOICES[key], value) : ''));
}

/** The choices, built once (so a click never lands on a replaced button, which would close the menu). */
function choices(appearance) {
  const group = (key, list, label) => h('div', { class: `theme-group is-${key}`, role: 'group', 'aria-label': label },
    h('div', { class: 'menu-label' }, label),
    choiceItem(appearance, key, null),
    ...list.map((item) => choiceItem(appearance, key, item.id)));
  return [group('theme', THEMES, 'Theme'), group('mode', MODES, 'Light or dark'), group('terminal', TERMINAL_CHOICES, 'Terminal')];
}

/** Tick what this browser uses now, and name the Settings defaults. */
function update(panel, appearance) {
  const now = appearance.current();
  for (const item of panel.querySelectorAll('.theme-choice')) {
    const { key, value } = item.dataset;
    const chosen = value ? now.own[key] === value : !now.own[key];
    item.setAttribute('aria-checked', String(chosen));
    item.querySelector('.theme-tick').textContent = chosen ? '✓' : '';
    if (!value) item.querySelector('.menu-title').textContent = `Settings default (${labelOf(CHOICES[key], now.defaults[key])})`;
  }
}

/** Put the theme menu at the start of the top bar's actions, kept up to date as the theme changes. */
export function mountThemeMenu(appearance = window.switchyardAppearance) {
  const bar = document.querySelector('.topbar-actions');
  if (!appearance || !bar) return;
  const panel = h('div', { class: 'theme-choices' }, choices(appearance));
  const menu = dropdown({
    key: 'theme',
    label: [h('span', { 'aria-hidden': 'true' }, '◐'), h('span', { class: 'visually-hidden' }, 'Theme')],
    title: 'Theme, light or dark, and terminal colours for this browser',
    className: 'btn btn-sm btn-secondary theme-button',
    panelClass: 'theme-panel',
    focusInput: false,
  }, panel);
  update(panel, appearance);
  document.addEventListener('switchyard:theme', () => update(panel, appearance));
  bar.prepend(menu);
}
