import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { themeBootScript } from '../src/theme-boot.js';

const SOURCE = readFileSync(join(import.meta.dirname, '..', 'public', 'theme-boot.js'), 'utf8');
const KEY = 'switchyard.appearance';

/** Run the boot script as a page would, in a fake browser; returns what it set and how to poke it. */
function boot({ appearance = { theme: 'classic', mode: 'system' }, stored = null, osDark = false, storageFails = false } = {}) {
  const data = new Map(stored ? [[KEY, JSON.stringify(stored)]] : []);
  const media = { matches: osDark, listeners: [], addEventListener(type, fn) { this.listeners.push(fn); } };
  const windowListeners = {};
  const events = [];
  const html = { dataset: {} };
  const localStorage = {
    getItem: (key) => { if (storageFails) throw new Error('blocked'); return data.get(key) ?? null; },
    setItem: (key, value) => { if (storageFails) throw new Error('blocked'); data.set(key, value); },
    removeItem: (key) => { if (storageFails) throw new Error('blocked'); data.delete(key); },
  };
  const window = {
    localStorage,
    matchMedia: () => media,
    addEventListener: (type, fn) => { windowListeners[type] = fn; },
  };
  const context = {
    window,
    localStorage,
    document: { documentElement: html, dispatchEvent: (event) => events.push(event.type) },
    CustomEvent: class { constructor(type) { this.type = type; } },
  };
  vm.runInNewContext(themeBootScript(SOURCE, appearance), context);
  return {
    html: html.dataset,
    api: window.switchyardAppearance,
    events,
    stored: () => JSON.parse(data.get(KEY) ?? 'null'),
    osChanges: (dark) => { media.matches = dark; media.listeners.forEach((fn) => fn()); },
    otherTab: (value) => { data.set(KEY, JSON.stringify(value)); windowListeners.storage?.({ key: KEY }); },
  };
}

test('with nothing chosen in this browser, the Settings default applies; System follows the OS', () => {
  assert.deepEqual({ ...boot().html }, { theme: 'classic', mode: 'system', scheme: 'light' });
  assert.deepEqual({ ...boot({ osDark: true }).html }, { theme: 'classic', mode: 'system', scheme: 'dark' });
  assert.deepEqual({ ...boot({ appearance: { theme: 'signal', mode: 'dark' } }).html }, { theme: 'signal', mode: 'dark', scheme: 'dark' });
});

test('this browser\'s choice wins over the default, one part at a time', () => {
  const page = boot({ appearance: { theme: 'ember', mode: 'light' }, stored: { mode: 'dark' } });
  assert.deepEqual({ ...page.html }, { theme: 'ember', mode: 'dark', scheme: 'dark' });
  assert.deepEqual({ ...boot({ stored: { theme: 'dusk' }, osDark: true }).html }, { theme: 'dusk', mode: 'system', scheme: 'dark' });
});

test('a pinned mode ignores the OS; System follows it as it changes', () => {
  const pinned = boot({ stored: { mode: 'light' }, osDark: true });
  assert.equal(pinned.html.scheme, 'light');
  const following = boot();
  following.osChanges(true);
  assert.equal(following.html.scheme, 'dark');
  assert.ok(following.events.includes('switchyard:theme'));
});

test('choosing in the menu saves it in this browser and applies at once; clearing goes back to the default', () => {
  const page = boot();
  page.api.choose({ theme: 'graphite', mode: 'dark' });
  assert.deepEqual(page.stored(), { theme: 'graphite', mode: 'dark' });
  assert.deepEqual({ ...page.html }, { theme: 'graphite', mode: 'dark', scheme: 'dark' });
  page.api.choose({ theme: null });
  assert.deepEqual(page.stored(), { mode: 'dark' });
  assert.equal(page.html.theme, 'classic');
  page.api.choose({ mode: null });
  assert.equal(page.stored(), null);
  // Made in the page's own realm, so compared as plain data.
  assert.deepEqual(JSON.parse(JSON.stringify(page.api.current())), { theme: 'classic', mode: 'system', own: {}, defaults: { theme: 'classic', mode: 'system' } });
});

test('a choice made in another tab applies here too', () => {
  const page = boot();
  page.otherTab({ theme: 'signal' });
  assert.equal(page.html.theme, 'signal');
});

test('a saved Settings default reaches the open page', () => {
  const page = boot();
  page.api.setDefaults({ theme: 'dusk', mode: 'light' });
  assert.deepEqual({ ...page.html }, { theme: 'dusk', mode: 'light', scheme: 'light' });
});

test('an unknown or garbled stored choice, or blocked storage, falls back to the default', () => {
  assert.equal(boot({ stored: { theme: 'neon', mode: 'dim' } }).html.theme, 'classic');
  assert.equal(boot({ stored: { theme: 'neon', mode: 'dim' } }).html.mode, 'system');
  const blocked = boot({ storageFails: true, appearance: { theme: 'ember', mode: 'dark' } });
  assert.deepEqual({ ...blocked.html }, { theme: 'ember', mode: 'dark', scheme: 'dark' });
  blocked.api.choose({ theme: 'dusk' }); // nowhere to keep it: applies for this page only
  assert.equal(blocked.html.theme, 'dusk');
});

test('themeBootScript fills in the default and the known themes as JSON, nothing else', () => {
  const script = themeBootScript(SOURCE, { theme: 'signal', mode: 'dark' });
  assert.ok(script.includes('"theme":"signal"'));
  assert.ok(script.includes('"classic"'));
  assert.throws(() => themeBootScript(SOURCE, { theme: '</script><b>', mode: 'dark' }), /theme/);
});
