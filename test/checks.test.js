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
    settings: () => ({ commands: { 'billing-api': 'npm test' }, timeoutMs: 600_000 }),
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
  const settle = () => new Promise((resolve) => { setImmediate(resolve); });
  return { checks, runner, dir, head, status, at: (ms) => { t = ms; }, changes: () => changes, settle };
}

test('Run check runs the repo\'s command in the worktree, and says it is running at once', async () => {
  const { checks, runner } = setup();
  const started = await checks.start({ path: WT });
  assert.deepEqual(started, { path: WT, repoName: 'billing-api', command: 'npm test', state: 'running', startedAt: T0 });
  assert.equal(runner.runs.length, 1);
  assert.deepEqual([runner.runs[0].command, runner.runs[0].cwd, runner.runs[0].timeoutMs], ['npm test', WT, 600_000]);
});

test('a check that exits 0 passed, anything else failed, with the end of its output', async () => {
  const { checks, runner, at, settle, changes } = setup();
  await checks.start({ path: WT });
  runner.runs[0].onOutput('> npm test\n');
  runner.runs[0].onOutput('1 failing\n');
  at(T0 + 5000);
  runner.runs[0].finish(1);
  await settle();
  const [result] = Object.values(await checks.results());
  assert.equal(result.state, 'failed');
  assert.equal(result.exitCode, 1);
  assert.equal(result.output, '> npm test\n1 failing\n');
  assert.equal(result.finishedAt, T0 + 5000);
  assert.equal(result.outOfDate, false);
  assert.ok(changes() >= 2, 'the page hears when it starts and ends');

  await checks.start({ path: WT });
  runner.runs[1].finish(0);
  await settle();
  assert.equal((await checks.results())[WT].state, 'passed');
});

test('a check that runs too long is stopped and counts as failed, saying so', async () => {
  const { checks, runner, settle } = setup();
  await checks.start({ path: WT });
  runner.runs[0].finish(null, { timedOut: true });
  await settle();
  const result = (await checks.results())[WT];
  assert.equal(result.state, 'failed');
  assert.match(result.detail, /10 minutes/);
});

test('only the end of a long output is kept', async () => {
  const { checks, runner, settle } = setup();
  await checks.start({ path: WT });
  runner.runs[0].onOutput('x'.repeat(MAX_OUTPUT));
  runner.runs[0].onOutput('the end\n');
  runner.runs[0].finish(0);
  await settle();
  const { output } = (await checks.results())[WT];
  assert.equal(output.length, MAX_OUTPUT);
  assert.ok(output.endsWith('the end\n'));
});

test('a result is out of date once the worktree\'s commit or files change after it ran', async () => {
  const { checks, runner, settle, head, status } = setup();
  await checks.start({ path: WT });
  runner.runs[0].finish(0);
  await settle();
  assert.equal((await checks.results())[WT].outOfDate, false);
  status.value = ' M src/cart.js\n';
  assert.equal((await checks.results())[WT].outOfDate, true);
  status.value = '';
  head.value = 'h2';
  assert.equal((await checks.results())[WT].outOfDate, true);
});

test('refused: no command for its repo, a folder that is not a worktree, one already running, a bad request', async () => {
  const { checks } = setup();
  await assert.rejects(checks.start({ path: '/r/storefront-x' }), (e) => e.status === 409 && /Settings/.test(e.message));
  await assert.rejects(checks.start({ path: '/etc' }), (e) => e.status === 404);
  await assert.rejects(checks.start({ path: 42 }), (e) => e.status === 400);
  await checks.start({ path: WT });
  await assert.rejects(checks.start({ path: WT }), (e) => e.status === 409 && /running/.test(e.message));
});

test('results are kept across restarts; one still running when switchyard stopped is interrupted', async () => {
  const first = setup();
  await first.checks.start({ path: WT });
  const again = setup({ dir: first.dir });
  const result = (await again.checks.results())[WT];
  assert.equal(result.state, 'interrupted');
  assert.match(result.detail, /restarted/);
});

test('the repos with a check command, for Run check', () => {
  assert.deepEqual(setup().checks.repos(), ['billing-api']);
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

test('results can use a repo list the caller already has, instead of looking again', async () => {
  const { checks, runner, settle } = setup();
  await checks.start({ path: WT });
  runner.runs[0].finish(0);
  await settle();
  assert.deepEqual(Object.keys(await checks.results({ repos: [] })), []);
  assert.deepEqual(Object.keys(await checks.results({ repos: STATE.repos })), [WT]);
});
