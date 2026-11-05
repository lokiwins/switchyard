import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createActionService, editorUrl } from '../src/actions.js';
import { assertSingleLine, createTerminal } from '../src/terminal.js';

const ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const iterm = { kind: 'terminal', label: 'iTerm', app: 'iTerm', appName: 'iTerm' };
const vscode = { kind: 'editor', label: 'VS Code', scheme: 'vscode', appName: 'Visual Studio Code' };
const chatgpt = { kind: 'app', label: 'ChatGPT', appName: 'ChatGPT' };

function setup({ host = iterm, tty = '/dev/ttys004', tabFound = true, alive = true, session = {}, state = {} } = {}) {
  const calls = [];
  const fullState = {
    liveSessions: [{ sessionId: ID, pid: 42, cwd: '/w/my repo', host, status: 'idle', needsYou: false, resumeCommand: `cd '/w/my repo' && claude --resume ${ID}`, ...session }],
    endedSessions: [{ sessionId: 'ended-session-1', resumeCommand: "cd '/w/old' && claude --resume ended-session-1" }],
    repos: [{ worktrees: [{ path: '/w/feat', agents: { live: [], last: null, recent: [{ sessionId: 'recent-session-1', resumeCommand: "cd /w/feat && claude --resume recent-session-1" }] } }, { path: '/w/gone', prunable: true, agents: { live: [] } }] }],
    ...state,
  };
  const terminal = {
    app: 'iTerm',
    focus: async (t) => { calls.push(['focus', t]); return tabFound; },
    open: async (command) => { calls.push(['open', command]); },
    type: async (t, text) => { calls.push(['type', t, text]); return tabFound; },
  };
  const actions = createActionService({
    stateService: { getState: async () => fullState },
    terminal,
    terminalFor: () => terminal,
    lookupTty: async () => tty,
    isAlive: () => alive,
    launcher: {
      openUrl: async (url) => calls.push(['url', url]),
      activateApp: async (app) => calls.push(['app', app]),
    },
    platform: 'darwin',
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
