import { assertToken, createClickUp } from './clickup.js';
import { ActionError } from './errors.js';
import { createJsonFile, defaultStoreDir } from './json-store.js';

/*
 * The trackers the Tasks page imports tickets from. ClickUp connects with a
 * personal API token, kept in a file only you can read, outside the checkout
 * (~/.config/switchyard/task-tools.json), and only ever sent to ClickUp: the
 * page is told who you are and which workspace it shows, never the token.
 * GitHub uses your gh login (see github-issues.js).
 */

const STORE_FILE = 'task-tools.json';
const DEFAULT_TTL_MS = 60_000;

// The cards the page shows; tools that aren't available yet are shown as coming later.
// GitHub uses your gh login (kind 'gh'); the others a token you paste.
const TOOLS = [
  { id: 'clickup', name: 'ClickUp', available: true, kind: 'token' },
  { id: 'github', name: 'GitHub', available: true, kind: 'gh' },
  { id: 'linear', name: 'Linear', available: false, kind: 'token' },
  { id: 'jira', name: 'Jira', available: false, kind: 'token' },
  { id: 'ado', name: 'Azure DevOps', available: false, kind: 'token' },
];

/** Where the token file lives: $XDG_CONFIG_HOME/switchyard, or ~/.config/switchyard. */
export { defaultStoreDir };

/** Reads and writes the token file; the folder and file are made readable by you alone. */
export const createTokenStore = (dir = defaultStoreDir()) => createJsonFile(dir, STORE_FILE);

function assertTool(body) {
  if (!body || typeof body !== 'object') throw new ActionError(400, 'Invalid request');
  if (body.tool !== 'clickup') throw new ActionError(400, 'Only ClickUp can be connected so far');
  return body;
}

/** What the page is told about a connection: never the token. */
const publicConnection = (saved) => (saved
  ? { connected: true, user: saved.user, workspaces: saved.workspaces, workspaceId: saved.workspaceId }
  : { connected: false });

export function createTaskTools({
  store = createTokenStore(),
  clickupFor = (token) => createClickUp({ token }),
  ttlMs = DEFAULT_TTL_MS,
  now = Date.now,
  github = { connection: async () => ({ connected: false }) },
} = {}) {
  // The last task list, for one workspace, so the page's polling doesn't spend ClickUp's rate limit.
  let cache = null;
  // Bumped on every save, so a fetch begun under an older connection isn't cached for the new one.
  let generation = 0;
  // Saves run one at a time, each reading what the one before it wrote.
  let saving = Promise.resolve();

  // The fetch under way, which every ask until it lands shares.
  let fetching = null;

  /**
   * Your open ClickUp tasks in the chosen workspace. A failure (a revoked
   * token, ClickUp down) comes back as `error`, for the page to show.
   */
  function fetchTasks(clickup) {
    const startedAt = generation;
    if (fetching?.generation === startedAt && fetching.workspaceId === clickup.workspaceId) return fetching.promise;
    const workspace = clickup.workspaces.find((w) => w.id === clickup.workspaceId) ?? null;
    const promise = (async () => {
      try {
        const tasks = await clickupFor(clickup.token).assignedTasks(clickup.workspaceId, clickup.user.id);
        const result = { connected: true, workspace, tasks, truncated: tasks.truncated === true, fetchedAt: now() };
        if (generation === startedAt) cache = { workspaceId: clickup.workspaceId, fetchedAt: result.fetchedAt, result };
        return result;
      } catch (error) {
        if (!(error instanceof ActionError)) throw error;
        return { connected: true, workspace, tasks: [], error: error.message };
      } finally {
        if (fetching?.promise === promise) fetching = null;
      }
    })();
    fetching = { generation: startedAt, workspaceId: clickup.workspaceId, promise };
    return promise;
  }

  async function saved() {
    return (await store.read()).clickup ?? null;
  }

  /** One ClickUp ticket (by id or custom id) for the details pane, with the statuses it can move to. */
  async function clickupTicket(key) {
    const clickup = await connection();
    const client = clickupFor(clickup.token);
    const ticket = await client.task(key, clickup.workspaceId);
    const statuses = ticket.listId ? await client.listStatuses(ticket.listId) : [];
    return { tracker: 'clickup', ...ticket, statuses };
  }

  /** The saved ClickUp connection; a 409 saying to connect when there isn't one. */
  async function connection() {
    await saving;
    const clickup = await saved();
    if (!clickup) throw new ActionError(409, 'Connect ClickUp first, in the Connections ▾ menu at the top of the Tasks page');
    return clickup;
  }

  /** Replace the ClickUp connection (null removes it), given the one saved now. */
  function update(change) {
    const run = saving.then(async () => {
      const { clickup, ...rest } = await store.read();
      const next = change(clickup ?? null);
      await store.write(next ? { ...rest, clickup: next } : rest);
      generation += 1;
      cache = null;
    });
    saving = run.catch(() => {});
    return run;
  }

  async function sources() {
    const [clickup, gh] = await Promise.all([saved(), github.connection()]);
    const connectionOf = { clickup: publicConnection(clickup), github: gh };
    return { tools: TOOLS.map((tool) => ({ ...tool, ...(connectionOf[tool.id] ?? { connected: false }) })) };
  }

  return {
    sources,

    /** The tasks the last fetch found, old or not, without asking ClickUp: for tagging worktrees. */
    cachedTasks: () => cache?.result.tasks ?? [],

    /** Checks the token with ClickUp first, so a wrong one is never kept. */
    async connect(body) {
      const token = assertToken(assertTool(body).token);
      const clickup = clickupFor(token);
      const [user, workspaces] = await Promise.all([clickup.user(), clickup.workspaces()]);
      if (workspaces.length === 0) throw new ActionError(400, 'That token can\'t see any ClickUp workspace');
      await update(() => ({ token, user, workspaces, workspaceId: workspaces[0].id }));
      return sources();
    },

    async disconnect(body) {
      assertTool(body);
      await update(() => null);
      return sources();
    },

    async chooseWorkspace(body) {
      assertTool(body);
      await update((clickup) => {
        if (!clickup) throw new ActionError(409, 'ClickUp isn\'t connected');
        if (!clickup.workspaces.some((w) => w.id === body.workspaceId)) throw new ActionError(400, 'Not one of your ClickUp workspaces');
        return { ...clickup, workspaceId: body.workspaceId };
      });
      return sources();
    },

    /**
     * Your open ClickUp tasks, from the cache when there is one: an old list
     * is answered at once while a fresh one is fetched. `force` (Refresh)
     * waits for ClickUp.
     */
    async tasks({ force = false } = {}) {
      await saving;
      const clickup = await saved();
      if (!clickup) return { connected: false, tasks: [] };
      const cached = cache && cache.workspaceId === clickup.workspaceId ? cache : null;
      if (force || !cached) return fetchTasks(clickup);
      // An old list is answered at once, and a fresh one fetched behind it for the next ask.
      if (now() - cached.fetchedAt >= ttlMs) fetchTasks(clickup).catch(() => {});
      return cached.result;
    },

    clickupTicket,

    /** Move a ClickUp ticket to one of its list's statuses (any case); resolves to the ticket as it is now. */
    async setClickupStatus({ key, status } = {}) {
      if (typeof status !== 'string' || !status.trim()) throw new ActionError(400, 'Choose a status');
      const ticket = await clickupTicket(key);
      const chosen = ticket.statuses.find((s) => s.name.toLowerCase() === status.trim().toLowerCase());
      if (!chosen) throw new ActionError(400, `"${status}" is not a status in ${ticket.listName ?? 'its list'}`);
      const clickup = await connection();
      await clickupFor(clickup.token).setStatus(ticket.id, chosen.name);
      // The assigned-ticket list now shows the old status (or a ticket that's done); fetch it afresh next time.
      cache = null;
      return { ...ticket, status: chosen };
    },
  };
}
