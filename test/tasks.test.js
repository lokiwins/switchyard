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
    starts: { track: (task) => calls.push(['track', task]) },
    git,
    exists: (path) => paths.includes(path),
  });
  return { tasks, calls };
}

const rejectsWith = (promise, status) => assert.rejects(promise, (error) => error.status === status);

test('parseNewTask takes a repo, a one-line task and an optional branch', () => {
  assert.deepEqual(parseNewTask({ repo: MAIN, branch: ' fix/login ', prompt: ' Fix the login bug ' }), { repo: MAIN, branch: 'fix/login', prompt: 'Fix the login bug' });
  assert.deepEqual(parseNewTask({ repo: MAIN, branch: '  ', prompt: 'Fix it' }), { repo: MAIN, branch: null, prompt: 'Fix it' });
  assert.equal(parseNewTask({ repo: MAIN, prompt: 'Fix it' }).branch, null);
});

test('parseNewTask requires the task', () => {
  for (const prompt of [undefined, '', '   ']) {
    assert.throws(() => parseNewTask({ repo: MAIN, branch: 'b', prompt }), (error) => error.status === 400 && /task/.test(error.message));
  }
});

test('parseNewTask refuses branch names and prompts that could be read as options or keys', () => {
  for (const body of [
    {}, { prompt: 'p' }, { repo: MAIN, branch: '-x', prompt: 'p' }, { repo: MAIN, branch: 'a b', prompt: 'p' }, { repo: MAIN, branch: 'a/', prompt: 'p' },
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
    ['track', { path: '/w/my-repo-login', place: 'switchyard:my-repo-login', pane: '%7' }],
  ]);
});

test('startTask checks out an existing branch instead of creating one', async () => {
  const { tasks, calls } = setup({ refs: { 'refs/heads/fix/login': true } });
  await tasks.startTask({ repo: MAIN, branch: 'fix/login', prompt: 'Carry on' });
  assert.ok(calls.some((call) => call.join(' ') === `git -C ${MAIN} worktree add /w/my-repo-login fix/login`));
  assert.ok(!calls.some((call) => call.includes('fetch')));
});

test('startTask branches from HEAD when the repo has no origin default branch', async () => {
  const { tasks, calls } = setup({ originHead: null });
  await tasks.startTask({ repo: MAIN, branch: 'spike', prompt: 'Try it' });
  assert.ok(calls.some((call) => call.join(' ') === `git -C ${MAIN} worktree add --no-track -b spike /w/my-repo-spike HEAD`));
});

test('startTask still starts when fetching the default branch fails', async () => {
  const { tasks, calls } = setup({ failFetch: true });
  assert.equal((await tasks.startTask({ repo: MAIN, branch: 'spike', prompt: 'Try it' })).window, 'my-repo-spike');
  assert.ok(calls.some(([kind]) => kind === 'new-window'));
});

test('startTask refuses repos it did not discover', async () => {
  await rejectsWith(setup().tasks.startTask({ repo: '/etc', branch: 'x', prompt: 'p' }), 404);
});

test('startTask refuses branch names git rejects', async () => {
  await rejectsWith(setup().tasks.startTask({ repo: MAIN, branch: 'a..b', prompt: 'p' }), 400);
});

test('startTask refuses when the folder or its switchyard window already exists', async () => {
  await rejectsWith(setup({ paths: ['/w/my-repo-login'] }).tasks.startTask({ repo: MAIN, branch: 'login', prompt: 'p' }), 409);
  await rejectsWith(setup({ windows: ['my-repo-login'] }).tasks.startTask({ repo: MAIN, branch: 'login', prompt: 'p' }), 409);
});

test('startTask reports git failures, e.g. a branch checked out elsewhere', async () => {
  const { tasks, calls } = setup({ failWorktree: "'login' is already used by worktree" });
  await rejectsWith(tasks.startTask({ repo: MAIN, branch: 'login', prompt: 'p' }), 409);
  assert.ok(!calls.some(([kind]) => kind === 'new-window'));
});

test('startTask tracks a branch that exists only on origin', async () => {
  const { tasks, calls } = setup({ refs: { 'refs/remotes/origin/fix/login': true } });
  await tasks.startTask({ repo: MAIN, branch: 'fix/login', prompt: 'Carry on' });
  assert.ok(calls.some((call) => call.join(' ') === `git -C ${MAIN} worktree add --track -b fix/login /w/my-repo-login origin/fix/login`));
});

test('startTask removes the worktree it made when tmux fails, so you can retry', async () => {
  const { tasks, calls } = setup({ failTmux: 'new' });
  await rejectsWith(tasks.startTask({ repo: MAIN, branch: 'login', prompt: 'p' }), 502);
  assert.ok(calls.some((call) => call.join(' ') === `git -C ${MAIN} worktree remove /w/my-repo-login`));
  assert.ok(!calls.some(([kind]) => kind === 'kill'));
});

test('startTask also closes its tmux window when typing claude fails', async () => {
  const { tasks, calls } = setup({ failTmux: 'type' });
  await rejectsWith(tasks.startTask({ repo: MAIN, branch: 'login', prompt: 'p' }), 502);
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
  await tasks.startTask({ repo: MAIN, branch: 'spike', prompt: 'Try it' });
  const [, options] = seen.find(([command]) => command === 'fetch');
  assert.equal(options.env.GIT_TERMINAL_PROMPT, '0');
});

test('startTask names the branch after the task when you leave it empty', async () => {
  const { tasks, calls } = setup();
  const result = await tasks.startTask({ repo: MAIN, prompt: 'Fix the login redirect' });
  assert.deepEqual(result, { path: '/w/my-repo-fix-login-redirect', branch: 'fix-login-redirect', session: 'switchyard', window: 'my-repo-fix-login-redirect' });
  assert.ok(calls.some((call) => call.join(' ') === `git -C ${MAIN} worktree add --no-track -b fix-login-redirect /w/my-repo-fix-login-redirect origin/main`));
});

test('a branch named after the task skips names already taken, here or on origin, by folder or tab', async () => {
  const { tasks } = setup({
    refs: { 'refs/heads/fix-login': true, 'refs/remotes/origin/fix-login-2': true },
    paths: ['/w/my-repo-fix-login-3'],
    windows: ['my-repo-fix-login-4'],
  });
  assert.equal((await tasks.startTask({ repo: MAIN, prompt: 'Fix login' })).branch, 'fix-login-5');
});

test('a branch named after the task gives up after a while and asks for a name', async () => {
  const refs = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`refs/heads/fix-login${i === 0 ? '' : `-${i + 1}`}`, true]));
  await rejectsWith(setup({ refs }).tasks.startTask({ repo: MAIN, prompt: 'Fix login' }), 409);
});

test('a task that fails to start is not watched', async () => {
  const { tasks, calls } = setup({ failTmux: 'type' });
  await rejectsWith(tasks.startTask({ repo: MAIN, branch: 'b', prompt: 'p' }), 502);
  assert.equal(calls.some(([kind]) => kind === 'track'), false);
});
