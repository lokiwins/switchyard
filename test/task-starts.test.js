import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EXITED_KEEP_MS, GIVE_UP_MS, NOT_STARTED_MS, backAtPrompt, createTaskStarts, parseTrustPrompt,
} from '../src/task-starts.js';

// As Claude Code draws it in a new folder (captured from a real run, folder shortened).
const TRUST_SCREEN = `[user]:# claude 'Reply OK and do nothing else'
────────────────────────────────────────────────────────────────────────────────
 Accessing workspace:

 /code/trial-reply-ok

 Quick safety check: Is this a project you created or one you trust? (Like your
 own code, a well-known open source project, or work from your team). If not,
 take a moment to review what's in this folder first.

 Claude Code'll be able to read, edit, and execute files here.

 Security guide

 ❯ No, exit
   Yes, I trust this folder

 Enter to confirm · Esc to cancel
`;

// Older versions numbered the choices.
const NUMBERED_TRUST_SCREEN = `────────────────────────────────────────
 Do you trust the files in this folder?

 /code/trial

 ❯ 1. Yes, proceed
   2. No, exit

 Enter to confirm · Esc to exit
`;

test('parseTrustPrompt reads the choices and which one is highlighted', () => {
  assert.deepEqual(parseTrustPrompt(TRUST_SCREEN).options, [
    { label: 'No, exit', selected: true },
    { label: 'Yes, I trust this folder', selected: false },
  ]);
});

test('parseTrustPrompt reads the numbered form too', () => {
  assert.deepEqual(parseTrustPrompt(NUMBERED_TRUST_SCREEN).options, [
    { label: 'Yes, proceed', selected: true },
    { label: 'No, exit', selected: false },
  ]);
});

test('parseTrustPrompt is null for other dialogs and plain screens', () => {
  const permission = `────────────────\n Edit file?\n ❯ 1. Yes\n   2. No\n Esc to cancel\n`;
  assert.equal(parseTrustPrompt(permission), null);
  assert.equal(parseTrustPrompt('$ ls\nREADME.md\n$ '), null);
  assert.equal(parseTrustPrompt(''), null);
});

test('parseTrustPrompt is not fooled by "trust" in a folder name', () => {
  const permission = ` Edit file?\n\n /code/trust-fund/app.js\n\n ❯ Yes\n   No\n\n Enter to confirm · Esc to cancel\n`;
  assert.equal(parseTrustPrompt(permission), null);
});

/** A fake tmux pane: what's running in it and what it shows, plus the keys pressed. */
function fakePane({ command = 'bash', screen = '' } = {}) {
  const pane = { command, screen, keys: [] };
  const tmux = {
    paneCommand: async () => pane.command,
    screenText: async () => pane.screen,
    pressKey: async (id, key) => { pane.keys.push(key); },
    confirm: async () => { pane.keys.push('Enter'); },
  };
  return { pane, tmux };
}

function setup(paneOptions) {
  const { pane, tmux } = fakePane(paneOptions);
  let now = 1_000_000;
  let changes = 0;
  const timers = { setInterval: () => 'timer', clearInterval: () => {} };
  const starts = createTaskStarts({ tmux, onChange: () => { changes += 1; }, now: () => now, timers });
  starts.track({ path: '/code/trial-x', place: 'switchyard:trial-x', pane: '%3' });
  return {
    pane, starts, advance: (ms) => { now += ms; }, changes: () => changes, only: () => starts.list([])[0],
  };
}

test('a started task is starting until it says otherwise', async () => {
  const { starts, only } = setup({ command: 'claude' });
  await starts.tick();
  assert.deepEqual(only(), { path: '/code/trial-x', place: 'switchyard:trial-x', state: 'starting', trust: null, detail: null });
});

test('the trust question shows, with its choices, and changes are announced', async () => {
  const { starts, pane, only, changes } = setup({ command: 'claude', screen: TRUST_SCREEN });
  await starts.tick();
  assert.equal(only().state, 'asking-trust');
  assert.deepEqual(only().trust.options.map((o) => o.label), ['No, exit', 'Yes, I trust this folder']);
  assert.equal(changes(), 1);
  await starts.tick();
  assert.equal(changes(), 1, 'the same screen again is not a change');
  pane.screen = '';
  await starts.tick();
  assert.equal(only().state, 'starting');
  assert.equal(changes(), 2);
});

test('trust moves to the Yes choice from wherever the highlight is, then confirms', async () => {
  const { starts, pane, only } = setup({ command: 'claude', screen: TRUST_SCREEN });
  await starts.tick();
  await starts.trust({ path: '/code/trial-x', trust: true });
  assert.deepEqual(pane.keys, ['Down', 'Enter']);
  assert.equal(only().state, 'starting');
});

test('not trusting picks the No choice', async () => {
  const { starts, pane } = setup({ command: 'claude', screen: NUMBERED_TRUST_SCREEN });
  await starts.tick();
  await starts.trust({ path: '/code/trial-x', trust: false });
  assert.deepEqual(pane.keys, ['Down', 'Enter']);
});

test('trust only answers a task switchyard started, while the question is on screen', async () => {
  const { starts, pane } = setup({ command: 'claude', screen: 'Welcome to Claude Code' });
  await assert.rejects(starts.trust({ path: '/elsewhere', trust: true }), (error) => error.status === 404);
  await assert.rejects(starts.trust({ path: '/code/trial-x', trust: true }), (error) => error.status === 409);
  await assert.rejects(starts.trust({ path: '/code/trial-x', trust: 'yes' }), (error) => error.status === 400);
  assert.deepEqual(pane.keys, []);
});

test('when claude quits, the task has exited', async () => {
  const { starts, pane, only, changes } = setup({ command: 'claude', screen: TRUST_SCREEN });
  await starts.tick();
  pane.command = 'bash';
  pane.screen = "[user]:# claude 'Reply OK'\n[user]:# \n\n";
  await starts.tick();
  assert.equal(only().state, 'exited');
  assert.equal(only().detail, null, 'the command we typed is not news');
  assert.equal(changes(), 2);
});

test('a claude that never ran counts as exited after a grace period, with what the shell said', async () => {
  const { starts, pane, only, advance } = setup({ command: 'bash', screen: "$ claude 'Fix it'\nbash: claude: command not found\n$ " });
  await starts.tick();
  assert.equal(only().state, 'starting', 'it may just not have started yet');
  advance(NOT_STARTED_MS);
  await starts.tick();
  assert.equal(only().state, 'exited');
  assert.equal(only().detail, 'bash: claude: command not found');
  assert.equal(pane.keys.length, 0);
});

test('a closed window counts as exited', async () => {
  const { starts, pane, only } = setup({ command: 'claude' });
  await starts.tick();
  pane.command = null;
  await starts.tick();
  assert.equal(only().state, 'exited');
  assert.equal(only().detail, 'The tmux window was closed');
});

test('a task is dropped once its session shows up, and is not watched after', async () => {
  const { starts, pane } = setup({ command: 'claude' });
  assert.deepEqual(starts.list([{ cwd: '/code/trial-x/' }]), []);
  pane.command = 'bash';
  await starts.tick();
  assert.deepEqual(starts.list([]), []);
});

test('exited tasks are kept a while for the page, and nothing is watched forever', async () => {
  const exited = setup({ command: null });
  await exited.starts.tick();
  exited.advance(EXITED_KEEP_MS);
  assert.deepEqual(exited.starts.list([]), []);

  const slow = setup({ command: 'claude' });
  slow.advance(GIVE_UP_MS);
  assert.deepEqual(slow.starts.list([]), []);
});

test('the watcher runs only while there is something to watch', async () => {
  const calls = [];
  const timers = { setInterval: (fn, ms) => { calls.push(['start', ms]); return 't1'; }, clearInterval: (id) => calls.push(['stop', id]) };
  const { tmux } = fakePane({ command: null });
  const starts = createTaskStarts({ tmux, onChange: () => {}, now: () => 0, timers });
  starts.track({ path: '/a', place: 's:a', pane: '%1' });
  starts.track({ path: '/b', place: 's:b', pane: '%2' });
  assert.deepEqual(calls, [['start', 1000]]);
  starts.list([{ cwd: '/a' }, { cwd: '/b' }]);
  assert.deepEqual(calls, [['start', 1000], ['stop', 't1']]);
});

test('a claude that failed outright is noticed on the second look, without the grace period', async () => {
  const screen = "[user]:# claude 'Fix it'\nbash: claude: command not found\n[user]:# \n";
  const { starts, only } = setup({ command: 'bash', screen });
  await starts.tick();
  assert.equal(only().state, 'starting', 'one look could catch the shell before claude takes over');
  await starts.tick();
  assert.equal(only().state, 'exited');
  assert.equal(only().detail, 'bash: claude: command not found');
});

test('a long command still being typed or launched is not taken for an exit', async () => {
  // The typed line wraps, so text follows it, but nothing has run yet: the screen ends in the command itself.
  const screen = "[user]:# claude 'A long task that wraps onto\n a second line of the terminal'\n";
  const { starts, only } = setup({ command: 'bash', screen });
  await starts.tick();
  await starts.tick();
  await starts.tick();
  assert.equal(only().state, 'starting');
});

test('backAtPrompt: a new prompt after the typed command, whatever the prompt looks like', () => {
  assert.equal(backAtPrompt("$ claude 'Fix it'\nzsh: command not found: claude\n$ "), true);
  assert.equal(backAtPrompt("~/code/x main ❯ claude 'Fix it'\nclaude: oops\n~/code/x main ❯"), true);
  // A prompt with a timestamp in it ends the same way, though its text changes.
  assert.equal(backAtPrompt("[17:18:39]:[me]:# claude 'Fix it'\nbash: claude: command not found\n[17:18:41]:[me]:# "), true);
  assert.equal(backAtPrompt("$ claude 'Fix it'"), false, 'just typed');
  assert.equal(backAtPrompt("$ claude 'Fix it'\n Loading…"), false, 'claude drawing, not a prompt');
  assert.equal(backAtPrompt('$ ls\n$ '), false, 'not our command');
});

test('what the shell said is told apart from a prompt of several lines', async () => {
  // A prompt on two lines, with a time in it: only the line between the command and the new prompt is the shell's.
  const screen = [
    '~/code/x:[main]:', "[17:18:39]:[me]:# claude 'Fix it'", 'bash: claude: command not found', '~/code/x:[main]:', '[17:18:41]:[me]:# ',
  ].join('\n');
  const { starts, only } = setup({ command: 'bash', screen });
  await starts.tick();
  await starts.tick();
  assert.equal(only().detail, 'bash: claude: command not found');
});

test('a long command wrapped onto more lines is not taken for what the shell said', async () => {
  const screen = "$ claude 'A long task that wraps onto\n a second line'\nzsh: command not found: claude\n$ ";
  const { starts, only } = setup({ command: 'zsh', screen });
  await starts.tick();
  await starts.tick();
  assert.equal(only().detail, 'zsh: command not found: claude');
});

test('nothing is reported when claude ran and quit: what is left on screen is its own', async () => {
  const { starts, pane, only } = setup({ command: 'claude', screen: TRUST_SCREEN });
  await starts.tick();
  pane.command = 'bash';
  pane.screen = `$ claude 'Fix it'\n${TRUST_SCREEN}\n$ `;
  await starts.tick();
  assert.equal(only().detail, null);
});

test('a command typed before the shell drew its prompt shows twice; the prompt line is the one that counts', async () => {
  // As captured from a fresh tmux window: the early keystrokes echo bare, then the shell shows its prompt and runs them.
  const screen = [
    "claude 'Add gift cards to checkout'",
    "host:storefront-gift-cards me$ claude 'Add gift cards to checkout'",
    '-bash: claude: command not found',
    'host:storefront-gift-cards me$ ',
  ].join('\n');
  assert.equal(backAtPrompt(screen), true);
  const { starts, only } = setup({ command: 'bash', screen });
  await starts.tick();
  await starts.tick();
  assert.equal(only().state, 'exited');
  assert.equal(only().detail, '-bash: claude: command not found');
});
