import { watch as fsWatch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { getStatuses as gitStatuses } from './git.js';

// Even with no file events, rerun git status this often, in case an event was missed.
const RECHECK_MS = 5 * 60_000;
// The only files under .git that change what git status reports; tools write plenty of
// others (objects, logs, locks, watchman cookies), which the periodic recheck covers anyway.
const REPO_WIDE_GIT_PATHS = /^(refs\/.*|packed-refs|config)$/; // branch tips and upstreams: every worktree's ahead/behind
const WORKTREE_GIT_FILES = /^(index|HEAD)$/;
const LINKED_GIT_PATH = /^worktrees\/([^/]+)\/(.+)$/;
// Watchman's sync files, written into watched folders every minute or so.
const IGNORED_FILES = /(^|\/)\.watchman-cookie-[^/]*$/;

const isInside = (path, dir) => path === dir || path.startsWith(dir.endsWith(sep) ? dir : `${dir}${sep}`);

/**
 * Runs git status only where something changed. Each worktree is watched with
 * a recursive fs.watch (FSEvents on macOS); a worktree is rescanned when a file
 * in it changes, when its git data does, or when its last status is older than
 * `recheckMs`. Anything that can't be watched is simply scanned every time.
 *
 * A linked worktree keeps its index and HEAD under <main>/.git/worktrees/<name>,
 * so events there are routed back to that worktree. A ref change can move any
 * worktree's ahead/behind count, so it rescans the whole repo.
 */
export function createStatusTracker({
  getStatuses = gitStatuses,
  watch = fsWatch,
  readGitFile = (path) => readFile(path, 'utf8'),
  now = Date.now,
  recheckMs = RECHECK_MS,
} = {}) {
  const watchers = new Map(); // watched root -> FSWatcher
  const scans = new Map(); // worktree path -> { status, scannedAt, seenEvent }
  // Events are ordered by a counter, not the clock: a change and a scan can share a millisecond.
  const changedAt = new Map(); // worktree path -> number of the last relevant event
  let eventCount = 0;
  let layout = { repos: [], worktrees: [], gitDirs: new Map(), roots: [] };

  const markChanged = (paths) => {
    eventCount += 1;
    paths.forEach((path) => changedAt.set(path, eventCount));
  };

  const repoOf = (path) => layout.repos.find((repo) => repo.worktrees.some((w) => w.path === path));
  const repoWorktrees = (repo) => repo?.worktrees.map((w) => w.path) ?? [];

  /** The worktrees an event at `absPath` can affect. */
  function affected(absPath) {
    const repo = layout.repos.find((r) => isInside(absPath, join(r.mainPath, '.git')));
    if (repo) {
      const rel = absPath.slice(join(repo.mainPath, '.git').length + 1);
      if (REPO_WIDE_GIT_PATHS.test(rel)) return repoWorktrees(repo);
      if (WORKTREE_GIT_FILES.test(rel)) return [repo.mainPath];
      const linked = rel.match(LINKED_GIT_PATH);
      if (!linked || !WORKTREE_GIT_FILES.test(linked[2])) return [];
      const owner = layout.gitDirs.get(join(repo.mainPath, '.git', 'worktrees', linked[1]));
      return owner ? [owner] : repoWorktrees(repo);
    }
    if (IGNORED_FILES.test(absPath)) return [];
    // A file in a checkout belongs to the deepest worktree containing it.
    const owner = layout.worktrees
      .filter((path) => isInside(absPath, path))
      .reduce((best, path) => (!best || path.length > best.length ? path : best), null);
    return owner ? [owner] : [];
  }

  function onEvent(root, filename) {
    if (!filename) {
      markChanged(repoWorktrees(repoOf(root)));
      return;
    }
    markChanged(affected(resolve(root, filename.toString())));
  }

  function startWatching(root) {
    try {
      const watcher = watch(root, { recursive: true, persistent: false }, (_type, filename) => onEvent(root, filename));
      watcher.on('error', () => {
        watcher.close();
        watchers.delete(root);
        markChanged(repoWorktrees(repoOf(root)));
      });
      watcher.unref?.();
      watchers.set(root, watcher);
    } catch {
      // Unwatchable (missing, permissions): isDirty treats it as always changed.
    }
  }

  /** Map each linked worktree's git dir back to the worktree. */
  async function readGitDirs(worktrees) {
    const entries = await Promise.all(worktrees.map(async (path) => {
      try {
        const match = (await readGitFile(join(path, '.git'))).match(/^gitdir:\s*(.+)$/m);
        if (!match) return null;
        const gitDir = match[1].trim();
        return [isAbsolute(gitDir) ? gitDir : resolve(path, gitDir), path];
      } catch {
        return null; // a main checkout's .git is a directory
      }
    }));
    return new Map(entries.filter(Boolean));
  }

  /** Watch the given repos' worktrees, and stop watching any that are gone. */
  async function track(repos) {
    const live = repos.map((repo) => ({
      mainPath: repo.mainPath,
      worktrees: repo.worktrees.filter((w) => !w.prunable && !w.bare),
    }));
    const worktrees = live.flatMap((repo) => repo.worktrees.map((w) => w.path));
    // One recursive watcher per outermost folder; a nested worktree is already covered.
    const roots = [...worktrees]
      .sort((a, b) => a.length - b.length)
      .reduce((kept, path) => (kept.some((root) => isInside(path, root)) ? kept : [...kept, path]), []);
    layout = { repos: live, worktrees, gitDirs: await readGitDirs(worktrees), roots };

    for (const [root, watcher] of watchers) {
      if (!roots.includes(root)) {
        watcher.close();
        watchers.delete(root);
      }
    }
    roots.filter((root) => !watchers.has(root)).forEach(startWatching);
    const known = new Set(worktrees);
    [...scans.keys()].filter((path) => !known.has(path)).forEach((path) => {
      scans.delete(path);
      changedAt.delete(path);
    });
  }

  function isDirty(path, time) {
    const scan = scans.get(path);
    if (!scan) return true;
    if (!layout.roots.some((root) => watchers.has(root) && isInside(path, root))) return true;
    if (time - scan.scannedAt >= recheckMs) return true;
    // Changed after the last scan started (including during it, which may have missed it).
    return (changedAt.get(path) ?? 0) > scan.seenEvent;
  }

  /** Status for each worktree, in order: cached where nothing changed, fresh otherwise. */
  async function statuses(worktrees) {
    const startedAt = now();
    const seenEvent = eventCount;
    const dirty = worktrees.filter((w) => isDirty(w.path, startedAt));
    const fresh = await getStatuses(dirty);
    dirty.forEach((w, i) => scans.set(w.path, { status: fresh[i], scannedAt: startedAt, seenEvent }));
    // Re-create watchers that failed, so these worktrees stop being scanned every time.
    layout.roots.filter((root) => !watchers.has(root)).forEach(startWatching);
    return worktrees.map((w) => scans.get(w.path)?.status ?? null);
  }

  function close() {
    watchers.forEach((watcher) => watcher.close());
    watchers.clear();
  }

  return { track, statuses, close };
}
