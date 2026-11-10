import { ActionError } from './errors.js';

/*
 * ClickUp's REST API (v2), with a personal API token: the token goes as the
 * Authorization header as it is. Only what the Tasks page shows is kept of
 * each task, and nothing here ever reaches the page but those fields.
 */

export const CLICKUP_API = 'https://api.clickup.com/api/v2';
const REQUEST_TIMEOUT_MS = 10_000;
// ClickUp sends 100 tasks a page; past this many pages the rest are left to ClickUp itself.
const DEFAULT_MAX_PAGES = 5;
const PAGE_SIZE = 100;
// A personal token: "pk_", your user id, "_", then letters and digits.
const TOKEN = /^pk_\d+_[A-Za-z0-9]{20,64}$/;
// Workspace and task ids go into the URL path, so they must be plain ids.
const ID = /^[A-Za-z0-9]{1,32}$/;
const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;
const FINISHED_STATUS_TYPES = new Set(['done', 'closed']);

/** The token, trimmed, if it looks like a personal API token; a 400 otherwise, before it's sent anywhere. */
export function assertToken(token) {
  const trimmed = typeof token === 'string' ? token.trim() : '';
  if (!TOKEN.test(trimmed)) {
    throw new ActionError(400, 'That doesn\'t look like a ClickUp personal API token (it starts with "pk_").');
  }
  return trimmed;
}

function assertId(id, what) {
  if (typeof id !== 'string' || !ID.test(id)) throw new ActionError(400, `Invalid ClickUp ${what}`);
  return id;
}

const timeOf = (value) => (value && Number.isFinite(Number(value)) ? Number(value) : null);
const httpsUrl = (value) => (typeof value === 'string' && value.startsWith('https://') ? value : null);

/** "Folder › List", or just the list when it's not in a folder (ClickUp gives those a hidden folder). */
function whereOf(task) {
  const list = task.list?.name;
  const folder = task.folder && !task.folder.hidden ? task.folder.name : null;
  return [folder, list].filter(Boolean).join(' › ') || null;
}

/** What the Tasks page shows of a task. Colours and links are kept only when they're plain ones. */
export function normalizeTask(task) {
  return {
    id: String(task.id),
    customId: task.custom_id ?? null,
    name: String(task.name ?? ''),
    status: {
      name: String(task.status?.status ?? ''),
      color: HEX_COLOR.test(task.status?.color ?? '') ? task.status.color : null,
    },
    priority: task.priority?.priority ?? null,
    dueAt: timeOf(task.due_date),
    updatedAt: timeOf(task.date_updated),
    url: httpsUrl(task.url),
    where: whereOf(task),
  };
}

async function failureOf(response) {
  if (response.status === 401) {
    return new ActionError(401, 'ClickUp refused the token. Make a new one in ClickUp and connect again.');
  }
  if (response.status === 429) return new ActionError(429, 'ClickUp is rate limiting requests. Try again in a minute.');
  const body = await response.json().catch(() => ({}));
  return new ActionError(502, `ClickUp answered ${response.status}${body.err ? `: ${body.err}` : ''}`);
}

export function createClickUp({ token, baseUrl = CLICKUP_API, fetch = globalThis.fetch, maxPages = DEFAULT_MAX_PAGES }) {
  async function get(path, params = []) {
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of params) url.searchParams.append(key, String(value));
    let response;
    try {
      response = await fetch(url, {
        headers: { Authorization: token, Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new ActionError(502, `Could not reach ClickUp: ${error.message}`);
    }
    if (!response.ok) throw await failureOf(response);
    try {
      return await response.json();
    } catch {
      throw new ActionError(502, 'ClickUp sent an answer switchyard couldn\'t read');
    }
  }

  return {
    /** You, as the token says: { id, username }. */
    async user() {
      const { user } = await get('/user');
      if (!user?.id) throw new ActionError(502, 'ClickUp didn\'t say who the token belongs to');
      return { id: user.id, username: user.username ?? String(user.id) };
    },

    /** The workspaces ("teams" in the API) the token can see. */
    async workspaces() {
      const { teams = [] } = await get('/team');
      return teams.map((team) => ({ id: String(team.id), name: team.name }));
    },

    /**
     * Open tasks assigned to `userId` in a workspace, subtasks included, most
     * recently updated first. `truncated` is set on the list when the page cap cut it off.
     */
    async assignedTasks(workspaceId, userId) {
      assertId(workspaceId, 'workspace');
      const tasks = [];
      let truncated = false;
      for (let page = 0; page < maxPages; page += 1) {
        const body = await get(`/team/${workspaceId}/task`, [
          ['assignees[]', userId], ['include_closed', false], ['subtasks', true], ['order_by', 'updated'], ['page', page],
        ]);
        const pageTasks = body.tasks ?? [];
        tasks.push(...pageTasks);
        // ClickUp says whether this was the last page; without that, a short page is.
        const more = body.last_page === undefined ? pageTasks.length === PAGE_SIZE : body.last_page === false;
        if (!more || pageTasks.length === 0) break;
        truncated = page === maxPages - 1;
      }
      const open = tasks
        .filter((task) => task && !FINISHED_STATUS_TYPES.has(task.status?.type))
        .map(normalizeTask)
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      return Object.assign(open, { truncated });
    },
  };
}
