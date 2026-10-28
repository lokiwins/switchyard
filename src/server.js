import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClaudeProvider } from './agents/claude.js';
import { createSwrCache } from './cache.js';
import { loadConfig } from './config.js';
import { navCounts } from './nav.js';
import { createActionService } from './actions.js';
import { ActionError } from './errors.js';
import { buildLocalIndex, createPrService } from './prs.js';
import { resolveTerminalApp } from './settings.js';
import { createStateService } from './state.js';
import { createTerminal } from './terminal.js';

// Loopback only: the API exposes local paths and agent prompts.
const HOST = '127.0.0.1';
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const STATIC_FILES = {
  '/': 'agents.html',
  '/worktrees': 'worktrees.html',
  '/prs': 'prs.html',
  '/agents.js': 'agents.js',
  '/nav.js': 'nav.js',
  '/actions.js': 'actions.js',
  '/app.js': 'app.js',
  '/prs.js': 'prs.js',
  '/pr-views.js': 'pr-views.js',
  '/ended-views.js': 'ended-views.js',
  '/agent-views.js': 'agent-views.js',
  '/session-row.js': 'session-row.js',
  '/dom.js': 'dom.js',
  '/views.js': 'views.js',
  '/styles.css': 'styles.css',
};
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
// Rejecting other Host headers blocks DNS-rebinding pages from reading the API.
const ALLOWED_HOSTNAMES = new Set(['localhost', '127.0.0.1']);
const MAX_BODY_BYTES = 4 * 1024;
const STREAM_HEARTBEAT_MS = 25_000;
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function sendJson(res, status, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function sendStatic(res, file) {
  const body = await readFile(join(PUBLIC_DIR, file));
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': CONTENT_TYPES[extname(file)], 'Cache-Control': 'no-cache' });
  res.end(body);
}

function isAllowedHost(hostHeader) {
  if (!hostHeader) return false;
  return ALLOWED_HOSTNAMES.has(hostHeader.replace(/:\d+$/, ''));
}

// Browsers send Origin on cross-site POSTs, and a custom JSON content type
// forces a CORS preflight we never approve, so other sites cannot trigger actions.
function isSameOriginJson(req, port) {
  const allowed = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
  return allowed.has(req.headers.origin) && /^application\/json\b/.test(req.headers['content-type'] ?? '');
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new ActionError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new ActionError(400, 'Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

const POST_ROUTES = {
  '/api/prs/copilot-review': ({ prService }, body) => prService.copilotReview(body),
  '/api/terminal/focus': ({ actions }, body) => actions.focusSession(body),
  '/api/terminal/resume': ({ actions }, body) => actions.resumeSession(body),
  '/api/terminal/open': ({ actions }, body) => actions.openWorktree(body),
};

async function handlePost(req, res, url, services) {
  const route = POST_ROUTES[url.pathname];
  if (!route) return sendJson(res, 404, { success: false, error: 'Not found' });
  if (!isSameOriginJson(req, services.port)) return sendJson(res, 403, { success: false, error: 'Cross-origin request refused' });
  try {
    const data = await route(services, await readJsonBody(req));
    return sendJson(res, 200, { success: true, data });
  } catch (error) {
    if (error instanceof ActionError) return sendJson(res, error.status, { success: false, error: error.message });
    throw error;
  }
}

/**
 * Server-sent events: the current PR page now, then again whenever GitHub
 * reports a change. A comment line every 25s keeps the connection open.
 */
async function streamPrs(req, res, { prService, capabilities }) {
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  // Skip a page identical to the last one sent (e.g. the initial send racing the first update).
  let lastSent = null;
  const send = (page) => {
    const { generatedAt, ...content } = page;
    const signature = JSON.stringify(content);
    if (signature === lastSent) return;
    lastSent = signature;
    res.write(`event: prs\ndata: ${JSON.stringify({ ...page, capabilities })}\n\n`);
  };
  const unsubscribe = prService.subscribe(send);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), STREAM_HEARTBEAT_MS);
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
  try {
    send(await prService.getPrs());
  } catch (error) {
    res.write(`event: failure\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
  }
}

function createHandler(services) {
  const { stateService, prService } = services;
  return async (req, res) => {
    const url = new URL(req.url, `http://${HOST}`);
    try {
      if (!isAllowedHost(req.headers.host)) return sendJson(res, 403, { success: false, error: 'Forbidden host' });
      if (req.method === 'POST') return await handlePost(req, res, url, services);
      if (req.method !== 'GET') return sendJson(res, 405, { success: false, error: 'Method not allowed' });
      if (url.pathname === '/api/state') {
        const data = await stateService.getState({ force: url.searchParams.get('refresh') === '1' });
        return sendJson(res, 200, { success: true, data: { ...data, capabilities: services.capabilities } });
      }
      if (url.pathname === '/api/nav') {
        // Badges must never block on a slow GitHub fetch, so a failure just leaves that badge empty.
        const [state, prs] = await Promise.all([
          stateService.getState().catch(() => null),
          prService.getPrs().catch(() => null),
        ]);
        return sendJson(res, 200, { success: true, data: navCounts({ state, prs }) });
      }
      if (url.pathname === '/api/prs/stream') return await streamPrs(req, res, services);
      if (url.pathname === '/api/prs') {
        const data = await prService.getPrs({ force: url.searchParams.get('refresh') === '1' });
        return sendJson(res, 200, { success: true, data: { ...data, capabilities: services.capabilities } });
      }
      const file = STATIC_FILES[url.pathname];
      if (file) return await sendStatic(res, file);
      return sendJson(res, 404, { success: false, error: 'Not found' });
    } catch (error) {
      process.stderr.write(`[switchyard] ${req.url}: ${error.stack ?? error}\n`);
      return sendJson(res, 500, { success: false, error: error.message });
    }
  };
}

function loadConfigOrExit() {
  try {
    return loadConfig();
  } catch (error) {
    process.stderr.write(`switchyard: ${error.message}\n`);
    process.exit(1);
  }
}

function main() {
  const config = loadConfigOrExit();
  const cache = createSwrCache();
  const stateService = createStateService({
    config,
    claude: createClaudeProvider({ claudeDir: config.claudeDir }),
    cache,
  });
  const prService = createPrService({
    settings: config.settings,
    getLocalIndex: () => stateService.getState().then(buildLocalIndex),
  });
  const terminal = createTerminal({ app: resolveTerminalApp(config.settings.terminal.app) });
  const actions = createActionService({ stateService, terminal });
  const capabilities = { terminal: terminal.app, editorScheme: config.settings.editor.urlScheme };
  createServer(createHandler({ stateService, prService, actions, capabilities, port: config.port })).listen(config.port, HOST, () => {
    process.stdout.write(`switchyard: http://localhost:${config.port}  (roots: ${config.roots.join(', ')})\n`);
    // Warm the cache so the first page load is quick.
    stateService.getState().catch((error) => process.stderr.write(`Initial scan failed: ${error.message}\n`));
    prService.getPrs().catch((error) => process.stderr.write(`Initial PR load failed: ${error.message}\n`));
    prService.start();
  });
}

main();
