import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTmux, findOnPath, parsePanes, windowNameFor } from '../src/tmux.js';

function fakeExec(responses = {}) {
  const calls = [];
  const envs = [];
  const exec = async (cmd, args, options) => {
    calls.push([cmd, ...args]);
    if (options?.env) envs.push([cmd, options.env.PATH]);
    const response = responses[args[0]];
    if (response instanceof Error) throw response;
    const value = typeof response === 'function' ? response(args) : response ?? '';
    if (value instanceof Error) throw value;
    return value;
  };
  return { exec, calls, envs };
}

// newWindow runs tmux by its full path, since it runs with a new tab's PATH.
const TMUX = '/opt/homebrew/bin/tmux';
const tmuxWith = (exec) => createTmux({ exec, locate: () => TMUX });

const rejectsWith = (promise, status) => assert.rejects(promise, (error) => error.status === status);

test('parsePanes maps each pane tty to its session, window and pane', () => {
  const panes = parsePanes('/dev/ttys010\tswitchyard\t@4\tmy-repo-fix\t%3\n/dev/ttys011\tscratch\t@5\tzsh\t%4\n\n');
  assert.deepEqual(panes.get('/dev/ttys010'), { session: 'switchyard', window: '@4', windowName: 'my-repo-fix', pane: '%3' });
  assert.equal(panes.size, 2);
});

test('windowNameFor keeps names that read as plain names in tmux targets', () => {
  assert.equal(windowNameFor('my-repo-fix-login'), 'my-repo-fix-login');
  assert.equal(windowNameFor('my.repo:fix login'), 'my-repo-fix-login');
  assert.equal(windowNameFor('--a//b--'), 'a-b');
  assert.equal(windowNameFor('x'.repeat(100)).length, 60);
});

test('listPanes reads every pane on the server', async () => {
  const { exec, calls } = fakeExec({ 'list-panes': '/dev/ttys010\tswitchyard\t@4\tmy-repo-fix\t%3\n' });
  const panes = await createTmux({ exec }).listPanes();
  assert.equal(panes.get('/dev/ttys010').pane, '%3');
  assert.deepEqual(calls[0], ['tmux', 'list-panes', '-a', '-F', '#{pane_tty}\t#{session_name}\t#{window_id}\t#{window_name}\t#{pane_id}']);
});

test('listPanes is empty when tmux is missing or has no server', async () => {
  const { exec } = fakeExec({ 'list-panes': new Error('no server running on /tmp/tmux-501/default') });
  assert.equal((await createTmux({ exec }).listPanes()).size, 0);
});

const NEW_WINDOW = { session: 'switchyard', name: 'my-repo-fix', cwd: '/w/my repo-fix' };
const NEW_WINDOW_ARGS = ['-n', 'my-repo-fix', '-c', '/w/my repo-fix', '-P', '-F', '#{window_id}\t#{pane_id}'];

test('newWindow adds a background window to the running session', async () => {
  const { exec, calls } = fakeExec({ 'new-window': '@4\t%7\n' });
  assert.deepEqual(await tmuxWith(exec).newWindow(NEW_WINDOW), { window: '@4', pane: '%7' });
  assert.deepEqual(calls, [[TMUX, 'new-window', '-d', '-t', '=switchyard:', ...NEW_WINDOW_ARGS]]);
});

test('newWindow runs tmux with a new tab\'s PATH, which tmux passes on to the window', async () => {
  const { exec, envs } = fakeExec({ 'new-window': '@4\t%7\n' });
  await tmuxWith(exec).newWindow(NEW_WINDOW);
  assert.deepEqual(envs, [[TMUX, '/usr/bin:/bin:/usr/sbin:/sbin']]);
});

test('findOnPath finds a command\'s full path, or keeps the bare name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'switchyard-path-'));
  writeFileSync(join(dir, 'fake-tmux'), '#!/bin/sh\n', { mode: 0o755 });
  assert.equal(findOnPath('fake-tmux', `/nonexistent:${dir}`), join(dir, 'fake-tmux'));
  assert.equal(findOnPath('fake-tmux', '/nonexistent'), 'fake-tmux');
});

test('newWindow starts the session, detached, when it is not running', async () => {
  const { exec, calls } = fakeExec({ 'new-window': new Error("can't find session: switchyard"), 'new-session': '@1\t%2\n' });
  assert.deepEqual(await tmuxWith(exec).newWindow(NEW_WINDOW), { window: '@1', pane: '%2' });
  assert.deepEqual(calls[1], [TMUX, 'new-session', '-d', '-s', 'switchyard', ...NEW_WINDOW_ARGS]);
});

test('newWindow adds to the session when another task started it first', async () => {
  let tries = 0;
  const { exec } = fakeExec({
    'new-window': () => (++tries === 1 ? new Error("can't find session: switchyard") : '@6\t%9\n'),
    'new-session': new Error('duplicate session: switchyard'),
  });
  assert.deepEqual(await tmuxWith(exec).newWindow(NEW_WINDOW), { window: '@6', pane: '%9' });
});

test('newWindow explains when tmux is not installed instead of retrying', async () => {
  const { exec, calls } = fakeExec({ 'new-window': new Error('spawn tmux ENOENT') });
  await rejectsWith(tmuxWith(exec).newWindow(NEW_WINDOW), 501);
  assert.equal(calls.length, 1);
});

test('hasWindow looks for the name among the session\'s windows', async () => {
  const { exec, calls } = fakeExec({ 'list-windows': 'my-repo-a\nmy-repo-b\n' });
  const tmux = createTmux({ exec });
  assert.equal(await tmux.hasWindow('switchyard', 'my-repo-b'), true);
  assert.equal(await tmux.hasWindow('switchyard', 'my-repo'), false);
  assert.deepEqual(calls[0], ['tmux', 'list-windows', '-t', '=switchyard', '-F', '#{window_name}']);
});

test('hasWindow is false when the session is not running', async () => {
  const { exec } = fakeExec({ 'list-windows': new Error("can't find session: switchyard") });
  assert.equal(await createTmux({ exec }).hasWindow('switchyard', 'x'), false);
});

test('selectWindow makes a window the one its session shows', async () => {
  const { exec, calls } = fakeExec();
  await createTmux({ exec }).selectWindow('@4');
  assert.deepEqual(calls, [['tmux', 'select-window', '-t', '@4']]);
});

test('sendLine types the text literally, then presses Enter', async () => {
  const { exec, calls } = fakeExec();
  await createTmux({ exec }).sendLine('%3', '-rf C-c Enter');
  assert.deepEqual(calls, [
    ['tmux', 'send-keys', '-t', '%3', '-l', '--', '-rf C-c Enter'],
    ['tmux', 'send-keys', '-t', '%3', 'Enter'],
  ]);
});

test('sendLine refuses text that would act as extra keys', async () => {
  const { exec, calls } = fakeExec();
  await rejectsWith(createTmux({ exec }).sendLine('%3', 'one\ntwo'), 400);
  assert.equal(calls.length, 0);
});

test('killWindow closes a window by id', async () => {
  const { exec, calls } = fakeExec();
  await createTmux({ exec }).killWindow('@4');
  assert.deepEqual(calls, [['tmux', 'kill-window', '-t', '@4']]);
});

test('interrupt presses Escape in the pane', async () => {
  const { exec, calls } = fakeExec();
  await createTmux({ exec }).interrupt('%3');
  assert.deepEqual(calls, [['tmux', 'send-keys', '-t', '%3', 'Escape']]);
});

test('clientTtys lists the terminals attached to a session', async () => {
  const { exec, calls } = fakeExec({ 'list-clients': '/dev/ttys002\n' });
  assert.deepEqual(await createTmux({ exec }).clientTtys('my-repo-fix'), ['/dev/ttys002']);
  assert.deepEqual(calls[0], ['tmux', 'list-clients', '-t', '=my-repo-fix', '-F', '#{client_tty}']);
});

test('commands explain when tmux is not installed', async () => {
  const { exec } = fakeExec({ 'send-keys': new Error('spawn tmux ENOENT') });
  await rejectsWith(createTmux({ exec }).interrupt('%3'), 501);
});

test('other tmux failures are reported as such', async () => {
  const { exec } = fakeExec({ 'send-keys': new Error("can't find pane: %9") });
  await rejectsWith(createTmux({ exec }).interrupt('%9'), 502);
});

test('attachCommand addresses the session by exact name, quoted so zsh doesn\'t expand "=name"', () => {
  const tmux = createTmux({ exec: async () => '' });
  assert.equal(tmux.attachCommand('my-repo-fix'), "tmux attach-session -t '=my-repo-fix'");
  assert.equal(tmux.attachCommand("a'b $(x)"), "tmux attach-session -t '=a'\\''b $(x)'");
});

test('isInstalled reports whether tmux runs', async () => {
  assert.equal(await createTmux({ exec: async () => 'tmux 3.5a' }).isInstalled(), true);
  assert.equal(await createTmux({ exec: async () => { throw new Error('spawn tmux ENOENT'); } }).isInstalled(), false);
});
