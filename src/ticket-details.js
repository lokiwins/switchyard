import { ActionError } from './errors.js';

/*
 * What a task's ticket links say, for its details pane: a ClickUp ticket from
 * ClickUp, a GitHub issue or PR through gh (see github-issues.js), each with
 * the statuses it can move to.
 * Other trackers aren't read, only linked to. A link only ever leads to
 * ClickUp's API or a gh call with its owner, repo and number checked, never
 * to a request of the link's own choosing.
 */

const CLICKUP_TASK = /^\/t\/(?:\d+\/)?([A-Za-z0-9][A-Za-z0-9_-]*)\/?$/;
// github.com/<owner>/<repo>/issues|pull/<n>: names GitHub allows, not starting with "-" (gh would read it as an option).
const GITHUB_TICKET = /^\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._][A-Za-z0-9._-]{0,99})\/(issues|pull)\/(\d{1,9})\/?$/;
const OTHER_TRACKERS = [
  { tracker: 'jira', host: /\.atlassian\.net$/ },
  { tracker: 'ado', host: /^dev\.azure\.com$|\.visualstudio\.com$/ },
];

/** Which tracker a link is in, and what switchyard needs to read it: { tracker, ... } (tracker null for any other link). */
export function parseTicketLink(link) {
  let url;
  try {
    url = new URL(link);
  } catch {
    return { tracker: null };
  }
  if (url.protocol === 'https:' && url.hostname === 'app.clickup.com') {
    const match = CLICKUP_TASK.exec(url.pathname);
    if (match) return { tracker: 'clickup', key: match[1] };
  }
  if (url.protocol === 'https:' && url.hostname === 'github.com') {
    const match = GITHUB_TICKET.exec(url.pathname);
    if (match) return { tracker: 'github', repo: `${match[1]}/${match[2]}`, number: Number(match[4]), kind: match[3] === 'pull' ? 'pr' : 'issue' };
  }
  const other = OTHER_TRACKERS.find((t) => t.host.test(url.hostname));
  return { tracker: other?.tracker ?? null };
}

/** @param {{ taskTools: { clickupTicket, setClickupStatus }, github: { ticket, setStatus } }} deps */
export function createTicketDetails({ taskTools, github }) {
  return {
    /** What a ticket link says; { tracker, supported: false, url } for trackers switchyard doesn't read. */
    async get(link) {
      if (typeof link !== 'string') throw new ActionError(400, 'Which ticket?');
      const ticket = parseTicketLink(link);
      if (ticket.tracker === 'clickup') return taskTools.clickupTicket(ticket.key);
      if (ticket.tracker === 'github') return github.ticket(ticket, link);
      return { tracker: ticket.tracker, supported: false, url: link };
    },

    /** Change a ticket's status: ClickUp's, or a GitHub issue's (open or closed). */
    async setStatus(body) {
      const ticket = parseTicketLink(body?.url);
      if (ticket.tracker === 'clickup') return taskTools.setClickupStatus({ key: ticket.key, status: body.status });
      if (ticket.tracker === 'github') return github.setStatus(ticket, body.url, body.status);
      throw new ActionError(400, 'That ticket\'s status can\'t be changed from here yet');
    },
  };
}
