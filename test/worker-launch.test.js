import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createWorkerLaunch } from '../src/worker-launch.js';

const freshDir = () => mkdtempSync(join(tmpdir(), 'switchyard-worker-'));
const mode = (path) => statSync(path).mode & 0o777;

test('a worker\'s allowed tools go in a settings file only you can read, never on its command line', async () => {
  const dir = freshDir();
  const launch = await createWorkerLaunch({ dir }).prepare('sy-wrk001', { permissionMode: 'acceptEdits', allowedTools: ['Bash(npm test)', 'Edit'] });
  assert.deepEqual(launch, { permissionMode: 'acceptEdits', settings: join(dir, 'workers', 'sy-wrk001.settings.json') });
  assert.deepEqual(JSON.parse(readFileSync(launch.settings, 'utf8')), { permissions: { allow: ['Bash(npm test)', 'Edit'] } });
  assert.equal(mode(launch.settings), 0o600);
  assert.equal(mode(join(dir, 'workers')), 0o700);
});

test('Claude\'s own default sends no mode, and no allowed tools write no file', async () => {
  const dir = freshDir();
  assert.deepEqual(await createWorkerLaunch({ dir }).prepare('sy-wrk001', { permissionMode: 'claude', allowedTools: [] }), {});
  assert.equal(existsSync(join(dir, 'workers')), false);
});

test('only a task id gets a file', async () => {
  await assert.rejects(createWorkerLaunch({ dir: freshDir() }).prepare('../x', { permissionMode: 'plan', allowedTools: ['Edit'] }), /task id/);
});
