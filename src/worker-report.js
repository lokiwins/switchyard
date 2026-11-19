import { run } from './exec.js';

/*
 * A worker's work as its lead needs it (see lead-tools.js): the commits on
 * the worker's branch that aren't on the lead's, what they change all
 * together, and what isn't committed yet. Read with git, from the worker's
 * worktree; nothing is changed.
 */

export const MAX_COMMITS = 20;
const MAX_UNCOMMITTED = 50;
const SHORTSTAT = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/;

const gitIn = (path, args) => run('git', ['-C', path, ...args]);
const lines = (text) => text.split('\n').filter(Boolean);

/** "2 files changed, 3 insertions(+)" as numbers; none when nothing changed. */
function parseShortstat(text) {
  const [, files, insertions, deletions] = SHORTSTAT.exec(text) ?? [];
  return { files: Number(files ?? 0), insertions: Number(insertions ?? 0), deletions: Number(deletions ?? 0) };
}

/** The worker's commits since it left `base` (newest first, capped), and what they change, compared with where it branched. */
async function againstBase(path, base) {
  // One more than shown, to know whether there are more.
  const log = lines(await gitIn(path, ['log', `--max-count=${MAX_COMMITS + 1}`, '--format=%h%x09%s', `${base}..HEAD`]));
  const commits = log.slice(0, MAX_COMMITS).map((line) => {
    const [sha, ...subject] = line.split('\t');
    return { sha, subject: subject.join('\t') };
  });
  // Three dots: from where the worker branched, so the lead's later commits don't count as the worker's.
  const changes = parseShortstat(await gitIn(path, ['diff', '--shortstat', `${base}...HEAD`]));
  return { commits, moreCommits: log.length > MAX_COMMITS, changes };
}

/**
 * @param {{ path: string, base: string|null }} args the worker's worktree, and the lead's branch in its repo (null when none).
 * @returns {Promise<object>} { base, commits, moreCommits, changes, uncommitted }, or { base, error } when git fails.
 */
export async function gitReport({ path, base }) {
  try {
    const status = lines(await gitIn(path, ['status', '--porcelain=v1', '--untracked-files=normal']));
    const uncommitted = status.slice(0, MAX_UNCOMMITTED);
    if (!base) return { base: null, commits: null, moreCommits: false, changes: null, uncommitted };
    return { base, ...await againstBase(path, base), uncommitted };
  } catch (error) {
    return { base, error: error.message };
  }
}
