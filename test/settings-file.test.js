import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyEdits, createSettingsStore, editableSettings } from '../src/settings-file.js';

const folder = () => mkdtempSync(join(tmpdir(), 'switchyard-settings-'));
const rejectsWith = (fn, status, pattern) => assert.throws(fn, (error) => error.status === status && (!pattern || pattern.test(error.message)));

test('editableSettings: what the page edits, with defaults for anything config.json leaves out', () => {
  const values = editableSettings({ terminal: { app: 'iTerm' }, agents: { parkedAfterHours: 12 }, roots: ['~/work'] });
  assert.equal(values.terminal.app, 'iTerm');
  assert.equal(values.editor.urlScheme, 'vscode');
  assert.deepEqual(values.agents, { parkedAfterHours: 12, endedHistoryDays: 7, interruptedAttentionDays: 3 });
  assert.deepEqual(values.roots, ['~/work']);
  assert.deepEqual(values.git.longLivedBranches, ['main', 'master', 'develop', 'dev', 'trunk']);
  assert.equal(values.github.copilotReviewer, 'copilot-pull-request-reviewer[bot]');
  assert.deepEqual(editableSettings({}).roots, []);
});

test('applyEdits sets what changed and leaves out what equals the default, so config.json stays short', () => {
  const next = applyEdits({ port: 4477, terminal: { app: 'iTerm' } }, {
    terminal: { app: 'auto' },
    agents: { parkedAfterHours: 48, endedHistoryDays: 7, interruptedAttentionDays: 3 },
    editor: { urlScheme: 'cursor' },
  });
  assert.deepEqual(next, { port: 4477, agents: { parkedAfterHours: 48 }, editor: { urlScheme: 'cursor' } });
});

test('applyEdits keeps settings the page doesn\'t edit (port, claudeDir), and an empty roots list means the defaults', () => {
  const dir = folder();
  assert.deepEqual(applyEdits({ port: 5000, claudeDir: '~/c', roots: [dir] }, { roots: [] }), { port: 5000, claudeDir: '~/c' });
  assert.deepEqual(applyEdits({}, { roots: [` ${dir} `, ''] }), { roots: [dir] });
});

test('applyEdits refuses values switchyard would refuse to start with', () => {
  rejectsWith(() => applyEdits({}, { terminal: { app: 'Kitty' } }), 400, /terminal\.app/);
  rejectsWith(() => applyEdits({}, { agents: { parkedAfterHours: -1 } }), 400, /parkedAfterHours/);
  rejectsWith(() => applyEdits({}, { ci: { holdPatterns: ['('] } }), 400, /regular expression/);
  rejectsWith(() => applyEdits({}, { editor: { urlScheme: 'javascript:alert(1)' } }), 400, /urlScheme/);
});

test('applyEdits refuses settings it doesn\'t know, and folders that don\'t exist', () => {
  rejectsWith(() => applyEdits({}, { port: 1 }), 400, /port/);
  rejectsWith(() => applyEdits({}, { agents: { color: 'red' } }), 400, /agents\.color/);
  rejectsWith(() => applyEdits({}, { roots: ['/no/such/folder/for/switchyard'] }), 400, /\/no\/such\/folder/);
  rejectsWith(() => applyEdits({}, { roots: 'x' }), 400, /roots/);
});

test('the store reads config.json, and saves edits to it in place', () => {
  const dir = folder();
  const path = join(dir, 'config.json');
  const store = createSettingsStore({ path });
  assert.deepEqual(store.read(), {});
  const saved = store.save({ terminal: { app: 'Terminal' } });
  assert.deepEqual(saved.file, { terminal: { app: 'Terminal' } });
  assert.equal(saved.settings.terminal.app, 'Terminal');
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { terminal: { app: 'Terminal' } });
  assert.ok(readFileSync(path, 'utf8').endsWith('}\n'));
  assert.deepEqual(store.read(), { terminal: { app: 'Terminal' } });
});

test('the store keeps config.json\'s permissions, and leaves the file alone when an edit is refused', () => {
  const dir = folder();
  const path = join(dir, 'config.json');
  writeFileSync(path, '{ "port": 4477 }\n', { mode: 0o600 });
  const store = createSettingsStore({ path });
  rejectsWith(() => store.save({ terminal: { app: 'Kitty' } }), 400);
  assert.equal(readFileSync(path, 'utf8'), '{ "port": 4477 }\n');
  store.save({ editor: { urlScheme: 'cursor' } });
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

test('the store explains a config.json it can\'t read', () => {
  const dir = folder();
  mkdirSync(join(dir, 'sub'));
  writeFileSync(join(dir, 'config.json'), '{ nope');
  assert.throws(() => createSettingsStore({ path: join(dir, 'config.json') }).read(), /config\.json/);
});

test('the settings service shows the page what it edits, and a save reaches the live config', async () => {
  const { createSettingsService } = await import('../src/settings-file.js');
  const dir = folder();
  const store = createSettingsStore({ path: join(dir, 'config.json') });
  const updates = [];
  const live = { port: 4477, claudeDir: '/c', roots: [dir], rootsFromEnv: false, update: (file) => updates.push(file) };
  const service = createSettingsService({ store, live });
  const view = service.view();
  assert.equal(view.configPath, join(dir, 'config.json'));
  assert.deepEqual({ port: view.port, claudeDir: view.claudeDir, roots: view.roots, rootsFromEnv: view.rootsFromEnv }, { port: 4477, claudeDir: '/c', roots: [dir], rootsFromEnv: false });
  assert.equal(view.values.terminal.app, 'auto');
  assert.equal(view.defaults.agents.parkedAfterHours, 24);
  const after = await service.save({ agents: { parkedAfterHours: 6 } });
  assert.deepEqual(updates, [{ agents: { parkedAfterHours: 6 } }]);
  assert.equal(after.values.agents.parkedAfterHours, 6);
});

test('a save waits for what depends on the settings to catch up before it answers', async () => {
  const { createSettingsService } = await import('../src/settings-file.js');
  const dir = folder();
  const order = [];
  const live = { port: 1, claudeDir: '/c', roots: [dir], rootsFromEnv: false, update: () => order.push('live') };
  const service = createSettingsService({
    store: createSettingsStore({ path: join(dir, 'config.json') }),
    live,
    onSaved: async () => { await new Promise((r) => setTimeout(r, 5)); order.push('caught up'); },
  });
  const view = await service.save({ agents: { parkedAfterHours: 6 } });
  order.push('answered');
  assert.deepEqual(order, ['live', 'caught up', 'answered']);
  assert.equal(view.values.agents.parkedAfterHours, 6);
});
