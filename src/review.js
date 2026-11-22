import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { ActionError } from './errors.js';
import { run } from './exec.js';
import { writePrivateFile } from './json-store.js';
import { taskWorktrees } from './task-links.js';
import { freeWindowName, runInWindow } from './task-session.js';

/*
 * Review: a second Claude reads a task's work and says whether it does what
 * the task asks. It is read-only (its settings deny editing, and anything
 * beyond reading and git history asks you), runs in its own tmux window in
 * the worktree, and is told explicit criteria: the task, its notes, its
 * checks, and what to compare with. A reviewer with no criteria would just
 * agree. switchyard chooses its session id, so the verdict is read back from
 * its transcript whether it is still running or has ended.
 */

// The prompt is typed after `claude`, like New task's: one line, at most this long.
const MAX_PROMPT = 2000;
// How long a review with no session or reply yet still counts as starting.
const STARTING_MS = 2 * 60_000;
const VERDICT = /^\s*verdict:\s*(pass|changes)\b/i;

/** What a reviewer may do without asking, and may never do. */
export const REVIEWER_SETTINGS = Object.freeze({
  permissions: Object.freeze({
    allow: Object.freeze([
      'Read', 'Grep', 'Glob', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git status:*)',
      'Bash(cat:*)', 'Bash(ls:*)', 'Bash(head:*)', 'Bash(tail:*)', 'Bash(wc:*)',
    ]),
    deny: Object.freeze(['Edit', 'Write', 'NotebookEdit']),
  }),
});

/** 'passed' or 'changes' from the start of a reviewer's reply; null when it gave no verdict. */
export function parseVerdict(text) {
  const [, word] = VERDICT.exec(text ?? '') ?? [];
  if (!word) return null;
  return word.toLowerCase() === 'pass' ? 'passed' : 'changes';
}

const oneLine = (text) => String(text ?? '').split(/\s*\n\s*/).filter(Boolean).join(' ');
// A sentence's own full stop, taken off so the prompt adds just one.
const sentence = (text) => oneLine(text).replace(/[.\s]+$/, '');
const checkWords = (checks) => checks.map((c) => `${c.name} ${c.state}${c.outOfDate ? ' (out of date)' : ''}`).join(', ');

/** What the reviewer is told: the criteria, how to see the work, and how to answer. Notes are cut to fit. */
export function reviewPrompt({ task, branch, base, checks }) {
  const head = `Review the work on branch ${branch} in this folder for the task: ${sentence(task.title)}.`;
  const tail = [
    checks.length > 0 && `Its checks: ${checkWords(checks)}.`,
    `See the work with git diff ${base}...HEAD and git log ${base}..HEAD, and read the files it touches.`,
    'Judge it only against the task and its notes: does it do what they ask, correctly, without breaking anything? Don\'t change any files.',
    'Start your final reply with VERDICT: PASS or VERDICT: CHANGES, then the reasons, most important first.',
  ].filter(Boolean).join(' ');
  const room = MAX_PROMPT - head.length - tail.length - ' Notes: . '.length;
  const notes = sentence(task.notes);
  const fitted = notes.length > room ? `${notes.slice(0, Math.max(0, room - 1))}…` : notes;
  return [head, fitted && `Notes: ${fitted}.`, tail].filter(Boolean).join(' ');
}

/** A repo's default branch, as origin has it (origin/main); else the branch its main checkout is on. */
export async function gitDefaultBranch(mainPath) {
  const git = (args) => run('git', ['-C', mainPath, ...args]).then((out) => out.trim());
  return git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
    .catch(() => git(['rev-parse', '--abbrev-ref', 'HEAD']))
    .catch(() => 'main');
}

/** The branch the work started from: the parent's in that repo for a subtask, else the repo's default branch. */
async function baseFor(task, tasks, repo, repos, defaultBranch) {
  const parent = task.parentId ? tasks.find((t) => t.id === task.parentId) : null;
  const parentWork = parent ? taskWorktrees(parent, repos).find((w) => w.repo.mainPath === repo.mainPath) : null;
  return parentWork?.worktree.branch ?? defaultBranch(repo.mainPath);
}

/**
 * The tasks' work lines, each with `review`, its latest review's status, and with the reviewer's session
 * taken out of the work's own sessions (so its controls, and a lead, don't mistake it for the work's agent).
 * `statuses` is { taskId: [status…] } (see status below).
 */
export function withReviews(tasks, statuses) {
  return tasks.map((task) => {
    const reviews = statuses[task.id] ?? [];
    if (reviews.length === 0) return task;
    const reviewerIds = new Set(reviews.map((r) => r.sessionId));
    return {
      ...task,
      work: task.work.map((link) => {
        const review = reviews.find((r) => r.path === link.path);
        if (!review) return link;
        const session = (link.live ?? []).find((s) => s.sessionId === review.sessionId) ?? null;
        return {
          ...link,
          live: (link.live ?? []).filter((s) => !reviewerIds.has(s.sessionId)),
          recent: (link.recent ?? []).filter((s) => !reviewerIds.has(s.sessionId)),
          review: { ...review, session },
        };
      }),
    };
  });
}

/**
 * @param {{ taskHub: { list, noteReview }, tmux, provider: () => object, getRepos: () => Promise<object[]>,
 *   checkResults: (opts: { repos }) => Promise<object>, readSession: (cwd, sessionId) => Promise<object|null>,
 *   defaultBranch?: (mainPath: string) => Promise<string>, dir: string, newSessionId?: () => string, now?: () => number,
 *   starts?: { track }, limit?: { check } }} deps
 */
export function createReviews({
  taskHub, tmux, provider, getRepos, checkResults, readSession, defaultBranch = gitDefaultBranch, dir, newSessionId = randomUUID, now = Date.now,
  starts = { track: () => {} }, limit = { check: async () => {} }, withHooks = (settings) => settings,
}) {
  const settingsFile = join(dir, 'reviewer.settings.json');

  /**
   * A review's status: reviewing while its session runs with no verdict yet (needs you while it shows a
   * prompt); then passed, changes, or no verdict.
   */
  async function status(review, liveSessions) {
    const session = liveSessions.find((s) => s.sessionId === review.sessionId);
    const live = Boolean(session);
    const summary = (await readSession(review.path, review.sessionId))?.lastReply ?? null;
    const verdict = parseVerdict(summary);
    // Just started, Claude may not have shown up yet (or still be asking to trust the folder).
    const starting = !summary && now() - review.startedAt < STARTING_MS;
    const state = verdict ?? (session?.needsYou ? 'needs you' : live || starting ? 'reviewing' : 'no verdict');
    return { ...review, live, state, summary };
  }

  return {
    status,

    /** Each task's reviews' statuses, by task id. */
    async forTasks(tasks, liveSessions = []) {
      const entries = await Promise.all(tasks.filter((t) => t.reviews?.length > 0).map(async (task) => [
        task.id, await Promise.all(task.reviews.map((review) => status(review, liveSessions))),
      ]));
      return Object.fromEntries(entries);
    },

    /** Start a reviewer on one of a task's worktrees: { id, path }. */
    async start(body) {
      const tasks = await taskHub.list();
      const task = tasks.find((t) => t.id === body?.id);
      if (!task) throw new ActionError(404, 'That task is not there any more');
      if (task.closedAs) throw new ActionError(409, `That task is ${task.closedAs}; reopen it to review its work`);
      const repos = await getRepos();
      const found = taskWorktrees(task, repos).find(({ worktree }) => worktree.path === body?.path);
      if (!found) throw new ActionError(404, 'That folder is not one of this task\'s worktrees');
      const { repo, worktree } = found;
      const running = (task.reviews ?? []).find((r) => r.path === worktree.path);
      if (running && (worktree.agents?.live ?? []).some((s) => s.sessionId === running.sessionId)) {
        throw new ActionError(409, 'A review of this worktree is already running');
      }
      const agent = provider();
      if (!agent.takesLaunchOptions) throw new ActionError(400, `${agent.label} can't review`);
      await limit.check();
      const checks = (await checkResults({ repos }))[worktree.path] ?? [];
      const base = await baseFor(task, tasks, repo, repos, defaultBranch);
      await writePrivateFile(dir, settingsFile, `${JSON.stringify(withHooks(REVIEWER_SETTINGS), null, 2)}\n`);
      const sessionId = newSessionId();
      const command = agent.launchCommand(reviewPrompt({ task, branch: worktree.branch, base, checks }), {
        name: `Review · ${oneLine(task.title)}`, sessionId, permissionMode: 'manual', settings: settingsFile,
      });
      const window = await freeWindowName(tmux, `review-${basename(worktree.path)}`);
      const opened = await runInWindow(tmux, { name: window, cwd: worktree.path, command });
      // Watched like New task's start (see task-starts.js): a folder Claude hasn't trusted asks on the task's row.
      starts.track({ path: worktree.path, place: opened.place, pane: opened.pane, command: agent.command });
      await taskHub.noteReview(task.id, { path: worktree.path, sessionId, startedAt: now() });
      return { sessionId, window };
    },
  };
}
