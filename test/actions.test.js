import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createActionService, editorUrl } from '../src/actions.js';
import { assertSingleLine, createTerminal } from '../src/terminal.js';

const ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const iterm = { kind: 'terminal', label: 'iTerm', app: 'iTerm', appName: 'iTerm' };
const vscode = { kind: 'editor', label: 'VS Code', scheme: 'vscode', appName: 'Visual Studio Code' };
const inTmux = { kind: 'tmux', label: 'tmux', session: 'switchyard', window: '@4', windowName: 'my-repo-fix', pane: '%3' };
const chatgpt = { kind: 'app', label: 'ChatGPT', appName: 'ChatGPT' };

function setup({
  host = iterm, tty = '/dev/ttys004', tabFound = true, alive = true, session = {}, state = {}, clients = [], paneTty = '/dev/ttys004',
  useTmux = false, windows = [], folders = ['/w/old', '/w/feat', '/w/my repo'], screen = '',
} = {}) {
  const calls = [];
  const fullState = {
    liveSessions: [{ sessionId: ID, pid: 42, cwd: '/w/my repo', host, status: 'idle', needsYou: false, resumeCommand: `cd '/w/my repo' && claude --resume ${ID}`, ...session }],
    endedSessions: [{ sessionId: 'ended-session-1', cwd: '/w/old', resumeCommand: "cd '/w/old' && claude --resume ended-session-1" }],
    repos: [{ worktrees: [{ path: '/w/feat', agents: { live: [], last: null, recent: [{ sessionId: 'recent-session-1', resumeCommand: "cd /w/feat && claude --resume recent-session-1" }] } }, { path: '/w/gone', prunable: true, agents: { live: [] } }] }],
    ...state,
  };
  const terminal = {
    app: 'iTerm',
    focus: async (t) => { calls.push(['focus', t]); return tabFound; },
    open: async (command) => { calls.push(['open', command]); },
    type: async (t, text) => { calls.push(['type', t, text]); return tabFound; },
  };
  const tmux = {
    selectWindow: async (window) => { calls.push(['select-window', window]); },
    clientTtys: async (name) => { calls.push(['clients', name]); return clients; },
    sendLine: async (pane, text) => { calls.push(['tmux-type', pane, text]); },
    interrupt: async (pane) => { calls.push(['tmux-interrupt', pane]); },
    pressKey: async (pane, key) => { calls.push(['tmux-key', pane, key]); },
    // A function of the keys pressed so far, to show a screen changing.
    screenText: async () => (typeof screen === 'function' ? screen(calls.filter((c) => c[0] === 'tmux-key').map((c) => c[2])) : screen),
    attachCommand: (name) => `tmux attach-session -t =${name}`,
    listPanes: async () => new Map(paneTty ? [[paneTty, { session: 'switchyard', window: '@4', windowName: 'my-repo-fix', pane: '%3' }]] : []),
    hasWindow: async (session, name) => session === 'switchyard' && windows.includes(name),
    newWindow: async (options) => { calls.push(['new-window', options]); return { window: '@9', pane: '%9' }; },
    killWindow: async (window) => { calls.push(['kill-window', window]); },
  };
  const actions = createActionService({
    stateService: { getState: async () => fullState },
    terminal,
    tmux,
    terminalFor: () => terminal,
    lookupTty: async () => tty,
    isAlive: () => alive,
    launcher: {
      openUrl: async (url) => calls.push(['url', url]),
      activateApp: async (app) => calls.push(['app', app]),
    },
    platform: 'darwin',
    useTmux,
    folderExists: (path) => folders.includes(path),
    textFieldDelayMs: 0,
    textFieldWaitMs: 20,
  });
  return { actions, calls };
}

const rejectsWith = (promise, status) => assert.rejects(promise, (error) => error.status === status);

test('Jump selects the exact tab for sessions in a terminal app', async () => {
  const { actions, calls } = setup();
  assert.deepEqual(await actions.focusSession({ sessionId: ID }), { precision: 'tab', host: 'iTerm' });
  assert.deepEqual(calls, [['focus', '/dev/ttys004']]);
});

test('Jump explains when a running session has no tab it can find', async () => {
  await rejectsWith(setup({ tabFound: false }).actions.focusSession({ sessionId: ID }), 404);
});

test('Jump resumes the session in a new tab when its tab was closed', async () => {
  const { actions, calls } = setup({ tty: null });
  assert.deepEqual(await actions.focusSession({ sessionId: ID }), { precision: 'resumed', host: 'iTerm' });
  assert.deepEqual(calls, [['open', `cd '/w/my repo' && claude --resume ${ID}`]]);
});

test('Jump resumes in a terminal when an editor or app session has exited', async () => {
  const { actions, calls } = setup({ host: vscode, alive: false });
  assert.deepEqual(await actions.focusSession({ sessionId: ID }), { precision: 'resumed', host: 'iTerm' });
  assert.deepEqual(calls, [['open', `cd '/w/my repo' && claude --resume ${ID}`]]);
});

test('Jump resumes a session that ended after the page loaded', async () => {
  const { actions, calls } = setup();
  assert.deepEqual(await actions.focusSession({ sessionId: 'ended-session-1' }), { precision: 'resumed', host: 'iTerm' });
  assert.deepEqual(calls, [['open', "cd '/w/old' && claude --resume ended-session-1"]]);
});

test("Jump opens the folder's window for sessions in an editor", async () => {
  const { actions, calls } = setup({ host: vscode });
  assert.deepEqual(await actions.focusSession({ sessionId: ID }), { precision: 'window', host: 'VS Code' });
  assert.deepEqual(calls, [['url', 'vscode://file/w/my%20repo']]);
});

test('Jump brings other host apps to the front', async () => {
  const { actions, calls } = setup({ host: chatgpt });
  assert.deepEqual(await actions.focusSession({ sessionId: ID }), { precision: 'app', host: 'ChatGPT' });
  assert.deepEqual(calls, [['app', 'ChatGPT']]);
});

test('Jump refuses unknown hosts, unknown sessions and malformed ids', async () => {
  await rejectsWith(setup({ host: null }).actions.focusSession({ sessionId: ID }), 404);
  await rejectsWith(setup().actions.focusSession({ sessionId: 'ffffffff-0000' }), 404);
  await rejectsWith(setup().actions.focusSession({ sessionId: '$(rm -rf ~)' }), 400);
});

test('Resume types the server-built resume command, and refuses live sessions', async () => {
  const { actions, calls } = setup();
  await actions.resumeSession({ sessionId: 'ended-session-1' });
  assert.deepEqual(calls, [['open', "cd '/w/old' && claude --resume ended-session-1"]]);
  await rejectsWith(actions.resumeSession({ sessionId: ID }), 409);
  await rejectsWith(actions.resumeSession({ sessionId: 'not-a-known-session' }), 404);
});

test('Open terminal only accepts discovered, present worktrees', async () => {
  const { actions, calls } = setup();
  await actions.openWorktree({ path: '/w/feat' });
  assert.deepEqual(calls, [['open', 'cd /w/feat']]);
  await rejectsWith(actions.openWorktree({ path: '/etc' }), 404);
  await rejectsWith(actions.openWorktree({ path: '/w/gone' }), 404);
  await rejectsWith(actions.openWorktree({ path: 42 }), 400);
});

test('Open can start a new Claude session in a worktree', async () => {
  const { actions, calls } = setup();
  await actions.openWorktree({ path: '/w/feat', launch: 'claude' });
  assert.deepEqual(calls, [['open', 'cd /w/feat && claude']]);
  await rejectsWith(actions.openWorktree({ path: '/w/feat', launch: 'rm -rf ~' }), 400);
});

test("Open resumes a chosen session only if it is one of that worktree's sessions", async () => {
  const { actions, calls } = setup();
  await actions.openWorktree({ path: '/w/feat', sessionId: 'recent-session-1' });
  assert.deepEqual(calls, [['open', 'cd /w/feat && claude --resume recent-session-1']]);
  await rejectsWith(actions.openWorktree({ path: '/w/feat', sessionId: 'ended-session-1' }), 404);
  await rejectsWith(actions.openWorktree({ path: '/w/feat', sessionId: '$(boom)' }), 400);
});

test('a reply is typed into the session’s own tab and submitted', async () => {
  const { actions, calls } = setup();
  assert.deepEqual(await actions.replyToSession({ sessionId: ID, text: '  Yes, go ahead with plan B  ' }), { queued: false });
  assert.deepEqual(calls, [['type', '/dev/ttys004', 'Yes, go ahead with plan B']]);
});

test('a reply to a working session is queued, as Claude Code reads it after the current step', async () => {
  const { actions } = setup({ session: { status: 'busy' } });
  assert.deepEqual(await actions.replyToSession({ sessionId: ID, text: 'also run the tests' }), { queued: true });
});

test('a reply is refused while a question or permission prompt is open, since the text would answer it', async () => {
  const { actions, calls } = setup({ session: { needsYou: true } });
  await rejectsWith(actions.replyToSession({ sessionId: ID, text: '1' }), 409);
  assert.deepEqual(calls, []);
});

test('a reply must be one line of plain text', async () => {
  const { actions, calls } = setup();
  await rejectsWith(actions.replyToSession({ sessionId: ID, text: 'first\nsecond' }), 400);
  await rejectsWith(actions.replyToSession({ sessionId: ID, text: 'stop\u001b' }), 400);
  await rejectsWith(actions.replyToSession({ sessionId: ID, text: 'csi\u009b2J' }), 400);
  await rejectsWith(actions.replyToSession({ sessionId: ID, text: 'line\u2028break' }), 400);
  await rejectsWith(actions.replyToSession({ sessionId: ID, text: '   ' }), 400);
  await rejectsWith(actions.replyToSession({ sessionId: ID, text: 'x'.repeat(2001) }), 400);
  await rejectsWith(actions.replyToSession({ sessionId: ID, text: 42 }), 400);
  assert.deepEqual(calls, []);
});

test('a reply needs a running iTerm session whose tab can be found', async () => {
  await rejectsWith(setup({ host: vscode }).actions.replyToSession({ sessionId: ID, text: 'hi' }), 501);
  await rejectsWith(setup({ host: { ...iterm, label: 'Terminal', app: 'Terminal', appName: 'Terminal' } }).actions.replyToSession({ sessionId: ID, text: 'hi' }), 501);
  await rejectsWith(setup({ alive: false }).actions.replyToSession({ sessionId: ID, text: 'hi' }), 409);
  await rejectsWith(setup({ tty: null }).actions.replyToSession({ sessionId: ID, text: 'hi' }), 409);
  await rejectsWith(setup({ tabFound: false }).actions.replyToSession({ sessionId: ID, text: 'hi' }), 404);
  await rejectsWith(setup().actions.replyToSession({ sessionId: 'ended-session-1', text: 'hi' }), 404);
});

test('typed commands must be a single line', () => {
  assert.equal(assertSingleLine('cd /w && claude --resume x'), 'cd /w && claude --resume x');
  assert.throws(() => assertSingleLine('cd /w\nrm -rf ~'), (error) => error.status === 400);
});

test('terminal actions report unsupported platforms and apps', async () => {
  await assert.rejects(createTerminal({ app: 'iTerm', platform: 'linux' }).focus('/dev/tty1'), (e) => e.status === 501);
  assert.equal(createTerminal({ app: 'Konsole', platform: 'darwin' }).app, null);
  assert.equal(createTerminal({ app: 'Terminal', platform: 'darwin' }).app, 'Terminal');
});

test('editorUrl encodes the folder path', () => {
  assert.equal(editorUrl('cursor', '/w/a b#c?d'), 'cursor://file/w/a%20b%23c%3Fd');
});

test('Jump shows the task\'s tmux window and selects the tab its session is attached in', async () => {
  const { actions, calls } = setup({ host: inTmux, clients: ['/dev/ttys002'] });
  assert.deepEqual(await actions.focusSession({ sessionId: ID }), { precision: 'tab', host: 'tmux' });
  assert.deepEqual(calls, [['select-window', '@4'], ['clients', 'switchyard'], ['focus', '/dev/ttys002']]);
});

test('Jump attaches a detached tmux session in a new tab, showing the task\'s window', async () => {
  const { actions, calls } = setup({ host: inTmux });
  assert.deepEqual(await actions.focusSession({ sessionId: ID }), { precision: 'attached', host: 'iTerm' });
  assert.deepEqual(calls, [['select-window', '@4'], ['clients', 'switchyard'], ['open', 'tmux attach-session -t =switchyard']]);
});

test('Jump attaches again when the attached terminal is not one it can select', async () => {
  const { actions, calls } = setup({ host: inTmux, clients: ['/dev/ttys002'], tabFound: false });
  assert.equal((await actions.focusSession({ sessionId: ID })).precision, 'attached');
  assert.deepEqual(calls.at(-1), ['open', 'tmux attach-session -t =switchyard']);
});

test('Reply types into the tmux pane, from any terminal app', async () => {
  const { actions, calls } = setup({ host: inTmux, session: { status: 'busy' } });
  assert.deepEqual(await actions.replyToSession({ sessionId: ID, text: 'keep going' }), { queued: true });
  assert.deepEqual(calls, [['tmux-type', '%3', 'keep going']]);
});

test('Reply to a tmux session still refuses while a prompt is open', async () => {
  await rejectsWith(setup({ host: inTmux, session: { needsYou: true } }).actions.replyToSession({ sessionId: ID, text: 'y' }), 409);
});

test('Reply and Stop refuse when Claude no longer runs in that tmux pane', async () => {
  await rejectsWith(setup({ host: inTmux, alive: false }).actions.replyToSession({ sessionId: ID, text: 'hi' }), 409);
  await rejectsWith(setup({ host: inTmux, paneTty: null }).actions.replyToSession({ sessionId: ID, text: 'hi' }), 409);
  await rejectsWith(setup({ host: inTmux, alive: false }).actions.interruptSession({ sessionId: ID }), 409);
});

test('Interrupt presses Escape in a tmux session', async () => {
  const { actions, calls } = setup({ host: inTmux, session: { status: 'busy' } });
  assert.deepEqual(await actions.interruptSession({ sessionId: ID }), { interrupted: true });
  assert.deepEqual(calls, [['tmux-interrupt', '%3']]);
});

test('Interrupt only works for sessions switchyard can reach through tmux', async () => {
  await rejectsWith(setup().actions.interruptSession({ sessionId: ID }), 501);
  await rejectsWith(setup({ host: inTmux }).actions.interruptSession({ sessionId: 'bbbbbbbb-0000' }), 404);
});

test('with tmux, Resume opens the session in a window of the switchyard session, named after its folder', async () => {
  const { actions, calls } = setup({ useTmux: true });
  assert.deepEqual(await actions.resumeSession({ sessionId: 'ended-session-1' }), { opened: true, host: 'tmux', window: 'switchyard:old' });
  assert.deepEqual(calls, [
    ['new-window', { session: 'switchyard', name: 'old', cwd: '/w/old' }],
    ['tmux-type', '%9', 'claude --resume ended-session-1'],
  ]);
});

test('with tmux, a resumed window takes the next free name', async () => {
  const { actions, calls } = setup({ useTmux: true, windows: ['old', 'old-2'] });
  assert.equal((await actions.resumeSession({ sessionId: 'ended-session-1' })).window, 'switchyard:old-3');
  assert.equal(calls[0][1].name, 'old-3');
});

test('with tmux, Jump on a closed session and Open\'s resume both open a tmux window', async () => {
  const jump = setup({ useTmux: true, alive: false });
  assert.deepEqual(await jump.actions.focusSession({ sessionId: ID }), { precision: 'resumed', host: 'tmux', window: 'switchyard:my-repo' });
  assert.deepEqual(jump.calls.at(-1), ['tmux-type', '%9', `claude --resume ${ID}`]);
  const open = setup({ useTmux: true });
  assert.equal((await open.actions.openWorktree({ path: '/w/feat', sessionId: 'recent-session-1' })).window, 'switchyard:feat');
  assert.ok(!open.calls.some(([kind]) => kind === 'open'));
});

test('with tmux, a session whose folder is gone is not resumed somewhere else', async () => {
  const { actions, calls } = setup({ useTmux: true, folders: [] });
  await rejectsWith(actions.resumeSession({ sessionId: 'ended-session-1' }), 409);
  assert.equal(calls.length, 0);
});

test('with tmux, Open still starts a shell or a new session in a terminal tab', async () => {
  const { actions, calls } = setup({ useTmux: true });
  await actions.openWorktree({ path: '/w/feat', launch: 'claude' });
  assert.deepEqual(calls, [['open', 'cd /w/feat && claude']]);
});

const RULE = '─'.repeat(80);
const QUESTION = [RULE, 'Which color?', '❯ 1. Red', '  2. Blue', '  3. Type something.', 'Enter to select · Esc to cancel'].join('\n');
const TABBED = [RULE, '←  ☐ Fruits  ✔ Submit  →', 'Which fruits?', '❯ 1. [ ] Apple', '  2. [✔] Pear', 'Enter to select · Esc to cancel'].join('\n');
const waiting = { host: inTmux, session: { needsYou: true }, screen: QUESTION };
const answer = (fields) => ({ sessionId: ID, question: 'Which color?', ...fields });

test('Answer presses the chosen option\'s number in the tmux pane', async () => {
  const { actions, calls } = setup(waiting);
  assert.deepEqual(await actions.answerPrompt(answer({ number: 2, label: 'Blue' })), { answered: 'Blue' });
  assert.deepEqual(calls, [['tmux-key', '%3', '2']]);
});

test('Answer refuses, pressing nothing, when the screen no longer shows that question and option', async () => {
  for (const fields of [{ number: 2, label: 'Green' }, { number: 1, label: 'Blue' }, { question: 'Which shape?', number: 2, label: 'Blue' }]) {
    const { actions, calls } = setup(waiting);
    await rejectsWith(actions.answerPrompt(answer(fields)), 409);
    assert.deepEqual(calls, []);
  }
  await rejectsWith(setup({ ...waiting, screen: '❯ ' }).actions.answerPrompt(answer({ number: 1, label: 'Red' })), 409);
});

// The question once 3 is pressed: its text field is open, with the cursor on it.
const fieldOpen = (keys) => (keys.includes('3') ? QUESTION.replace('❯ 1. Red', '  1. Red').replace('  3. Type something.', '❯ 3. Type something.') : QUESTION);

test('Answer types your own answer once the option\'s text field is open', async () => {
  const { actions, calls } = setup({ ...waiting, screen: fieldOpen });
  assert.deepEqual(await actions.answerPrompt(answer({ number: 3, label: 'Type something.', text: ' purple ' })), { answered: 'purple' });
  assert.deepEqual(calls, [['tmux-key', '%3', '3'], ['tmux-type', '%3', 'purple']]);
});

test('Answer types nothing if the text field never opens, so the text can\'t answer the dialog instead', async () => {
  const { actions, calls } = setup(waiting);
  await rejectsWith(actions.answerPrompt(answer({ number: 3, label: 'Type something.', text: '1' })), 409);
  assert.deepEqual(calls, [['tmux-key', '%3', '3']]);
});

test('Answer refuses a second answer to the same session while one is being sent', async () => {
  const { actions, calls } = setup({ ...waiting, screen: fieldOpen });
  const first = actions.answerPrompt(answer({ number: 3, label: 'Type something.', text: 'teal' }));
  await rejectsWith(actions.answerPrompt(answer({ number: 2, label: 'Blue' })), 409);
  await first;
  assert.deepEqual(calls.map((c) => c[2]), ['3', 'teal']);
});

test('Answer refuses text for an option without a text field, and text that would act as keys', async () => {
  await rejectsWith(setup(waiting).actions.answerPrompt(answer({ number: 2, label: 'Blue', text: 'hi' })), 400);
  await rejectsWith(setup(waiting).actions.answerPrompt(answer({ number: 3, label: 'Type something.', text: 'a\nb' })), 400);
  await rejectsWith(setup(waiting).actions.answerPrompt(answer({ number: 3, label: 'Type something.' })), 400);
});

test('Answer takes an option number from 1 to 9 only', async () => {
  for (const number of [0, 10, '2', 1.5, undefined]) {
    await rejectsWith(setup(waiting).actions.answerPrompt(answer({ number, label: 'Blue' })), 400);
  }
});

test('Answer goes on to the next tab of a question with tabs, and only then', async () => {
  const { actions, calls } = setup({ ...waiting, screen: TABBED });
  assert.deepEqual(await actions.answerPrompt({ sessionId: ID, question: 'Which fruits?', next: true }), { answered: 'next' });
  assert.deepEqual(calls, [['tmux-key', '%3', 'Right']]);
  await rejectsWith(setup(waiting).actions.answerPrompt(answer({ next: true })), 409);
});

test('Answer checks what was asked for before looking for the session', async () => {
  await rejectsWith(setup(waiting).actions.answerPrompt({ sessionId: 'bbbbbbbb-0000', number: 0 }), 400);
});

test('Answer only works for a tmux session that is waiting on you', async () => {
  await rejectsWith(setup({ ...waiting, session: { needsYou: false } }).actions.answerPrompt(answer({ number: 1, label: 'Red' })), 409);
  await rejectsWith(setup({ ...waiting, host: iterm }).actions.answerPrompt(answer({ number: 1, label: 'Red' })), 501);
  await rejectsWith(setup({ ...waiting, alive: false }).actions.answerPrompt(answer({ number: 1, label: 'Red' })), 409);
});
