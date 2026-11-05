import assert from 'node:assert/strict';
import { lstat, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { HOOK_PATH, hookUrl, isHookInstalled, readClaudeSettings, withHook, withoutHook, writeClaudeSettings } from '../src/claude-hook.js';

const PORT = 4477;
const entry = { hooks: [{ type: 'http', url: 'http://127.0.0.1:4477/hooks/permission-request', timeout: 3600 }] };

test('the hook posts to switchyard over 127.0.0.1, which the server listens on', () => {
  assert.equal(HOOK_PATH, '/hooks/permission-request');
  assert.equal(hookUrl(PORT), 'http://127.0.0.1:4477/hooks/permission-request');
});

test('installing adds the hook and keeps every other setting', () => {
  const settings = { model: 'opus', hooks: { PermissionRequest: [{ hooks: [{ type: 'command', command: 'notify' }] }], Stop: [] } };
  const next = withHook(settings, PORT);
  assert.deepEqual(next, {
    model: 'opus',
    hooks: { PermissionRequest: [{ hooks: [{ type: 'command', command: 'notify' }] }, entry], Stop: [] },
  });
  assert.equal(settings.hooks.PermissionRequest.length, 1, 'the original object is left alone');
  assert.equal(isHookInstalled(next, PORT), true);
  assert.equal(isHookInstalled(settings, PORT), false);
});

test('installing twice changes nothing', () => {
  const once = withHook({}, PORT);
  assert.deepEqual(withHook(once, PORT), once);
});

test('a hook for another port does not count as installed', () => {
  assert.equal(isHookInstalled(withHook({}, 5000), PORT), false);
});

test('removing takes out only switchyard’s hook', () => {
  const settings = withHook({ hooks: { PermissionRequest: [{ hooks: [{ type: 'command', command: 'notify' }] }] } }, PORT);
  assert.deepEqual(withoutHook(settings, PORT), { hooks: { PermissionRequest: [{ hooks: [{ type: 'command', command: 'notify' }] }] } });
  assert.deepEqual(withoutHook(withHook({}, PORT), PORT), { hooks: {} });
});

test('settings are read as {} when the file is missing, and written back as formatted JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'switchyard-hook-'));
  const file = join(dir, 'settings.json');
  assert.deepEqual(await readClaudeSettings(file), {});
  await writeClaudeSettings(file, withHook({}, PORT));
  assert.equal(await readFile(file, 'utf8'), `${JSON.stringify(withHook({}, PORT), null, 2)}\n`);
});

test('a symlinked settings file is written through the link and keeps its permissions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'switchyard-hook-'));
  const real = join(dir, 'dotfiles-settings.json');
  const link = join(dir, 'settings.json');
  await writeFile(real, '{}', { mode: 0o600 });
  await symlink(real, link);
  await writeClaudeSettings(link, withHook({}, PORT));
  assert.equal((await lstat(link)).isSymbolicLink(), true);
  assert.equal((await stat(real)).mode & 0o777, 0o600);
  assert.equal(isHookInstalled(JSON.parse(await readFile(real, 'utf8')), PORT), true);
});

test('a new settings file is created readable only by you', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'switchyard-hook-'));
  await writeClaudeSettings(join(dir, 'settings.json'), {});
  assert.equal((await stat(join(dir, 'settings.json'))).mode & 0o777, 0o600);
});

test('a settings file that is not valid JSON is never overwritten', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'switchyard-hook-'));
  const file = join(dir, 'settings.json');
  await writeFile(file, '{ broken');
  await assert.rejects(readClaudeSettings(file), /not valid JSON/);
});
