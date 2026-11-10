import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { assertToken, createClickUp } from './clickup.js';
import { ActionError } from './errors.js';

/*
 * The task management tools the Tasks page connects to. Only ClickUp works
 * so far, with a personal API token. The token is kept in a file only you
 * can read, outside the checkout (~/.config/switchyard/task-tools.json), and
 * is only ever sent to ClickUp: the page is told who you are and which
 * workspace it shows, never the token.
 */

const STORE_FILE = 'task-tools.json';
const DEFAULT_TTL_MS = 60_000;

// The cards the page shows; tools that aren't available yet are shown as coming later.
const TOOLS = [
  { id: 'clickup', name: 'ClickUp', available: true },
  { id: 'linear', name: 'Linear', available: false },
  { id: 'jira', name: 'Jira', available: false },
  { id: 'github-issues', name: 'GitHub Issues', available: false },
];

/** Where the token file lives: $XDG_CONFIG_HOME/switchyard, or ~/.config/switchyard. */
export function defaultStoreDir(env = process.env) {
  return join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config'), 'switchyard');
}

/** Reads and writes the token file; the folder and file are made readable by you alone. */
export function createTokenStore(dir = defaultStoreDir()) {
  const file = join(dir, STORE_FILE);
  return {
    async read() {
      try {
        const data = JSON.parse(await readFile(file, 'utf8'));
        return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
      } catch {
        return {};
      }
    },
    async write(data) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await chmod(dir, 0o700);
      // Written whole, then moved into place, so a crash never leaves half a file.
      const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
      await rename(temp, file);
    },
  };
}

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
} = {}) {
  // The last task list, for one workspace, so the page's polling doesn't spend ClickUp's rate limit.
  let cache = null;
  // Bumped on every save, so a fetch begun under an older connection isn't cached for the new one.
  let generation = 0;
  // Saves run one at a time, each reading what the one before it wrote.
  let saving = Promise.resolve();

  async function saved() {
    return (await store.read()).clickup ?? null;
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
    const clickup = await saved();
    return { tools: TOOLS.map((tool) => (tool.id === 'clickup' ? { ...tool, ...publicConnection(clickup) } : { ...tool, connected: false })) };
  }

  return {
    sources,

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
     * Your open ClickUp tasks in the chosen workspace. A failure (a revoked
     * token, ClickUp down) comes back as `error`, for the page to show.
     */
    async tasks({ force = false } = {}) {
      await saving;
      const startedAt = generation;
      const clickup = await saved();
      if (!clickup) return { connected: false, tasks: [] };
      const workspace = clickup.workspaces.find((w) => w.id === clickup.workspaceId) ?? null;
      const fresh = cache && cache.workspaceId === clickup.workspaceId && now() - cache.fetchedAt < ttlMs;
      if (!force && fresh) return cache.result;
      try {
        const tasks = await clickupFor(clickup.token).assignedTasks(clickup.workspaceId, clickup.user.id);
        const result = { connected: true, workspace, tasks, truncated: tasks.truncated === true, fetchedAt: now() };
        if (generation === startedAt) cache = { workspaceId: clickup.workspaceId, fetchedAt: result.fetchedAt, result };
        return result;
      } catch (error) {
        if (!(error instanceof ActionError)) throw error;
        return { connected: true, workspace, tasks: [], error: error.message };
      }
    },
  };
}
