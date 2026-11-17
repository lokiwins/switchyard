import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { MODES, THEMES } from '../public/themes.js';
import { DEFAULT_SETTINGS, parseSettings } from '../src/settings.js';
import { editableSettings, applyEdits } from '../src/settings-file.js';
import { editsFromFields, fieldsFromValues, FIELD_NAMES } from '../public/settings-form.js';

const PUBLIC_DIR = join(import.meta.dirname, '..', 'public');
const read = (file) => readFileSync(join(PUBLIC_DIR, file), 'utf8');
const PAGES = ['agents.html', 'worktrees.html', 'prs.html', 'tasks.html', 'settings.html', 'graph.html'];

/** The color tokens Classic defines in styles.css's :root, which every other theme must define too. */
function colorTokens() {
  const root = read('styles.css').match(/:root\s*\{([^}]*)\}/)[1];
  const layout = /^(space|text|leading|radius|mono|font)/;
  return [...root.matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1]).filter((name) => !layout.test(name));
}

/** The custom properties a themes.css rule for `selector` sets. */
function tokensIn(css, selector) {
  const escaped = selector.replace(/[[\]"=]/g, (c) => `\\${c}`);
  const rule = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return rule ? [...rule[1].matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1]) : null;
}

test('the themes: Classic first, each with an id and a name; modes are light, dark and system', () => {
  assert.deepEqual(THEMES.map((t) => t.id), ['classic', 'signal', 'ember', 'dusk', 'graphite']);
  assert.ok(THEMES.every((t) => typeof t.label === 'string' && t.label));
  assert.deepEqual(MODES.map((m) => m.id), ['system', 'light', 'dark']);
});

test('every theme but Classic sets every color token, light and dark', () => {
  const css = read('themes.css');
  const tokens = colorTokens();
  assert.ok(tokens.includes('on-accent') && tokens.includes('accent'), 'styles.css defines the color tokens');
  for (const { id } of THEMES.filter((t) => t.id !== 'classic')) {
    for (const selector of [`:root[data-theme="${id}"]`, `:root[data-theme="${id}"][data-scheme="dark"]`]) {
      const set = tokensIn(css, selector);
      assert.ok(set, `themes.css has no rule for ${selector}`);
      const missing = tokens.filter((token) => !set.includes(token));
      assert.deepEqual(missing, [], `${selector} leaves out ${missing.join(', ')}`);
    }
  }
});

test('Classic\'s dark colors follow the chosen mode, not only the system\'s', () => {
  const css = read('styles.css');
  assert.equal(/prefers-color-scheme/.test(css), false, 'dark mode comes from data-scheme, which the boot script sets');
  assert.ok(tokensIn(css, ':root[data-scheme="dark"]')?.includes('bg'));
});

test('text on an accent or danger color uses its token, never a hard-coded white', () => {
  const css = read('styles.css');
  assert.deepEqual(css.match(/color:\s*(#fff\b|#ffffff\b|white\b)/g), null);
});

test('every page applies the theme before it draws: the boot script, then the stylesheets', () => {
  for (const page of PAGES) {
    const head = read(page).split('</head>')[0];
    const boot = head.indexOf('<script src="/theme-boot.js"></script>');
    assert.ok(boot >= 0, `${page} doesn't load /theme-boot.js in its <head>`);
    assert.ok(boot < head.indexOf('/styles.css'), `${page} loads the boot script after its stylesheet`);
    assert.ok(head.includes('<link rel="stylesheet" href="/themes.css">'), `${page} doesn't load /themes.css`);
  }
});

test('appearance settings: Classic, following the system, by default; only known themes and modes', () => {
  assert.deepEqual(DEFAULT_SETTINGS.appearance, { theme: 'classic', mode: 'system' });
  assert.deepEqual(parseSettings({ appearance: { theme: 'signal', mode: 'dark' } }).appearance, { theme: 'signal', mode: 'dark' });
  assert.throws(() => parseSettings({ appearance: { theme: 'neon' } }), /appearance.theme/);
  assert.throws(() => parseSettings({ appearance: { mode: 'dim' } }), /appearance.mode/);
  assert.throws(() => parseSettings({ appearance: { font: 'x' } }), /appearance.font/);
});

test('the Settings page edits the appearance, and saves only what differs from the default', () => {
  assert.deepEqual(editableSettings({}).appearance, { theme: 'classic', mode: 'system' });
  assert.deepEqual(applyEdits({}, { appearance: { theme: 'ember', mode: 'system' } }), { appearance: { theme: 'ember' } });
  assert.deepEqual(applyEdits({ appearance: { theme: 'ember' } }, { appearance: { theme: 'classic', mode: 'system' } }), {});
  assert.ok(FIELD_NAMES.includes('appearance.theme') && FIELD_NAMES.includes('appearance.mode'));
  const values = { ...editableSettings({}), appearance: { theme: 'dusk', mode: 'light' } };
  assert.deepEqual(editsFromFields(fieldsFromValues(values)).appearance, { theme: 'dusk', mode: 'light' });
});
