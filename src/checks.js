import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ActionError } from './errors.js';
import { run } from './exec.js';
import { createJsonFile, defaultStoreDir } from './json-store.js';

/*
 * Run check: the command Settings › Checks gives a worktree's repo (say
 * "npm test"), run in the worktree, so its pass or fail shows on the task
 * and on each attempt's card. Results are kept in checks.json; one is out
 * of date once the worktree's commit or files change after it ran. Checks
 * only warn: nothing is refused because one failed.
 */

// The end of a check's output is kept, where the failures usually are.
export const MAX_OUTPUT = 8 * 1024;
// After a timeout's SIGTERM, how long before SIGKILL.
const KILL_GRACE_MS = 3000;

const FILE = 'checks.json';
const runGit = (args) => run('git', args);
/** "10 minutes", or "30 seconds" for a timeout under a minute. */
const duration = (ms) => (ms < 60_000 ? `${Math.round(ms / 1000)} seconds` : `${Math.round(ms / 60_000)} minutes`);

/**
 * Run `command` in a shell in `cwd`, in its own process group so a timeout
 * stops everything it started. Resolves to { exitCode, timedOut }.
 */
export function runShellCommand({ command, cwd, timeoutMs, onOutput }) {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let timedOut = false;
    const signal = (name) => { try { process.kill(-child.pid, name); } catch { /* already gone */ } };
    const timer = setTimeout(() => {
      timedOut = true;
      signal('SIGTERM');
      setTimeout(() => signal('SIGKILL'), KILL_GRACE_MS).unref();
    }, timeoutMs);
    child.stdout.on('data', (chunk) => onOutput(chunk.toString()));
    child.stderr.on('data', (chunk) => onOutput(chunk.toString()));
    child.on('error', (error) => {
      clearTimeout(timer);
      onOutput(`${error.message}\n`);
      resolve({ exitCode: null, timedOut: false });
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, timedOut });
    });
  });
}

/**
 * @param {{ file?: { read, write }, settings: () => { commands: Record<string, string>, timeoutMs: number },
 *   getState: () => Promise<{ repos: object[] }>, runCommand?: Function, git?: Function, now?: () => number, onChange?: () => void }} deps
 */
export function createChecks({
  file = createJsonFile(defaultStoreDir(), FILE), settings, getState, runCommand = runShellCommand, git = runGit, now = Date.now, onChange = () => {},
}) {
  let results = null;
  let saving = Promise.resolve();

  /** The kept results; a check that was running when switchyard stopped never finished. */
  async function load() {
    if (results) return results;
    const saved = (await file.read()).checks ?? {};
    results = Object.fromEntries(Object.entries(saved).map(([path, result]) => [path, result.state === 'running'
      ? { ...result, state: 'interrupted', detail: 'switchyard restarted while it ran' }
      : result]));
    return results;
  }

  function save() {
    const snapshot = { checks: results };
    saving = saving.then(() => file.write(snapshot)).catch((error) => {
      process.stderr.write(`[switchyard] saving check results: ${error.message}\n`);
    });
    return saving;
  }

  /** The worktree's commit and files, so a later change shows the result is out of date. */
  async function fingerprint(path) {
    const [head, status] = await Promise.all([
      git(['-C', path, 'rev-parse', 'HEAD']),
      git(['-C', path, 'status', '--porcelain', '--untracked-files=all']),
    ]);
    return createHash('sha1').update(head.trim()).update('\0').update(status).digest('hex');
  }

  async function finish(path, outcome, output) {
    const timeoutMs = settings().timeoutMs;
    const passed = outcome.exitCode === 0 && !outcome.timedOut;
    const print = await fingerprint(path).catch(() => null);
    results[path] = {
      ...results[path],
      state: passed ? 'passed' : 'failed',
      exitCode: outcome.exitCode,
      finishedAt: now(),
      output,
      fingerprint: print,
      ...(outcome.timedOut ? { detail: `Stopped after ${duration(timeoutMs)}` } : {}),
    };
    // The page reads results from here, so it can hear now; the file catches up.
    onChange();
    await save();
  }

  /** Run check on a worktree: starts its repo's command and resolves at once, as running. */
  async function start(body) {
    const path = body?.path;
    if (typeof path !== 'string') throw new ActionError(400, 'Expected { path: "<worktree path>" }');
    const repo = (await getState()).repos.find((r) => r.worktrees.some((w) => w.path === path));
    if (!repo) throw new ActionError(404, 'That folder is not one of your worktrees');
    const command = settings().commands[repo.name];
    if (!command) throw new ActionError(409, `${repo.name} has no check command; add one in Settings › Checks`);
    await load();
    if (results[path]?.state === 'running') throw new ActionError(409, 'Its check is already running');

    const result = {
      path, repoName: repo.name, command, state: 'running', startedAt: now(),
    };
    results[path] = result;
    await save();
    onChange();
    let output = '';
    const onOutput = (text) => { output = (output + text).slice(-MAX_OUTPUT); };
    runCommand({ command, cwd: path, timeoutMs: settings().timeoutMs, onOutput })
      .then((outcome) => finish(path, outcome, output))
      .catch((error) => finish(path, { exitCode: null, timedOut: false }, `${output}${error.message}\n`));
    return result;
  }

  /**
   * Every worktree's latest check, by path, saying whether it's out of date;
   * worktrees that are gone are left out. `repos`, when the caller has them, saves looking again.
   */
  async function current({ repos } = {}) {
    await load();
    const paths = new Set((repos ?? (await getState()).repos).flatMap((r) => r.worktrees.map((w) => w.path)));
    const entries = await Promise.all(Object.entries(results).filter(([path]) => paths.has(path)).map(async ([path, result]) => {
      const finished = result.state === 'passed' || result.state === 'failed';
      const outOfDate = finished && Boolean(result.fingerprint) && await fingerprint(path).then((print) => print !== result.fingerprint, () => false);
      const { fingerprint: _print, ...shown } = result;
      return [path, { ...shown, outOfDate }];
    }));
    return Object.fromEntries(entries);
  }

  /** The repos that have a check command. */
  const repos = () => Object.keys(settings().commands);

  return { start, results: current, repos };
}
