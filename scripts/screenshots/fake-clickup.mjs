/*
 * A stand-in for ClickUp's API, for the screenshots: it answers the requests
 * switchyard's Tasks page makes, from fixture-data.mjs, and only with the
 * fixture's token, as ClickUp would.
 */
import { createServer } from 'node:http';
import { CLICKUP, clickupTasks } from './fixture-data.mjs';

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

/** Listens on 127.0.0.1:`port`; returns the API's base URL and a way to stop it. */
export function startFakeClickUp({ port, now }) {
  const server = createServer((req, res) => {
    if (req.headers.authorization !== CLICKUP.token) return send(res, 401, { err: 'Token invalid', ECODE: 'OAUTH_025' });
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/api/v2/user') return send(res, 200, { user: CLICKUP.user });
    if (pathname === '/api/v2/team') return send(res, 200, { teams: CLICKUP.workspaces });
    if (pathname === `/api/v2/team/${CLICKUP.workspaces[0].id}/task`) return send(res, 200, { tasks: clickupTasks(now), last_page: true });
    return send(res, 404, { err: 'Route not found' });
  });
  server.listen(port, '127.0.0.1');
  return { url: `http://127.0.0.1:${port}/api/v2`, stop: () => server.close() };
}
