import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fillInstructions, parsePrVerdict } from '../shared/pr-review.ts';
import { ActionError } from './errors.js';
import { run } from './exec.js';
import { fetchPrForReview, fetchPrState } from './github.js';
import { createJsonFile, writePrivateFile } from './json-store.js';
import { parsePrRef } from './prs.js';
import { REVIEWER_SETTINGS } from './review.js';
import { freeWindowName, runInWindow } from './task-session.js';

/*
 * PR review: a read-only Claude reviews a pull request that asks for your
 * review, in its own checkout of the PR (a detached worktree next to the
 * repo's other worktrees, at the PR's head), told what Settings › Review
 * Agent Configuration says with the PR's facts filled in. It never posts to
 * GitHub: it reports back here, and posting is yours (or a lead's) to do.
 * One review per PR at a time; Review again moves the same checkout to the
 * PR's newest head. The checkout goes when you Discard it, or once the PR is
 * merged or closed (sweep). switchyard chooses the session id, so the report
 * and its verdict are read back from the transcript, running or ended.
 */

/** How often reviews of merged or closed PRs are looked for (one gh call per review). */
export const PR_REVIEW_SWEEP_MS = 15 * 60_000;
// How long a review with no session or reply yet still counts as starting.
const STARTING_MS = 2 * 60_000;
// The title is typed in the one-line prompt; the instructions file has it in full.
const MAX_PROMPT_TITLE = 200;
// A branch name gh gives, passed to git: nothing git could read as an option.
const BRANCH = /^(?!-)[A-Za-z0-9._/-]+$/;

// The task reviewer's rules (review.js) read anywhere; a PR's reviewer reads code someone else wrote, which may tell it to.
const READS_ANYWHERE = new Set(['Read', 'Grep', 'Glob', 'Bash(cat:*)', 'Bash(head:*)', 'Bash(tail:*)']);
// Never read, even if you allow it by mistake: where your keys and logins are.
const SECRETS = ['Read(~/.ssh/**)', 'Read(~/.aws/**)', 'Read(~/.gnupg/**)', 'Read(~/.config/gh/**)'];

const keyOf = ({ repo, number }) => `${repo}#${number}`;
// Where a PR's head is fetched to in its repo, for its review alone.
const headRef = ({ number }) => `refs/switchyard/pr-review/${number}`;
const oneLine = (text) => String(text ?? '').split(/\s*\n\s*/).filter(Boolean).join(' ');
// At work: the page shows it running, or its session is busy (say on a follow-up you typed). Review again waits for it.
const isBusy = (status) => ['reviewing', 'needs you'].includes(status.state) || status.session?.status === 'busy';

/** Where a repo's review checkout of PR `number` goes: beside its main checkout, as <repo>-review-<number>. */
export function reviewCheckoutPath(repo, number) {
  return join(dirname(repo.mainPath), `${basename(repo.mainPath)}-review-${number}`);
}

/**
 * What a PR's reviewer may do without asking: read its checkout (where Claude reads and searches without asking anyway)
 * and its instructions in `dir`, and look at git history. Reading anywhere else asks you; editing and secrets are denied.
 */
export function prReviewerSettings(dir) {
  const { allow, deny } = REVIEWER_SETTINGS.permissions;
  return {
    permissions: {
      // "//" starts an absolute path in a rule.
      allow: [...allow.filter((rule) => !READS_ANYWHERE.has(rule)), 'Read(./**)', `Read(/${join(dir, 'pr-reviews')}/**)`],
      deny: [...deny, ...SECRETS],
    },
  };
}

/** The PR's facts the instructions are filled with (see shared/pr-review.ts), from gh pr view's answer. */
export function prFacts(ref, pr) {
  return {
    repo: ref.repo,
    number: ref.number,
    title: oneLine(pr.title),
    url: pr.url ?? '',
    author: pr.author?.login ?? 'unknown',
    base: pr.baseRefName,
    head: pr.headRefName ?? '',
    body: pr.body ?? '',
    files: (pr.files ?? []).map((file) => file.path),
  };
}

function reviewPrompt(ref, title, file) {
  const shortTitle = title.length > MAX_PROMPT_TITLE ? `${title.slice(0, MAX_PROMPT_TITLE - 1)}…` : title;
  return `Review pull request ${keyOf(ref)} (${shortTitle}), checked out in this folder. Your instructions are in ${file}: read that file first and follow it. Don't change any files or post anything to GitHub.`;
}

/**
 * @param {{ getRepos: () => Promise<object[]>, tmux, provider: () => object, readReply: (cwd, sessionId) => Promise<string|null>,
 *   instructions: () => string, dir: string, endSession: (body) => Promise<unknown>, fetchPr?, fetchState?,
 *   starts?: { track }, limit?: { check }, withHooks?, rediscover?, newSessionId?, now?, gitEnv?: object }} deps
 *   `getRepos()` gives the repos as switchyard lists them, each with `github` (owner/name) and its worktrees' live sessions.
 */
export function createPrReviews({
  getRepos, tmux, provider, readReply, instructions, dir, endSession,
  fetchPr = fetchPrForReview, fetchState = fetchPrState,
  starts = { track: () => {} }, limit = { check: async () => {} }, withHooks = (settings) => settings,
  rediscover = async () => {}, newSessionId = randomUUID, now = Date.now, gitEnv = {},
}) {
  const file = createJsonFile(dir, 'pr-reviews.json');
  const settingsFile = join(dir, 'reviewer.settings.json');
  const instructionsFile = (ref) => join(dir, 'pr-reviews', `${ref.repo.replace('/', '__')}-${ref.number}.md`);
  const git = (cwd, args) => run('git', ['-C', cwd, ...args], { env: { ...process.env, ...gitEnv }, timeout: 120_000 });

  // The reviews, by "owner/name#number": { repo, number, path, sessionId, startedAt, headSha }. Read once, then kept here.
  let reviews = null;
  let saving = Promise.resolve();
  const load = async () => {
    reviews ??= (await file.read()).reviews ?? {};
    return reviews;
  };
  const save = (next) => {
    reviews = next;
    saving = saving.then(() => file.write({ reviews: next }), () => file.write({ reviews: next }));
    return saving;
  };

  // One start, discard or sweep of a PR at a time, in the order asked: each reads the review the last one left.
  const turns = new Map();
  const oneAtATime = (key, work) => {
    const turn = (turns.get(key) ?? Promise.resolve()).then(work);
    const settled = turn.catch(() => {});
    turns.set(key, settled);
    settled.then(() => { if (turns.get(key) === settled) turns.delete(key); });
    return turn;
  };

  const repoFor = (repos, ref) => repos.find((repo) => repo.github === ref.repo) ?? null;
  const worktreeAt = (repos, path) => repos.flatMap((repo) => repo.worktrees).find((w) => w.path === path) ?? null;
  const liveSession = (repos, review) => (worktreeAt(repos, review.path)?.agents?.live ?? []).find((s) => s.sessionId === review.sessionId) ?? null;

  /** A review's status: reviewing while it runs with no verdict; then approve, changes, clarify, or no verdict; needs you whenever it asks. */
  async function status(review, repos) {
    const session = liveSession(repos, review);
    // The report in full: a preview would cut it short of its Verdict.
    const summary = await readReply(review.path, review.sessionId).catch(() => null);
    const verdict = parsePrVerdict(summary);
    // Just started, Claude may not have shown up yet (or still be asking to trust the folder).
    const starting = !summary && now() - review.startedAt < STARTING_MS;
    // A reviewer asking you something needs you, even after a verdict (it may be asking about it).
    const state = session?.needsYou ? 'needs you' : verdict ?? (session || starting ? 'reviewing' : 'no verdict');
    return { ...review, state, verdict, summary, session };
  }

  /**
   * Fetch the PR's base and head into the repo, and put its checkout at the head; gives the head's commit.
   * The head goes into a ref of the PR's own, not FETCH_HEAD, which every fetch in the repo rewrites (another
   * review's, your editor's), so the commit read back is this PR's. It must be the head gh just reported:
   * a push in between is refused rather than reviewed unseen.
   */
  async function checkOut(repo, ref, pr, path) {
    await git(repo.mainPath, ['fetch', '--quiet', 'origin', `+refs/heads/${pr.baseRefName}:refs/remotes/origin/${pr.baseRefName}`]);
    await git(repo.mainPath, ['fetch', '--quiet', 'origin', `+refs/pull/${ref.number}/head:${headRef(ref)}`]);
    const sha = (await git(repo.mainPath, ['rev-parse', headRef(ref)])).trim();
    if (pr.headRefOid && pr.headRefOid !== sha) {
      throw new ActionError(409, `${keyOf(ref)} just changed on GitHub; Review again to review its newest commits`);
    }
    if (existsSync(path)) {
      if (!repo.worktrees.some((w) => w.path === path)) throw new ActionError(409, `${path} is there but isn't ${keyOf(ref)}'s checkout; move it to review this PR here`);
      await git(path, ['checkout', '--quiet', '--detach', sha]);
    } else {
      // A checkout deleted by hand is still on git's list until pruned, and git won't add one there till then.
      await git(repo.mainPath, ['worktree', 'prune']);
      await git(repo.mainPath, ['worktree', 'add', '--quiet', '--detach', path, sha]);
    }
    return sha;
  }

  /** Remove a review's checkout, its head ref and its instructions; `mainPath` is its repo's, or null when that's not known. */
  async function removeCheckout(mainPath, review) {
    if (!mainPath && existsSync(review.path)) {
      throw new ActionError(409, `Can't tell which repo ${review.path} belongs to, so it was left as it is; remove the folder yourself and Discard again`);
    }
    const repo = mainPath && { mainPath };
    if (repo && existsSync(review.path)) {
      await git(repo.mainPath, ['worktree', 'remove', review.path]).catch((error) => {
        const changed = /modified or untracked|contains .*changes|is dirty/i.test(error.message);
        throw new ActionError(409, changed
          ? `${review.path} has changes in it, so it was left as it is; remove them (or the folder) and Discard again`
          : `Could not remove ${review.path}: ${error.message}`);
      });
    } else if (repo) {
      await git(repo.mainPath, ['worktree', 'prune']).catch(() => {});
    }
    if (repo) await git(repo.mainPath, ['update-ref', '-d', headRef(review)]).catch(() => {});
    await rm(instructionsFile(review), { force: true });
  }

  async function discardReview(review, repos) {
    const session = liveSession(repos, review);
    if (session) await endSession({ sessionId: session.sessionId }).catch(() => {});
    // Its repo as saved: a repo no longer in your folders still has its checkout removed.
    await removeCheckout(review.mainPath ?? repoFor(repos, review)?.mainPath ?? null, review);
    const { [keyOf(review)]: _gone, ...rest } = await load();
    await save(rest);
    return review.path;
  }

  async function startReview(ref) {
    const key = keyOf(ref);
    const repos = await getRepos();
    const repo = repoFor(repos, ref);
    if (!repo) throw new ActionError(404, `${ref.repo} isn't cloned in your folders; clone it there to review its PRs here`);
    const saved = (await load())[key];
    const before = saved && await status(saved, repos);
    if (before && isBusy(before)) throw new ActionError(409, 'A review of this PR is already running');
    const path = saved?.path ?? reviewCheckoutPath(repo, ref.number);
    if (!saved && existsSync(path)) throw new ActionError(409, `${path} is already there; move it to review this PR here`);
    const agent = provider();
    if (!agent.takesLaunchOptions) throw new ActionError(400, `${agent.label} can't review`);
    await limit.check();

    const pr = await fetchPr(ref).catch((error) => {
      throw new ActionError(502, `Could not read ${key} from GitHub: ${error.message}`);
    });
    if (pr.state && pr.state !== 'OPEN') throw new ActionError(409, `${key} is ${pr.state.toLowerCase()}`);
    if (!BRANCH.test(pr.baseRefName ?? '')) throw new ActionError(502, `GitHub gave ${key} a base branch switchyard won't pass to git`);
    // The last reviewer, done but still open: ended, so the checkout isn't moved under it.
    if (before?.session) {
      await endSession({ sessionId: before.session.sessionId }).catch((error) => {
        throw new ActionError(409, `Could not end the last reviewer of ${key}: ${error.message}`);
      });
    }
    const headSha = await checkOut(repo, ref, pr, path).catch(async (error) => {
      if (!saved) await removeCheckout(repo.mainPath, { ...ref, path }).catch(() => {});
      throw error instanceof ActionError ? error : new ActionError(409, `Could not check out ${key}: ${error.message}`);
    });

    const facts = prFacts(ref, pr);
    const instructionsPath = instructionsFile(ref);
    const sessionId = newSessionId();
    try {
      await writePrivateFile(dirname(instructionsPath), instructionsPath, fillInstructions(instructions(), facts));
      await writePrivateFile(dir, settingsFile, `${JSON.stringify(withHooks(prReviewerSettings(dir)), null, 2)}\n`);
      // Kept before Claude starts, so a reviewer is never running that switchyard doesn't know of.
      await save({ ...await load(), [key]: { repo: ref.repo, number: ref.number, path, mainPath: repo.mainPath, sessionId, startedAt: now(), headSha } });
      const command = agent.launchCommand(reviewPrompt(ref, facts.title, instructionsPath), {
        // Isolated: the PR's own .claude settings, hooks and CLAUDE.md, and your MCP servers, stay out of it.
        name: `PR review · ${basename(repo.mainPath)}#${ref.number}`, sessionId, permissionMode: 'manual', settings: settingsFile, isolated: true,
      });
      const window = await freeWindowName(tmux, `review-${basename(repo.mainPath)}-${ref.number}`);
      const opened = await runInWindow(tmux, { name: window, cwd: path, command });
      // Watched like New task's start (see task-starts.js): a folder Claude hasn't trusted asks on its row.
      starts.track({ path, place: opened.place, pane: opened.pane, command: agent.command });
      // The worktree list is cached; look again so the checkout shows with its session.
      await rediscover().catch(() => {});
      return { sessionId, window, path };
    } catch (error) {
      // Nothing left half done: a new checkout goes, and a review that was there before is kept as it was.
      const { [key]: _started, ...rest } = await load();
      await save(saved ? { ...rest, [key]: saved } : rest).catch(() => {});
      if (!saved) await removeCheckout(repo.mainPath, { ...ref, path }).catch(() => {});
      throw error instanceof ActionError ? error : new ActionError(500, `Could not start the reviewer of ${key}: ${error.message}`);
    }
  }

  return {
    load,

    /** Whether any review is kept (so session changes are worth telling the PRs page about). */
    any: () => Object.keys(reviews ?? {}).length > 0,

    /** For the PRs page: each PR's review status by "owner/name#number", and whether a repo is cloned here to review. */
    async forPage(repos) {
      const listed = repos ?? await getRepos();
      const entries = await Promise.all(Object.entries(await load()).map(async ([key, review]) => [key, await status(review, listed)]));
      const byKey = new Map(entries);
      const cloned = new Set(listed.map((repo) => repo.github).filter(Boolean));
      return { statusOf: (key) => byKey.get(key) ?? null, canReview: (repo) => cloned.has(repo) };
    },

    /** Start a reviewer on a PR: { repo, number }. */
    async start(body) {
      const ref = parsePrRef(body);
      return oneAtATime(keyOf(ref), () => startReview(ref));
    },

    /** End a PR's reviewer if it runs, and remove its checkout: { repo, number }. */
    async discard(body) {
      const ref = parsePrRef(body);
      return oneAtATime(keyOf(ref), async () => {
        const review = (await load())[keyOf(ref)];
        if (!review) throw new ActionError(404, `There's no review of ${keyOf(ref)} to discard`);
        const removed = await discardReview(review, await getRepos());
        await rediscover().catch(() => {});
        return { removed };
      });
    },

    /** Discard the reviews of PRs that were merged or closed; a PR GitHub can't tell about is left for next time. */
    async sweep() {
      const result = { removed: [], errors: [] };
      for (const key of Object.keys(await load())) {
        await oneAtATime(key, async () => {
          // Read in its turn: a Discard just before may have taken it.
          const review = (await load())[key];
          if (!review) return;
          const state = await fetchState(review).catch(() => null);
          if (!state || state === 'OPEN') return;
          result.removed.push(await discardReview(review, await getRepos()));
        }).catch((error) => result.errors.push(`${key}: ${error.message}`));
      }
      if (result.removed.length > 0) await rediscover().catch(() => {});
      return result;
    },
  };
}
