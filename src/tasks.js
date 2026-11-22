import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { branchFromTask } from '../public/branch-name.js';
import { ActionError } from './errors.js';
import { run } from './exec.js';
import { TASK_SESSION, runInWindow } from './task-session.js';
import { hasControlCharacters, windowNameFor } from './tmux.js';
import { WORKER_MODES } from './settings.js';

// git's own check runs too; this keeps names to characters that need no quoting anywhere.
const BRANCH_PATTERN = /^(?![-./])[A-Za-z0-9._/-]{1,100}(?<![./])$/;
const MAX_PROMPT_LENGTH = 2000;
// A branch named after the task gets -2, -3… when taken, up to this.
const MAX_NAME_TRIES = 20;
// Fetching the default branch is a nicety; a slow or offline remote shouldn't hold up the task.
const FETCH_TIMEOUT_MS = 15_000;
// switchyard runs in your terminal: a credential prompt there would hang the request instead.
const NO_PROMPT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0' };


const runGit = (args, options) => run('git', args, options);

/**
 * { repo, branch, prompt, provider, base } from the New task form. The task
 * is required; the branch, null when left empty, the agent provider's id,
 * null for the default, and the local branch to start from (a subtask's
 * parent's), null for the default branch, are optional.
 */
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
  if (body.provider !== undefined && body.provider !== null && typeof body.provider !== 'string') throw new ActionError(400, 'Expected provider to be an agent id');
  const base = body.base ?? null;
  if (base !== null && (typeof base !== 'string' || !BRANCH_PATTERN.test(base))) throw new ActionError(400, 'The branch to start from must be a branch name');
  return {
    repo, branch: branch || null, prompt, provider: body.provider ?? null, base,
  };
}

/** The launch options given, checked: a permission mode from the fixed list, and the files' paths. */
function launchOptions({ permissionMode = null, settings = null, mcpConfig = null }) {
  // "claude" (your Claude default) is sent as no mode at all; bypassPermissions and the like never.
  if (permissionMode !== null && (permissionMode === 'claude' || !WORKER_MODES.includes(permissionMode))) {
    throw new ActionError(400, `${permissionMode} is not a permission mode a worker can start in`);
  }
  return Object.fromEntries(Object.entries({ permissionMode, settings, mcpConfig }).filter(([, value]) => value));
}

/** Beside the main checkout, named <repo>-<last branch segment>, like "my-repo-login-bug" for "fix/login-bug". */
export function worktreePathFor(repo, branch) {
  return join(dirname(repo.mainPath), `${repo.name}-${branch.split('/').pop()}`);
}

/**
 * New task: a worktree on a branch (named after the task unless you name
 * one), and a window in the switchyard tmux session running the agent (Claude
 * Code unless another provider is asked for) on the task. Repos must be ones switchyard discovered; git and tmux get every
 * value as its own argument.
 */
export function createTaskService({
  stateService, tmux, agents, starts = { track: () => {} }, git = runGit, exists = existsSync, limit = { check: async () => {} },
  // The settings file a session with none of its own starts with: switchyard's session event hooks (see session-events.js).
  defaultSettings = async () => null,
}) {
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

  async function addWorktree(dir, path, branch, base) {
    await gitIn(dir, ['worktree', 'add', ...await worktreeArgs(dir, path, branch, base)]).catch((error) => {
      throw new ActionError(409, `Could not create the worktree: ${error.message}`);
    });
  }

  /** Check out your branch; else track origin's branch of that name; else branch from `base` (a local branch) or the default branch. */
  async function worktreeArgs(dir, path, branch, base) {
    if (await refExists(dir, `refs/heads/${branch}`)) return [path, branch];
    if (await refExists(dir, `refs/remotes/origin/${branch}`)) return ['--track', '-b', branch, path, `origin/${branch}`];
    // --no-track: a branch made from origin/main (or another task's branch) must not push to it.
    return ['--no-track', '-b', branch, path, base ?? await baseRef(dir)];
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
  async function rollBack(dir, path) {
    await gitIn(dir, ['worktree', 'remove', path]).catch(() => {});
  }

  /** Open the task's window and start the agent in it; on failure, remove the worktree too, so a retry starts clean. */
  async function startAgent(provider, mainPath, path, name, prompt, options) {
    try {
      return await runInWindow(tmux, { name, cwd: path, command: provider.launchCommand(prompt, options) });
    } catch (error) {
      await rollBack(mainPath, path);
      throw error;
    }
  }

  /**
   * `launch` is how a lead or a worker starts (see hub-start.js): { permissionMode, settings, mcpConfig }.
   * It comes from switchyard itself, never from the page's body.
   */
  async function startTask(body, launch = {}) {
    const {
      repo: mainPath, branch: chosen, prompt, provider: providerId, base,
    } = parseNewTask(body);
    const provider = providerId === null ? agents.default : agents.get(providerId);
    const given = launchOptions(launch);
    if (Object.keys(given).length > 0 && !provider.takesLaunchOptions) throw new ActionError(400, `${provider.label} can't be started as a lead or a worker`);
    const settings = provider.takesLaunchOptions && !given.settings ? await defaultSettings() : null;
    const options = settings ? { ...given, settings } : given;
    // Settings › Agents › Most agents running at once (see agent-limit.js), before any worktree is made.
    await limit.check();
    const state = await stateService.getState();
    const repo = state.repos.find((r) => r.mainPath === mainPath);
    if (!repo) throw new ActionError(404, 'That folder is not one of your repositories');
    const branch = chosen ?? await branchForTask(repo, prompt);
    await checkBranchName(mainPath, branch);
    const path = worktreePathFor(repo, branch);
    if (exists(path)) throw new ActionError(409, `${path} already exists`);
    const window = windowNameFor(basename(path));
    if (await tmux.hasWindow(TASK_SESSION, window)) throw new ActionError(409, `The ${TASK_SESSION} tmux session already has a window named ${window}`);
    if (base && !await refExists(mainPath, `refs/heads/${base}`)) throw new ActionError(409, `The branch to start from, ${base}, isn't in ${repo.name}`);

    await addWorktree(mainPath, path, branch, base);
    const started = await startAgent(provider, mainPath, path, window, prompt, options);
    // Watched until its session shows up: it may first ask whether to trust the folder, or quit.
    starts.track({ path, place: started.place, pane: started.pane, command: provider.command });
    return { path, branch, session: TASK_SESSION, window, provider: provider.id };
  }

  return { startTask };
}
