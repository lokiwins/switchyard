import { ActionError } from './errors.js';
import { run } from './exec.js';

/*
 * GitHub issues for the Tasks page, through gh and your gh login: the open
 * issues assigned to you (for Add from ▾), one issue or PR (for a task's
 * details pane), and closing or reopening an issue. Every value goes to gh as
 * its own argument; repos and numbers come checked from parseTicketLink.
 */

const TTL_MS = 60_000;
// gh search answers at most this many; GitHub's search caps at 1000.
const SEARCH_LIMIT = 200;
const MAX_DESCRIPTION = 20_000;
// What gh says when there's no login to use.
const NOT_SIGNED_IN = /gh auth login|not logged in|authentication required/i;
const ISSUE_STATUSES = [{ name: 'open', color: null }, { name: 'closed', color: null }];

const repoOf = (task) => task.id.slice(0, task.id.lastIndexOf('#'));

/** Only the tasks in `chosen` repos (owner/repo, any case); every task when none is chosen. */
function inChosenRepos(result, chosen) {
  if (chosen.length === 0) return result;
  const wanted = new Set(chosen.map((name) => name.toLowerCase()));
  return { ...result, tasks: result.tasks.filter((task) => wanted.has(repoOf(task).toLowerCase())) };
}

/**
 * The repos Settings offers to tick: those your assigned issues are in and
 * those checked out in your folders, plus any already chosen, by name (any
 * case, the first spelling kept), each with how many issues it has for you.
 */
export function repoChoices(tasks, localRepos, chosen) {
  const byKey = new Map();
  const add = (name, fields) => {
    const key = name.toLowerCase();
    const entry = byKey.get(key) ?? { name, issues: 0, local: false, chosen: false };
    byKey.set(key, { ...entry, ...fields(entry) });
  };
  for (const task of tasks) add(repoOf(task), (e) => ({ issues: e.issues + 1 }));
  for (const name of localRepos) if (name) add(name, () => ({ local: true }));
  for (const name of chosen) add(name, () => ({ chosen: true }));
  return [...byKey.values()].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

/**
 * @param {{ runGh?: (args: string[]) => Promise<string>, now?: () => number, issueRepos?: () => string[] }} deps
 * `issueRepos` gives the repos chosen in Settings now, so a change there applies at once.
 */
export function createGithubIssues({ runGh = (args) => run('gh', args), now = Date.now, issueRepos = () => [] } = {}) {
  let cache = null;

  const gh = (args) => runGh(args).catch((error) => {
    throw new ActionError(NOT_SIGNED_IN.test(error.message) ? 409 : 502, `GitHub: ${error.message.trim()}`);
  });

  async function fetchAssigned() {
    try {
      const issues = JSON.parse(await gh(['search', 'issues', '--assignee=@me', '--state=open', '--limit', String(SEARCH_LIMIT), '--json', 'number,title,url,state,repository,updatedAt']));
      const tasks = issues.map((issue) => ({
        id: `${issue.repository.nameWithOwner}#${issue.number}`,
        customId: null,
        name: String(issue.title ?? ''),
        status: { name: String(issue.state ?? 'open').toLowerCase(), color: null },
        dueAt: null,
        updatedAt: Date.parse(issue.updatedAt) || null,
        url: issue.url,
        // The id already says which repo.
        where: null,
      }));
      cache = { result: { connected: true, tasks }, fetchedAt: now() };
      return cache.result;
    } catch (error) {
      if (error.status === 409) return { connected: false, tasks: [] };
      return { connected: true, tasks: [], error: error.message };
    }
  }

  /** Every open issue assigned to you, whatever Settings chose. */
  async function allAssigned({ force = false } = {}) {
    if (!force && cache && now() - cache.fetchedAt < TTL_MS) return cache.result;
    return fetchAssigned();
  }

  async function ticket({ repo, number, kind }, link) {
    const item = JSON.parse(await gh([kind, 'view', String(number), '--repo', repo, '--json', 'title,body,state,url']));
    return {
      tracker: 'github',
      title: String(item.title ?? ''),
      status: { name: String(item.state ?? '').toLowerCase(), color: null },
      description: String(item.body ?? '').slice(0, MAX_DESCRIPTION),
      url: typeof item.url === 'string' && item.url.startsWith('https://github.com/') ? item.url : link,
      // A PR's state is merged or closed by its own buttons, not from here.
      statuses: kind === 'issue' ? ISSUE_STATUSES : [],
    };
  }

  return {
    /** Whether gh is signed in, and as whom. */
    async connection() {
      try {
        return { connected: true, user: { username: (await runGh(['api', 'user', '--jq', '.login'])).trim() } };
      } catch {
        return { connected: false };
      }
    },

    /** The open issues assigned to you in the repos chosen in Settings, from the cache when it's fresh. `force` (Refresh) asks GitHub. */
    async assigned({ force = false } = {}) {
      return inChosenRepos(await allAssigned({ force }), issueRepos());
    },

    allAssigned,

    ticket,

    /** Close or reopen an issue; resolves to it as it is now. */
    async setStatus(ref, link, status) {
      if (ref.kind !== 'issue') throw new ActionError(400, 'A pull request is merged or closed on GitHub, not from here');
      const wanted = typeof status === 'string' ? status.trim().toLowerCase() : '';
      if (!ISSUE_STATUSES.some((s) => s.name === wanted)) throw new ActionError(400, 'An issue is open or closed');
      await gh(['issue', wanted === 'closed' ? 'close' : 'reopen', String(ref.number), '--repo', ref.repo]);
      cache = null;
      return ticket(ref, link);
    },
  };
}
