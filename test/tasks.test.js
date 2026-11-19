import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTaskService, parseNewTask, worktreePathFor } from '../src/tasks.js';
import { testAgents } from './support/agents.js';

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
    agents: testAgents(),
    git,
    exists: (path) => paths.includes(path),
  });
  return { tasks, calls };
}

const rejectsWith = (promise, status) => assert.rejects(promise, (error) => error.status === status);

test('parseNewTask takes a repo, a one-line task and an optional branch', () => {
  assert.deepEqual(parseNewTask({ repo: MAIN, branch: ' fix/login ', prompt: ' Fix the login bug ' }), { repo: MAIN, branch: 'fix/login', prompt: 'Fix the login bug', provider: null, base: null });
  assert.deepEqual(parseNewTask({ repo: MAIN, branch: '  ', prompt: 'Fix it' }), { repo: MAIN, branch: null, prompt: 'Fix it', provider: null, base: null });
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

test('parseNewTask takes an optional agent provider id', () => {
  assert.equal(parseNewTask({ repo: MAIN, prompt: 'Fix it' }).provider, null);
  assert.equal(parseNewTask({ repo: MAIN, prompt: 'Fix it', provider: 'other' }).provider, 'other');
  assert.throws(() => parseNewTask({ repo: MAIN, prompt: 'Fix it', provider: 42 }), (error) => error.status === 400);
});

test('startTask quotes the task for the shell, even when it looks safe', async () => {
  for (const [prompt, typed] of [["don't stop", "claude 'don'\\''t stop'"], ['=foo', "claude '=foo'"]]) {
    const { tasks, calls } = setup();
    await tasks.startTask({ repo: MAIN, branch: 'b', prompt });
    assert.deepEqual(calls.find(([kind]) => kind === 'type'), ['type', '%7', typed]);
  }
});

test('startTask runs the agent asked for, and watches for its command', async () => {
  const { tasks, calls } = setup();
  await tasks.startTask({ repo: MAIN, branch: 'fix/login', prompt: 'Fix it', provider: 'other' });
  assert.deepEqual(calls.find(([kind]) => kind === 'type'), ['type', '%7', "other-agent --task 'Fix it'"]);
  assert.equal(calls.find(([kind]) => kind === 'track')[1].command, 'other-agent');
});

test('startTask refuses an agent it does not know, before making anything', async () => {
  const { tasks, calls } = setup();
  await rejectsWith(tasks.startTask({ repo: MAIN, branch: 'b', prompt: 'Fix it', provider: 'codex' }), 400);
  assert.equal(calls.some(([kind, , , command]) => kind === 'new-window' || command === 'worktree'), false);
});

test('startTask creates a branch from the default branch, a worktree, and a switchyard tmux window running claude', async () => {
  const { tasks, calls } = setup();
  const result = await tasks.startTask({ repo: MAIN, branch: 'fix/login', prompt: 'Fix the login bug', provider: null, base: null });
  assert.deepEqual(result, { path: '/w/my-repo-login', branch: 'fix/login', session: 'switchyard', window: 'my-repo-login', provider: 'claude' });
  assert.deepEqual(calls.filter(([kind, , , command]) => kind !== 'git' || command === 'fetch' || command === 'worktree'), [
    ['git', '-C', MAIN, 'fetch', '--quiet', 'origin', 'main'],
    ['git', '-C', MAIN, 'worktree', 'add', '--no-track', '-b', 'fix/login', '/w/my-repo-login', 'origin/main'],
    ['new-window', { session: 'switchyard', name: 'my-repo-login', cwd: '/w/my-repo-login' }],
    ['type', '%7', "claude 'Fix the login bug'"],
    ['track', { path: '/w/my-repo-login', place: 'switchyard:my-repo-login', pane: '%7', command: 'claude' }],
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
    agents: testAgents(),
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
  assert.deepEqual(result, { path: '/w/my-repo-fix-login-redirect', branch: 'fix-login-redirect', session: 'switchyard', window: 'my-repo-fix-login-redirect', provider: 'claude' });
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

test('startTask can branch from a given local branch (a subtask from its parent\'s), without fetching', async () => {
  const { tasks, calls } = setup({ refs: { 'refs/heads/sy-parent-cart': true } });
  await tasks.startTask({ repo: MAIN, branch: 'sy-child-totals', prompt: 'Fix the totals', base: 'sy-parent-cart' });
  assert.ok(calls.some((call) => call.join(' ') === `git -C ${MAIN} worktree add --no-track -b sy-child-totals /w/my-repo-sy-child-totals sy-parent-cart`), calls.map((c) => c.join(' ')).join('\n'));
  assert.equal(calls.some((call) => call.includes('fetch')), false);
});

test('startTask refuses a base branch that is not there, or not a branch name', async () => {
  const { tasks, calls } = setup();
  await rejectsWith(tasks.startTask({ repo: MAIN, branch: 'b', prompt: 'Fix it', base: 'sy-parent-cart' }), 409);
  assert.equal(calls.some(([kind, , , command]) => kind === 'new-window' || command === 'worktree'), false);
  assert.throws(() => parseNewTask({ repo: MAIN, prompt: 'Fix it', base: '-x' }), (e) => e.status === 400);
  assert.throws(() => parseNewTask({ repo: MAIN, prompt: 'Fix it', base: 42 }), (e) => e.status === 400);
});

test('a task can be started with a lead\'s MCP config and settings; the page can\'t ask for them', async () => {
  const { tasks, calls } = setup();
  await tasks.startTask({ repo: MAIN, prompt: 'Lead it', branch: 'lead-it' }, { mcpConfig: '/c/sy-abc123.mcp.json', settings: '/c/sy-abc123.settings.json' });
  assert.match(calls.find((c) => c[0] === 'type')[2], / 'Lead it' --settings '\/c\/sy-abc123.settings.json' --mcp-config '\/c\/sy-abc123.mcp.json'$/);
  const page = setup();
  await page.tasks.startTask({ repo: MAIN, prompt: 'Fix it', branch: 'fix-it', mcpConfig: '/tmp/evil.json', settings: '/tmp/evil.json' });
  assert.doesNotMatch(page.calls.find((c) => c[0] === 'type')[2], /mcp-config|settings/);
});

test('a lead needs an agent that takes an MCP config', async () => {
  const { tasks, calls } = setup();
  await rejectsWith(tasks.startTask({ repo: MAIN, prompt: 'Lead it', branch: 'lead-it', provider: 'other' }, { mcpConfig: '/x.json' }), 400);
  assert.equal(calls.some((c) => c[1] === '-C' && c[3] === 'worktree'), false, 'refused before making a worktree');
});
