import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createActionService, editorUrl } from '../src/actions.js';
import { assertSingleLine, createTerminal } from '../src/terminal.js';

const ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const iterm = { kind: 'terminal', label: 'iTerm', app: 'iTerm', appName: 'iTerm' };
const vscode = { kind: 'editor', label: 'VS Code', scheme: 'vscode', appName: 'Visual Studio Code' };
const chatgpt = { kind: 'app', label: 'ChatGPT', appName: 'ChatGPT' };

function setup({ host = iterm, tty = '/dev/ttys004', tabFound = true, state = {} } = {}) {
  const calls = [];
  const fullState = {
    liveSessions: [{ sessionId: ID, pid: 42, cwd: '/w/my repo', host }],
    endedSessions: [{ sessionId: 'ended-session-1', resumeCommand: "cd '/w/old' && claude --resume ended-session-1" }],
    repos: [{ worktrees: [{ path: '/w/feat', agents: { live: [], last: null, recent: [{ sessionId: 'recent-session-1', resumeCommand: "cd /w/feat && claude --resume recent-session-1" }] } }, { path: '/w/gone', prunable: true, agents: { live: [] } }] }],
    ...state,
  };
  const terminal = {
    app: 'iTerm',
    focus: async (t) => { calls.push(['focus', t]); return tabFound; },
    open: async (command) => { calls.push(['open', command]); },
  };
  const actions = createActionService({
    stateService: { getState: async () => fullState },
    terminal,
    terminalFor: () => terminal,
    lookupTty: async () => tty,
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

test('Jump explains when the tab cannot be found or the session has no terminal', async () => {
  await rejectsWith(setup({ tabFound: false }).actions.focusSession({ sessionId: ID }), 404);
  await rejectsWith(setup({ tty: null }).actions.focusSession({ sessionId: ID }), 410);
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
