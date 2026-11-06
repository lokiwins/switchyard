import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { branchFromTask } from '../public/branch-name.js';
import { ActionError } from './errors.js';
import { run } from './exec.js';
import { shellQuoteAlways } from './shell.js';
import { hasControlCharacters, windowNameFor } from './tmux.js';

// git's own check runs too; this keeps names to characters that need no quoting anywhere.
const BRANCH_PATTERN = /^(?![-./])[A-Za-z0-9._/-]{1,100}(?<![./])$/;
const MAX_PROMPT_LENGTH = 2000;
// A branch named after the task gets -2, -3… when taken, up to this.
const MAX_NAME_TRIES = 20;
// Fetching the default branch is a nicety; a slow or offline remote shouldn't hold up the task.
const FETCH_TIMEOUT_MS = 15_000;
// switchyard runs in your terminal: a credential prompt there would hang the request instead.
const NO_PROMPT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0' };

// Every task gets a window (tab) in this one tmux session.
export const TASK_SESSION = 'switchyard';

const runGit = (args, options) => run('git', args, options);

/** { repo, branch, prompt } from the New task form. The task is required; the branch, null when left empty, is optional. */
export function parseNewTask(body) {
  const repo = body?.repo;
  const branch = typeof body?.branch === 'string' ? body.branch.trim() : '';
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (typeof repo !== 'string' || !repo) throw new ActionError(400, 'Choose a repository');
  if (!prompt) throw new ActionError(400, 'Say what the task is');
  if (prompt.length > MAX_PROMPT_LENGTH || hasControlCharacters(prompt) || prompt.startsWith('-')) {
    throw new ActionError(400, `The task must be one line of text, up to ${MAX_PROMPT_LENGTH} characters, not starting with "-"`);
  }
  if (branch && !BRANCH_PATTERN.test(branch)) {
    throw new ActionError(400, 'A branch name uses letters, digits, ".", "_", "-" and "/", and cannot start with "-"');
  }
  return { repo, branch: branch || null, prompt };
}

/** Beside the main checkout, named <repo>-<last branch segment>, like "my-repo-login-bug" for "fix/login-bug". */
export function worktreePathFor(repo, branch) {
  return join(dirname(repo.mainPath), `${repo.name}-${branch.split('/').pop()}`);
}

export function claudeCommand(prompt) {
  return `claude ${shellQuoteAlways(prompt)}`;
}

/**
 * New task: a worktree on a branch (named after the task unless you name
 * one), and a window in the switchyard tmux session running Claude Code on
 * the task. Repos must be ones switchyard discovered; git and tmux get every
 * value as its own argument.
 */
export function createTaskService({ stateService, tmux, git = runGit, exists = existsSync }) {
  const gitIn = (dir, args, options) => git(['-C', dir, ...args], options);

  async function refExists(dir, ref) {
    try {
      await gitIn(dir, ['show-ref', '--verify', '--quiet', ref]);
      return true;
    } catch {
      return false;
    }
  }

  /** origin's default branch, freshly fetched when possible; HEAD when there is no origin. */
  async function baseRef(dir) {
    let remoteHead;
    try {
      remoteHead = (await gitIn(dir, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])).trim();
    } catch {
      return 'HEAD';
    }
    const [remote, ...rest] = remoteHead.split('/');
    await gitIn(dir, ['fetch', '--quiet', remote, rest.join('/')], { timeout: FETCH_TIMEOUT_MS, env: NO_PROMPT_ENV }).catch(() => {});
    return remoteHead;
  }

  async function checkBranchName(dir, branch) {
    try {
      await gitIn(dir, ['check-ref-format', '--branch', branch]);
    } catch {
      throw new ActionError(400, `"${branch}" is not a valid branch name`);
    }
  }

  async function addWorktree(dir, path, branch) {
    await gitIn(dir, ['worktree', 'add', ...await worktreeArgs(dir, path, branch)]).catch((error) => {
      throw new ActionError(409, `Could not create the worktree: ${error.message}`);
    });
  }

  /** Check out your branch; else track origin's branch of that name; else branch from the default branch. */
  async function worktreeArgs(dir, path, branch) {
    if (await refExists(dir, `refs/heads/${branch}`)) return [path, branch];
    if (await refExists(dir, `refs/remotes/origin/${branch}`)) return ['--track', '-b', branch, path, `origin/${branch}`];
    // --no-track: a branch made from origin/main must not push to main.
    return ['--no-track', '-b', branch, path, await baseRef(dir)];
  }

  /** Whether a new task could use `branch`: no such branch here or on origin, and no folder or tab of its name. */
  async function isFree(repo, branch) {
    const path = worktreePathFor(repo, branch);
    if (exists(path)) return false;
    if (await refExists(repo.mainPath, `refs/heads/${branch}`)) return false;
    if (await refExists(repo.mainPath, `refs/remotes/origin/${branch}`)) return false;
    return !(await tmux.hasWindow(TASK_SESSION, windowNameFor(basename(path))));
  }

  /** A new branch named after the task: its words, then -2, -3… if that's taken. */
  async function branchForTask(repo, prompt) {
    const base = branchFromTask(prompt);
    for (let n = 1; n <= MAX_NAME_TRIES; n += 1) {
      const branch = n === 1 ? base : `${base}-${n}`;
      if (await isFree(repo, branch)) return branch;
    }
    throw new ActionError(409, `Branches named like ${base} are all taken; give the branch a name`);
  }

  /** Undo a half-started task so a retry starts clean; the branch is kept, and a retry checks it out. */
  async function rollBack(dir, path, window) {
    if (window) await tmux.killWindow(window).catch(() => {});
    await gitIn(dir, ['worktree', 'remove', path]).catch(() => {});
  }

  /** Open the task's window and type claude into it; on failure, undo what this task created. */
  async function startClaude(mainPath, path, name, prompt) {
    let window = null;
    try {
      const opened = await tmux.newWindow({ session: TASK_SESSION, name, cwd: path });
      window = opened.window;
      await tmux.sendLine(opened.pane, claudeCommand(prompt));
    } catch (error) {
      await rollBack(mainPath, path, window);
      throw error;
    }
  }

  async function startTask(body) {
    const { repo: mainPath, branch: chosen, prompt } = parseNewTask(body);
    const state = await stateService.getState();
    const repo = state.repos.find((r) => r.mainPath === mainPath);
    if (!repo) throw new ActionError(404, 'That folder is not one of your repositories');
    const branch = chosen ?? await branchForTask(repo, prompt);
    await checkBranchName(mainPath, branch);
    const path = worktreePathFor(repo, branch);
    if (exists(path)) throw new ActionError(409, `${path} already exists`);
    const window = windowNameFor(basename(path));
    if (await tmux.hasWindow(TASK_SESSION, window)) throw new ActionError(409, `The ${TASK_SESSION} tmux session already has a window named ${window}`);

    await addWorktree(mainPath, path, branch);
    await startClaude(mainPath, path, window, prompt);
    return { path, branch, session: TASK_SESSION, window };
  }

  return { startTask };
}
