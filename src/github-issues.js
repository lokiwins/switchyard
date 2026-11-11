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

/** @param {{ runGh?: (args: string[]) => Promise<string>, now?: () => number }} deps */
export function createGithubIssues({ runGh = (args) => run('gh', args), now = Date.now } = {}) {
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

    /** The open issues assigned to you, from the cache when it's fresh. `force` (Refresh) asks GitHub. */
    async assigned({ force = false } = {}) {
      if (!force && cache && now() - cache.fetchedAt < TTL_MS) return cache.result;
      return fetchAssigned();
    },

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
