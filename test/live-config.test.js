import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLiveConfig } from '../src/live-config.js';
import { parseSettings } from '../src/settings.js';

const folder = () => mkdtempSync(join(tmpdir(), 'switchyard-live-'));

test('services holding the live config see a saved change at once, without a restart', () => {
  const [a, b] = [folder(), folder()];
  const live = createLiveConfig({ port: 4477, claudeDir: '/c', roots: [a], settings: parseSettings({}) }, { env: {} });
  const { settings } = live;
  assert.equal(settings.agents.parkedAfterMs, 24 * 3600e3);
  live.update({ roots: [b], agents: { parkedAfterHours: 2 } });
  assert.equal(settings.agents.parkedAfterMs, 2 * 3600e3, 'the same settings object, read again');
  assert.deepEqual(live.roots, [b]);
  assert.equal(live.port, 4477);
  assert.equal(live.claudeDir, '/c');
});

test('SWITCHYARD_ROOTS still decides the roots over a saved list, as it does at start', () => {
  const [a, b] = [folder(), folder()];
  const live = createLiveConfig({ port: 1, claudeDir: '/c', roots: [a], settings: parseSettings({}) }, { env: { SWITCHYARD_ROOTS: a } });
  live.update({ roots: [b] });
  assert.deepEqual(live.roots, [a]);
  assert.equal(live.rootsFromEnv, true);
});

test('update tells whoever listens what changed', () => {
  const live = createLiveConfig({ port: 1, claudeDir: '/c', roots: [folder()], settings: parseSettings({}) }, { env: {} });
  const heard = [];
  live.onChange((change) => heard.push(change));
  live.update({ terminal: { app: 'Terminal' } });
  assert.equal(heard.length, 1);
  assert.equal(heard[0].settings.terminal.app, 'Terminal');
});
