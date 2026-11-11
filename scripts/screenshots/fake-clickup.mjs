/*
 * A stand-in for ClickUp's API, for the screenshots: it answers the requests
 * switchyard's Tasks page makes, from fixture-data.mjs, and only with the
 * fixture's token, as ClickUp would.
 */
import { createServer } from 'node:http';
import { CLICKUP, CLICKUP_DESCRIPTIONS, CLICKUP_STATUSES, clickupTasks } from './fixture-data.mjs';

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readBody = (req) => new Promise((resolve) => {
  let data = '';
  req.on('data', (chunk) => { data += chunk; });
  req.on('end', () => resolve(data ? JSON.parse(data) : {}));
});

/** Listens on 127.0.0.1:`port`; returns the API's base URL and a way to stop it. A status change is kept while it runs. */
export function startFakeClickUp({ port, now }) {
  const statusOf = new Map();
  const statusNamed = (name) => CLICKUP_STATUSES.find((s) => s.status === name);
  const tasks = () => clickupTasks(now).map((task) => (statusOf.has(task.id)
    ? { ...task, status: { ...statusNamed(statusOf.get(task.id)), status: statusOf.get(task.id) } }
    : task));
  const full = (task) => ({ ...task, markdown_description: CLICKUP_DESCRIPTIONS[task.id] ?? '' });

  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== CLICKUP.token) return send(res, 401, { err: 'Token invalid', ECODE: 'OAUTH_025' });
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    if (pathname === '/api/v2/user') return send(res, 200, { user: CLICKUP.user });
    if (pathname === '/api/v2/team') return send(res, 200, { teams: CLICKUP.workspaces });
    if (pathname === `/api/v2/team/${CLICKUP.workspaces[0].id}/task`) {
      return send(res, 200, { tasks: tasks().filter((t) => t.status.type !== 'closed'), last_page: true });
    }
    const list = /^\/api\/v2\/list\/([^/]+)$/.exec(pathname);
    if (list) return send(res, 200, { id: list[1], statuses: CLICKUP_STATUSES });
    const one = /^\/api\/v2\/task\/([^/]+)$/.exec(pathname);
    if (one) {
      const custom = url.searchParams.get('custom_task_ids') === 'true';
      const task = tasks().find((t) => (custom ? t.custom_id === one[1] : t.id === one[1]));
      if (!task) return send(res, 404, { err: 'Task not found', ECODE: 'ITEM_015' });
      if (req.method === 'PUT') {
        const { status } = await readBody(req);
        if (!statusNamed(status)) return send(res, 400, { err: 'Status does not exist', ECODE: 'CRTSK_001' });
        statusOf.set(task.id, status);
        return send(res, 200, full(tasks().find((t) => t.id === task.id)));
      }
      return send(res, 200, full(task));
    }
    return send(res, 404, { err: 'Route not found' });
  });
  server.listen(port, '127.0.0.1');
  return { url: `http://127.0.0.1:${port}/api/v2`, stop: () => server.close() };
}
