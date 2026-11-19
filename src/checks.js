import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ActionError } from './errors.js';
import { run } from './exec.js';
import { createJsonFile, defaultStoreDir } from './json-store.js';

/*
 * Run check: a worktree's repo has named checks in Settings › Checks (say
 * lint: npm run lint, test: npm test). Run runs one in the worktree; Run all
 * runs each in turn. Its pass or fail shows on the task and on each
 * attempt's card. Results are kept in checks.json, by worktree then check;
 * one is out of date once the worktree's commit or files change after it
 * ran. Checks only warn: nothing is refused because one failed.
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
 * @param {{ file?: { read, write }, settings: () => { commands: Record<string, { name: string, command: string }[]>, timeoutMs: number },
 *   getState: () => Promise<{ repos: object[] }>, runCommand?: Function, git?: Function, now?: () => number, onChange?: () => void }} deps
 */
export function createChecks({
  file = createJsonFile(defaultStoreDir(), FILE), settings, getState, runCommand = runShellCommand, git = runGit, now = Date.now, onChange = () => {},
}) {
  // { [worktree path]: { [check name]: result } }
  let results = null;
  let saving = Promise.resolve();
  // Triggers that came while a worktree's checks were running: { [path]: Set of triggers }, run when they're done.
  const waiting = new Map();

  const isBusy = (result) => result?.state === 'running' || result?.state === 'queued';

  /**
   * The kept results. A check running or waiting when switchyard stopped never
   * finished; one saved before checks had names is the check called "check".
   */
  async function load() {
    if (results) return results;
    const saved = (await file.read()).checks ?? {};
    const interrupted = (result) => (isBusy(result) ? { ...result, state: 'interrupted', detail: 'switchyard restarted while it ran' } : result);
    results = Object.fromEntries(Object.entries(saved).map(([path, byName]) => [path, typeof byName.state === 'string'
      ? { check: interrupted(byName) }
      : Object.fromEntries(Object.entries(byName).map(([name, result]) => [name, interrupted(result)]))]));
    return results;
  }

  function save() {
    const snapshot = { checks: results };
    saving = saving.then(() => file.write(snapshot)).catch((error) => {
      process.stderr.write(`[switchyard] saving check results: ${error.message}\n`);
    });
    return saving;
  }

  /** The worktree's commit and files, so a later change shows a result is out of date. */
  async function fingerprint(path) {
    const [head, status] = await Promise.all([
      git(['-C', path, 'rev-parse', 'HEAD']),
      git(['-C', path, 'status', '--porcelain', '--untracked-files=all']),
    ]);
    return createHash('sha1').update(head.trim()).update('\0').update(status).digest('hex');
  }

  const set = (path, name, result) => { results[path] = { ...results[path], [name]: result }; };

  const begun = (check, state, trigger) => ({
    name: check.name, command: check.command, state, startedAt: now(), trigger,
  });

  /** Run one check to the end, keeping its result. Its own timeout, or the one in Settings. */
  async function runOne(path, check, trigger) {
    set(path, check.name, begun(check, 'running', trigger));
    onChange();
    save();
    let output = '';
    const onOutput = (text) => { output = (output + text).slice(-MAX_OUTPUT); };
    const timeoutMs = check.timeoutMs ?? settings().timeoutMs;
    const outcome = await runCommand({ command: check.command, cwd: path, timeoutMs, onOutput })
      .catch((error) => { onOutput(`${error.message}\n`); return { exitCode: null, timedOut: false }; });
    const passed = outcome.exitCode === 0 && !outcome.timedOut;
    set(path, check.name, {
      ...results[path][check.name],
      state: passed ? 'passed' : 'failed',
      exitCode: outcome.exitCode,
      finishedAt: now(),
      output,
      fingerprint: await fingerprint(path).catch(() => null),
      ...(outcome.timedOut ? { detail: `Stopped after ${duration(timeoutMs)}` } : {}),
    });
    // The page reads results from here, so it can hear now; the file catches up (saves queue up in order).
    onChange();
    save();
  }

  /**
   * Run `queue` in turn; a check that couldn't even be started still lets
   * the rest run. Then any trigger that came meanwhile has its turn.
   */
  async function runInTurn(path, queue, trigger) {
    for (const check of queue) {
      try {
        await runOne(path, check, trigger);
      } catch (error) {
        set(path, check.name, { ...results[path][check.name], state: 'failed', detail: error.message, finishedAt: now() });
        onChange();
      }
    }
    const next = waiting.get(path);
    waiting.delete(path);
    for (const later of next ?? []) await autoRun({ path, trigger: later });
  }

  /** Mark `queue` running and waiting, and run it in the background; resolves once that's saved. */
  async function launch(path, queue, trigger) {
    for (const check of queue.slice(1)) set(path, check.name, begun(check, 'queued', trigger));
    set(path, queue[0].name, begun(queue[0], 'running', trigger));
    runInTurn(path, queue, trigger);
    await save();
  }

  const isCurrent = (result, print) => (result?.state === 'passed' || result?.state === 'failed') && Boolean(print) && result.fingerprint === print;

  /**
   * A trigger (see check-triggers.js) for a worktree: run its repo's checks
   * set to run on it whose result isn't current. While its checks are
   * running, the trigger waits for them. Resolves to the names started.
   */
  async function autoRun({ path, trigger }) {
    const repo = (await getState()).repos.find((r) => r.worktrees.some((w) => w.path === path));
    const due = (repo && settings().commands[repo.name] || []).filter((c) => c.run === trigger);
    if (due.length === 0) return [];
    await load();
    if (Object.values(results[path] ?? {}).some(isBusy)) {
      waiting.set(path, new Set([...(waiting.get(path) ?? []), trigger]));
      return [];
    }
    const print = await fingerprint(path).catch(() => null);
    const queue = due.filter((c) => !isCurrent(results[path]?.[c.name], print));
    if (queue.length === 0) return [];
    await launch(path, queue, trigger);
    onChange();
    return queue.map((c) => c.name);
  }

  /**
   * Run check on a worktree: the check called `name`, or, without one, all of
   * its repo's checks in turn (Run all). Resolves at once, with what's running and waiting.
   */
  async function start(body) {
    const { path, name } = body ?? {};
    if (typeof path !== 'string' || (name !== undefined && typeof name !== 'string')) throw new ActionError(400, 'Expected { path: "<worktree path>", name?: "<check>" }');
    const repo = (await getState()).repos.find((r) => r.worktrees.some((w) => w.path === path));
    if (!repo) throw new ActionError(404, 'That folder is not one of your worktrees');
    const all = settings().commands[repo.name] ?? [];
    if (all.length === 0) throw new ActionError(409, `${repo.name} has no checks; add some in Settings › Checks`);
    const queue = name === undefined ? all : all.filter((c) => c.name === name);
    if (queue.length === 0) throw new ActionError(404, `${repo.name} has no check called ${name}; its checks are ${all.map((c) => c.name).join(', ')}`);
    await load();
    if (Object.values(results[path] ?? {}).some(isBusy)) throw new ActionError(409, 'A check is already running in that worktree');

    await launch(path, queue, 'manual');
    return { path, repoName: repo.name, checks: queue.map((c) => results[path][c.name]) };
  }

  /**
   * Each worktree's latest results, by path: a list in the order its repo's
   * checks are now, each saying whether it's out of date. Worktrees that are
   * gone, and checks the repo no longer has, are left out. `repos`, when the
   * caller has them, saves looking again.
   */
  async function current({ repos } = {}) {
    await load();
    const known = repos ?? (await getState()).repos;
    const commands = settings().commands;
    const prints = new Map();
    const printOf = (path) => {
      if (!prints.has(path)) prints.set(path, fingerprint(path).catch(() => null));
      return prints.get(path);
    };
    const entries = await Promise.all(known.flatMap((repo) => repo.worktrees.map(async ({ path }) => {
      const byName = results[path];
      if (!byName) return null;
      const shown = await Promise.all((commands[repo.name] ?? []).filter((c) => byName[c.name]).map(async (c) => {
        const { fingerprint: print, ...result } = byName[c.name];
        const finished = result.state === 'passed' || result.state === 'failed';
        const outOfDate = finished && Boolean(print) && (await printOf(path)) !== null && (await printOf(path)) !== print;
        return { ...result, name: c.name, outOfDate };
      }));
      return shown.length > 0 ? [path, shown] : null;
    })));
    return Object.fromEntries(entries.filter(Boolean));
  }

  /** Each repo's check names, in order. */
  const names = () => Object.fromEntries(Object.entries(settings().commands).map(([repo, checks]) => [repo, checks.map((c) => c.name)]));

  /** Each repo's checks and when each runs by itself: { repo: { name: run } }. */
  const modes = () => Object.fromEntries(Object.entries(settings().commands).map(([repo, checks]) => [repo, Object.fromEntries(checks.map((c) => [c.name, c.run]))]));

  /** The repos with a check that runs by itself, for the triggers to watch. */
  const watchedRepos = () => Object.entries(settings().commands).filter(([, checks]) => checks.some((c) => c.run !== 'manual')).map(([repo]) => repo);

  return {
    start, autoRun, results: current, names, modes, watchedRepos,
  };
}
