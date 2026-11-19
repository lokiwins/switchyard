import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createJsonFile } from '../src/json-store.js';
import { MAX_OUTPUT, createChecks, runShellCommand } from '../src/checks.js';

const T0 = Date.UTC(2026, 10, 18, 12);
const WT = '/r/billing-api-fix';
const STATE = {
  repos: [
    { name: 'billing-api', mainPath: '/r/billing-api', worktrees: [{ path: '/r/billing-api', isMain: true }, { path: WT, isMain: false }] },
    { name: 'storefront', mainPath: '/r/storefront', worktrees: [{ path: '/r/storefront-x', isMain: false }] },
  ],
};
const COMMANDS = {
  'billing-api': [
    { name: 'lint', command: 'npm run lint', run: 'after-turn', timeoutMs: null },
    { name: 'test', command: 'npm test', run: 'on-commit', timeoutMs: 1_200_000 },
  ],
};

/** A command runner that finishes when the test says: `finish(exitCode, { timedOut })`. */
function fakeRunner() {
  const runs = [];
  const runCommand = (options) => new Promise((resolve) => {
    runs.push({ ...options, finish: (exitCode, { timedOut = false } = {}) => resolve({ exitCode, timedOut }) });
  });
  return { runs, runCommand };
}

function setup({ dir = mkdtempSync(join(tmpdir(), 'switchyard-checks-')), runner = fakeRunner(), head = { value: 'h1' }, status = { value: '' } } = {}) {
  let t = T0;
  let changes = 0;
  const checks = createChecks({
    file: createJsonFile(dir, 'checks.json'),
    settings: () => ({ commands: COMMANDS, timeoutMs: 600_000 }),
    getState: async () => STATE,
    runCommand: runner.runCommand,
    git: async (args) => {
      if (args.includes('rev-parse')) return `${head.value}\n`;
      if (args.includes('status')) return status.value;
      throw new Error(`unexpected git ${args.join(' ')}`);
    },
    now: () => t,
    onChange: () => { changes += 1; },
  });
  // Lets a finished run's bookkeeping (git, saving, the next queued check) happen.
  const settle = async () => { for (let i = 0; i < 5; i += 1) await new Promise((resolve) => { setImmediate(resolve); }); };
  return { checks, runner, dir, head, status, at: (ms) => { t = ms; }, changes: () => changes, settle };
}

const byName = (list) => Object.fromEntries((list ?? []).map((r) => [r.name, r]));

test('Run check runs one named check: its command, in the worktree, running at once', async () => {
  const { checks, runner } = setup();
  const started = await checks.start({ path: WT, name: 'test' });
  assert.deepEqual(started.checks, [{ name: 'test', command: 'npm test', state: 'running', startedAt: T0, trigger: 'manual' }]);
  assert.deepEqual(runner.runs.map((r) => [r.command, r.cwd, r.timeoutMs]), [['npm test', WT, 1_200_000]], 'test has its own timeout');
});

test('Run all runs the repo\'s checks one after another, the rest waiting their turn', async () => {
  const { checks, runner, settle } = setup();
  const started = await checks.start({ path: WT });
  assert.deepEqual(started.checks.map((c) => [c.name, c.state]), [['lint', 'running'], ['test', 'queued']]);
  assert.equal(runner.runs.length, 1);
  runner.runs[0].finish(0);
  await settle();
  assert.deepEqual(runner.runs.map((r) => r.command), ['npm run lint', 'npm test'], 'test starts when lint is done');
  assert.equal(byName((await checks.results())[WT]).test.state, 'running');
  runner.runs[1].finish(1);
  await settle();
  const results = byName((await checks.results())[WT]);
  assert.deepEqual([results.lint.state, results.test.state], ['passed', 'failed']);
});

test('a check that exits 0 passed, anything else failed, with the end of its output', async () => {
  const { checks, runner, at, settle, changes } = setup();
  await checks.start({ path: WT, name: 'test' });
  runner.runs[0].onOutput('> npm test\n');
  runner.runs[0].onOutput('1 failing\n');
  at(T0 + 5000);
  runner.runs[0].finish(1);
  await settle();
  const { test: result } = byName((await checks.results())[WT]);
  assert.deepEqual([result.state, result.exitCode, result.output, result.finishedAt, result.outOfDate], ['failed', 1, '> npm test\n1 failing\n', T0 + 5000, false]);
  assert.ok(changes() >= 2, 'the page hears when it starts and ends');
});

test('a check that runs too long is stopped and counts as failed, saying so', async () => {
  const { checks, runner, settle } = setup();
  await checks.start({ path: WT, name: 'test' });
  runner.runs[0].finish(null, { timedOut: true });
  await settle();
  const { test: result } = byName((await checks.results())[WT]);
  assert.equal(result.state, 'failed');
  assert.match(result.detail, /20 minutes/, "test has its own 20 minute timeout");
});

test('only the end of a long output is kept', async () => {
  const { checks, runner, settle } = setup();
  await checks.start({ path: WT, name: 'lint' });
  runner.runs[0].onOutput('x'.repeat(MAX_OUTPUT));
  runner.runs[0].onOutput('the end\n');
  runner.runs[0].finish(0);
  await settle();
  const { output } = byName((await checks.results())[WT]).lint;
  assert.equal(output.length, MAX_OUTPUT);
  assert.ok(output.endsWith('the end\n'));
});

test('a result is out of date once the worktree\'s commit or files change after it ran', async () => {
  const { checks, runner, settle, head, status } = setup();
  await checks.start({ path: WT, name: 'test' });
  runner.runs[0].finish(0);
  await settle();
  const outOfDate = async () => byName((await checks.results())[WT]).test.outOfDate;
  assert.equal(await outOfDate(), false);
  status.value = ' M src/cart.js\n';
  assert.equal(await outOfDate(), true);
  status.value = '';
  head.value = 'h2';
  assert.equal(await outOfDate(), true);
});

test('refused: no checks for its repo, an unknown check, not a worktree, one already running, a bad request', async () => {
  const { checks } = setup();
  await assert.rejects(checks.start({ path: '/r/storefront-x' }), (e) => e.status === 409 && /Settings/.test(e.message));
  await assert.rejects(checks.start({ path: WT, name: 'deploy' }), (e) => e.status === 404 && /lint, test/.test(e.message));
  await assert.rejects(checks.start({ path: '/etc' }), (e) => e.status === 404);
  await assert.rejects(checks.start({ path: 42 }), (e) => e.status === 400);
  await assert.rejects(checks.start({ path: WT, name: 7 }), (e) => e.status === 400);
  await checks.start({ path: WT, name: 'test' });
  await assert.rejects(checks.start({ path: WT, name: 'test' }), (e) => e.status === 409 && /running/.test(e.message));
  await assert.rejects(checks.start({ path: WT }), (e) => e.status === 409 && /running/.test(e.message), 'Run all waits for the one running');
});

test('results are kept across restarts; ones running or waiting when switchyard stopped are interrupted', async () => {
  const first = setup();
  await first.checks.start({ path: WT });
  const again = setup({ dir: first.dir });
  const results = byName((await again.checks.results())[WT]);
  assert.deepEqual([results.lint.state, results.test.state], ['interrupted', 'interrupted']);
  assert.match(results.lint.detail, /restarted/);
});

test('a result saved before checks had names is read as the check called "check"', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'switchyard-checks-'));
  await createJsonFile(dir, 'checks.json').write({ checks: { [WT]: { path: WT, repoName: 'billing-api', command: 'npm test', state: 'passed', exitCode: 0, finishedAt: T0 } } });
  const { checks } = setup({ dir });
  assert.deepEqual(await checks.results(), {}, 'billing-api has no check called "check" any more, so it is not shown');
  const kept = await createJsonFile(dir, 'checks.json').read();
  assert.deepEqual(Object.keys(kept.checks[WT]), ['path', 'repoName', 'command', 'state', 'exitCode', 'finishedAt'], 'untouched until something is run');
});

test('results show only the checks the repo has now, in their order', async () => {
  const { checks, runner, settle } = setup();
  await checks.start({ path: WT, name: 'test' });
  runner.runs[0].finish(0);
  await settle();
  await checks.start({ path: WT, name: 'lint' });
  await settle();
  runner.runs[1].finish(0);
  await settle();
  assert.deepEqual((await checks.results())[WT].map((r) => r.name), ['lint', 'test']);
});

test('each repo\'s check names, for the page', () => {
  assert.deepEqual(setup().checks.names(), { 'billing-api': ['lint', 'test'] });
});

test('results can use a repo list the caller already has, instead of looking again', async () => {
  const { checks, runner, settle } = setup();
  await checks.start({ path: WT, name: 'test' });
  runner.runs[0].finish(0);
  await settle();
  assert.deepEqual(Object.keys(await checks.results({ repos: [] })), []);
  assert.deepEqual(Object.keys(await checks.results({ repos: STATE.repos })), [WT]);
});

test('the shell runner gives the output and exit code, and a timeout stops the command and what it started', async () => {
  let output = '';
  const done = await runShellCommand({ command: 'echo out; echo err >&2; exit 3', cwd: tmpdir(), timeoutMs: 5000, onOutput: (t) => { output += t; } });
  assert.deepEqual(done, { exitCode: 3, timedOut: false });
  assert.match(output, /out/);
  assert.match(output, /err/);
  const started = Date.now();
  const slow = await runShellCommand({ command: 'sleep 30 & sleep 30', cwd: tmpdir(), timeoutMs: 200, onOutput: () => {} });
  assert.equal(slow.timedOut, true);
  assert.ok(Date.now() - started < 5000, 'stopped, not waited out');
});

test('a check without its own timeout uses the one in Settings', async () => {
  const { checks, runner } = setup();
  await checks.start({ path: WT, name: 'lint' });
  assert.equal(runner.runs[0].timeoutMs, 600_000);
});

test('autoRun runs the checks set to run on that trigger, saying what started them', async () => {
  const { checks, runner, settle } = setup();
  assert.deepEqual(await checks.autoRun({ path: WT, trigger: 'after-turn' }), ['lint']);
  assert.deepEqual(runner.runs.map((r) => r.command), ['npm run lint']);
  runner.runs[0].finish(0);
  await settle();
  assert.equal(byName((await checks.results())[WT]).lint.trigger, 'after-turn');
  assert.deepEqual(await checks.autoRun({ path: WT, trigger: 'on-commit' }), ['test']);
  assert.deepEqual(await checks.autoRun({ path: '/r/storefront-x', trigger: 'after-turn' }), [], 'a repo with no checks');
});

test('autoRun skips a check whose result is still current, and runs it again once the worktree changes', async () => {
  const { checks, runner, settle, status } = setup();
  await checks.autoRun({ path: WT, trigger: 'after-turn' });
  runner.runs[0].finish(1);
  await settle();
  assert.deepEqual(await checks.autoRun({ path: WT, trigger: 'after-turn' }), [], 'nothing changed since it ran');
  status.value = ' M src/cart.js\n';
  assert.deepEqual(await checks.autoRun({ path: WT, trigger: 'after-turn' }), ['lint']);
});

test('a trigger while a check is running waits, and runs when it is done', async () => {
  const { checks, runner, settle, status } = setup();
  await checks.start({ path: WT, name: 'test' });
  assert.deepEqual(await checks.autoRun({ path: WT, trigger: 'after-turn' }), [], 'not now: test is running');
  status.value = ' M a.js\n';
  runner.runs[0].finish(0);
  await settle();
  assert.deepEqual(runner.runs.map((r) => r.command), ['npm test', 'npm run lint'], 'lint ran once test was done');
});
