import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claudeCommand, createTaskService, parseNewTask, worktreePathFor } from '../src/tasks.js';

const MAIN = '/w/my-repo';
const state = { repos: [{ name: 'my-repo', mainPath: MAIN, worktrees: [] }] };

function setup({ failTmux = null, refs = {}, originHead = 'origin/main', paths = [], windows = [], failWorktree = null, failFetch = false } = {}) {
  const calls = [];
  const git = async (args) => {
    calls.push(['git', ...args]);
    const [, , command] = args;
    if (command === 'check-ref-format') {
      if (args.at(-1).includes('..')) throw new Error('not a valid branch name');
      return `${args.at(-1)}\n`;
    }
    if (command === 'symbolic-ref') {
      if (!originHead) throw new Error('no origin HEAD');
      return `${originHead}\n`;
    }
    if (command === 'show-ref') {
      if (!refs[args.at(-1)]) throw new Error('not found');
      return '';
    }
    if (command === 'fetch' && failFetch) throw new Error('offline');
    if (command === 'worktree' && failWorktree) throw new Error(failWorktree);
    return '';
  };
  const tmux = {
    hasWindow: async (session, name) => session === 'switchyard' && windows.includes(name),
    newWindow: async (options) => { calls.push(['new-window', options]); if (failTmux === 'new') throw Object.assign(new Error('tmux: boom'), { status: 502 }); return { window: '@4', pane: '%7' }; },
    sendLine: async (pane, text) => { calls.push(['type', pane, text]); if (failTmux === 'type') throw Object.assign(new Error('tmux: boom'), { status: 502 }); },
    killWindow: async (window) => { calls.push(['kill', window]); },
  };
  const tasks = createTaskService({
    stateService: { getState: async () => state },
    tmux,
    git,
    exists: (path) => paths.includes(path),
  });
  return { tasks, calls };
}

const rejectsWith = (promise, status) => assert.rejects(promise, (error) => error.status === status);

test('parseNewTask accepts a repo, a branch and an optional one-line prompt', () => {
  assert.deepEqual(parseNewTask({ repo: MAIN, branch: ' fix/login ', prompt: '  ' }), { repo: MAIN, branch: 'fix/login', prompt: null });
  assert.equal(parseNewTask({ repo: MAIN, branch: 'b', prompt: 'Fix the login bug' }).prompt, 'Fix the login bug');
});

test('parseNewTask refuses branch names and prompts that could be read as options or keys', () => {
  for (const body of [
    {}, { repo: MAIN }, { repo: MAIN, branch: '-x' }, { repo: MAIN, branch: 'a b' }, { repo: MAIN, branch: 'a/' },
    { repo: MAIN, branch: 'b', prompt: 'line\nbreak' }, { repo: MAIN, branch: 'b', prompt: '--dangerously-skip-permissions' },
    { repo: MAIN, branch: 'b', prompt: 'x'.repeat(2001) },
  ]) {
    assert.throws(() => parseNewTask(body), (error) => error.status === 400, JSON.stringify(body));
  }
});

test('worktreePathFor puts the worktree beside the main checkout, named after the last branch segment', () => {
  assert.equal(worktreePathFor({ name: 'my-repo', mainPath: MAIN }, 'fix/login-bug'), '/w/my-repo-login-bug');
});

test('claudeCommand quotes the prompt for the shell', () => {
  assert.equal(claudeCommand(null), 'claude');
  assert.equal(claudeCommand("don't stop"), "claude 'don'\\''t stop'");
  // Always quoted: zsh would expand an unquoted "=word".
  assert.equal(claudeCommand('=foo'), "claude '=foo'");
});

test('startTask creates a branch from the default branch, a worktree, and a switchyard tmux window running claude', async () => {
  const { tasks, calls } = setup();
  const result = await tasks.startTask({ repo: MAIN, branch: 'fix/login', prompt: 'Fix the login bug' });
  assert.deepEqual(result, { path: '/w/my-repo-login', branch: 'fix/login', session: 'switchyard', window: 'my-repo-login' });
  assert.deepEqual(calls.filter(([kind, , , command]) => kind !== 'git' || command === 'fetch' || command === 'worktree'), [
    ['git', '-C', MAIN, 'fetch', '--quiet', 'origin', 'main'],
    ['git', '-C', MAIN, 'worktree', 'add', '--no-track', '-b', 'fix/login', '/w/my-repo-login', 'origin/main'],
    ['new-window', { session: 'switchyard', name: 'my-repo-login', cwd: '/w/my-repo-login' }],
    ['type', '%7', "claude 'Fix the login bug'"],
  ]);
});

test('startTask checks out an existing branch instead of creating one', async () => {
  const { tasks, calls } = setup({ refs: { 'refs/heads/fix/login': true } });
  await tasks.startTask({ repo: MAIN, branch: 'fix/login' });
  assert.ok(calls.some((call) => call.join(' ') === `git -C ${MAIN} worktree add /w/my-repo-login fix/login`));
  assert.ok(!calls.some((call) => call.includes('fetch')));
});

test('startTask branches from HEAD when the repo has no origin default branch', async () => {
  const { tasks, calls } = setup({ originHead: null });
  await tasks.startTask({ repo: MAIN, branch: 'spike' });
  assert.ok(calls.some((call) => call.join(' ') === `git -C ${MAIN} worktree add --no-track -b spike /w/my-repo-spike HEAD`));
});

test('startTask still starts when fetching the default branch fails', async () => {
  const { tasks, calls } = setup({ failFetch: true });
  assert.equal((await tasks.startTask({ repo: MAIN, branch: 'spike' })).window, 'my-repo-spike');
  assert.ok(calls.some(([kind]) => kind === 'new-window'));
});

test('startTask refuses repos it did not discover', async () => {
  await rejectsWith(setup().tasks.startTask({ repo: '/etc', branch: 'x' }), 404);
});

test('startTask refuses branch names git rejects', async () => {
  await rejectsWith(setup().tasks.startTask({ repo: MAIN, branch: 'a..b' }), 400);
});

test('startTask refuses when the folder or its switchyard window already exists', async () => {
  await rejectsWith(setup({ paths: ['/w/my-repo-login'] }).tasks.startTask({ repo: MAIN, branch: 'login' }), 409);
  await rejectsWith(setup({ windows: ['my-repo-login'] }).tasks.startTask({ repo: MAIN, branch: 'login' }), 409);
});

test('startTask reports git failures, e.g. a branch checked out elsewhere', async () => {
  const { tasks, calls } = setup({ failWorktree: "'login' is already used by worktree" });
  await rejectsWith(tasks.startTask({ repo: MAIN, branch: 'login' }), 409);
  assert.ok(!calls.some(([kind]) => kind === 'new-window'));
});

test('startTask tracks a branch that exists only on origin', async () => {
  const { tasks, calls } = setup({ refs: { 'refs/remotes/origin/fix/login': true } });
  await tasks.startTask({ repo: MAIN, branch: 'fix/login' });
  assert.ok(calls.some((call) => call.join(' ') === `git -C ${MAIN} worktree add --track -b fix/login /w/my-repo-login origin/fix/login`));
});

test('startTask removes the worktree it made when tmux fails, so you can retry', async () => {
  const { tasks, calls } = setup({ failTmux: 'new' });
  await rejectsWith(tasks.startTask({ repo: MAIN, branch: 'login' }), 502);
  assert.ok(calls.some((call) => call.join(' ') === `git -C ${MAIN} worktree remove /w/my-repo-login`));
  assert.ok(!calls.some(([kind]) => kind === 'kill'));
});

test('startTask also closes its tmux window when typing claude fails', async () => {
  const { tasks, calls } = setup({ failTmux: 'type' });
  await rejectsWith(tasks.startTask({ repo: MAIN, branch: 'login' }), 502);
  assert.deepEqual(calls.filter(([kind]) => kind === 'kill'), [['kill', '@4']]);
  assert.ok(calls.some((call) => call.join(' ') === `git -C ${MAIN} worktree remove /w/my-repo-login`));
});

test('fetching the default branch never waits on a credential prompt', async () => {
  const seen = [];
  const tasks = createTaskService({
    stateService: { getState: async () => state },
    tmux: { hasWindow: async () => false, newWindow: async () => ({ window: '@1', pane: '%1' }), sendLine: async () => {} },
    git: async (args, options) => { seen.push([args[2], options]); if (args[2] === 'show-ref') throw new Error('no'); return args[2] === 'symbolic-ref' ? 'origin/main\n' : ''; },
    exists: () => false,
  });
  await tasks.startTask({ repo: MAIN, branch: 'spike' });
  const [, options] = seen.find(([command]) => command === 'fetch');
  assert.equal(options.env.GIT_TERMINAL_PROMPT, '0');
});
