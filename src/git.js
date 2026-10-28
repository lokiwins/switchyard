import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { mapLimit, run } from './exec.js';

const GIT_CONCURRENCY = 8;

/**
 * @typedef {{ path: string, head: string|null, branch: string|null, detached: boolean,
 *   bare: boolean, locked: boolean, prunable: boolean }} Worktree
 */

const WORKTREE_LINE_HANDLERS = {
  worktree: (value) => ({ path: value }),
  HEAD: (value) => ({ head: value }),
  branch: (value) => ({ branch: value.replace(/^refs\/heads\//, '') }),
  detached: () => ({ detached: true }),
  bare: () => ({ bare: true }),
  locked: () => ({ locked: true }),
  prunable: () => ({ prunable: true }),
};

const EMPTY_WORKTREE = {
  path: null, head: null, branch: null, detached: false, bare: false, locked: false, prunable: false,
};

/** @returns {Worktree[]} */
export function parseWorktreePorcelain(text) {
  return text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => block.split('\n').reduce((entry, line) => {
      const [key, ...rest] = line.split(' ');
      const handler = WORKTREE_LINE_HANDLERS[key];
      return handler ? { ...entry, ...handler(rest.join(' ')) } : entry;
    }, EMPTY_WORKTREE))
    .filter((entry) => entry.path);
}

/** Parse `git status --porcelain=v2 --branch` into counts. */
export function parseStatusV2(text) {
  return text.split('\n').filter(Boolean).reduce((status, line) => {
    if (line.startsWith('# branch.upstream ')) {
      return { ...status, upstream: line.slice('# branch.upstream '.length) };
    }
    if (line.startsWith('# branch.ab ')) {
      const [, ahead, behind] = line.match(/\+(\d+) -(\d+)/) ?? [];
      return { ...status, ahead: Number(ahead ?? 0), behind: Number(behind ?? 0) };
    }
    if (line.startsWith('? ')) return { ...status, untracked: status.untracked + 1 };
    if (line.startsWith('u ')) return { ...status, conflicted: status.conflicted + 1 };
    if (line.startsWith('1 ') || line.startsWith('2 ')) return { ...status, changed: status.changed + 1 };
    return status;
  }, { upstream: null, ahead: 0, behind: 0, changed: 0, untracked: 0, conflicted: 0 });
}

/** Parse `git for-each-ref` output (refname, unix time, subject; tab separated). */
export function parseBranchRefs(text) {
  return new Map(text.split('\n').filter(Boolean).map((line) => {
    const [name, timestamp, ...subject] = line.split('\t');
    return [name, { committedAt: Number(timestamp) * 1000, subject: subject.join('\t') }];
  }));
}

async function gitDirKind(dir) {
  try {
    const info = await stat(join(dir, '.git'));
    return info.isDirectory() ? 'main' : 'linked';
  } catch {
    return null;
  }
}

async function listCandidateRepos(roots) {
  const perRoot = await Promise.all(roots.map(async (root) => {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    const dirs = [root, ...entries.filter((e) => e.isDirectory()).map((e) => join(root, e.name))];
    const kinds = await Promise.all(dirs.map(gitDirKind));
    return dirs.map((dir, i) => ({ dir, kind: kinds[i] })).filter((c) => c.kind);
  }));
  return perRoot.flat();
}

async function listWorktrees(dir) {
  const output = await run('git', ['-C', dir, 'worktree', 'list', '--porcelain']);
  return parseWorktreePorcelain(output);
}

/**
 * Find every repository under the roots, grouped by main worktree. Main
 * checkouts are listed first so linked worktrees beside them are not re-queried.
 */
export async function discoverRepos(roots) {
  const candidates = await listCandidateRepos(roots);
  const ordered = [...candidates.filter((c) => c.kind === 'main'), ...candidates.filter((c) => c.kind === 'linked')];
  const seenPaths = new Set();
  const repos = [];
  const errors = [];

  for (const { dir } of ordered) {
    if (seenPaths.has(dir)) continue;
    try {
      const worktrees = await listWorktrees(dir);
      worktrees.forEach((w) => seenPaths.add(w.path));
      const mainPath = worktrees[0]?.path ?? dir;
      repos.push({ name: basename(mainPath), mainPath, worktrees });
    } catch (error) {
      errors.push({ source: 'git', message: error.message });
    }
  }
  return { repos, errors };
}

export async function getRemoteUrl(repoPath) {
  try {
    return (await run('git', ['-C', repoPath, 'remote', 'get-url', 'origin'])).trim();
  } catch {
    return null;
  }
}

export async function getBranchRefs(repoPath) {
  const output = await run('git', [
    '-C', repoPath, 'for-each-ref',
    '--format=%(refname:short)%09%(committerdate:unix)%09%(subject)', 'refs/heads',
  ]);
  return parseBranchRefs(output);
}

async function getStatus(worktree) {
  if (worktree.prunable || worktree.bare) return null;
  try {
    const output = await run('git', ['-C', worktree.path, 'status', '--porcelain=v2', '--branch']);
    return parseStatusV2(output);
  } catch (error) {
    return { error: error.message };
  }
}

/** Status for each worktree, in the same order. */
export function getStatuses(worktrees) {
  return mapLimit(worktrees, GIT_CONCURRENCY, getStatus);
}
