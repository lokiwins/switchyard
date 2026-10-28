import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClaudeProvider } from './agents/claude.js';
import { createSwrCache } from './cache.js';
import { loadConfig } from './config.js';
import { navCounts } from './nav.js';
import { ActionError, buildLocalIndex, createPrService } from './prs.js';
import { createStateService } from './state.js';

// Loopback only: the API exposes local paths and agent prompts.
const HOST = '127.0.0.1';
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const STATIC_FILES = {
  '/': 'agents.html',
  '/worktrees': 'worktrees.html',
  '/prs': 'prs.html',
  '/agents.js': 'agents.js',
  '/nav.js': 'nav.js',
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
        return sendJson(res, 200, { success: true, data });
      }
      if (url.pathname === '/api/nav') {
        // Badges must never block on a slow GitHub fetch, so a failure just leaves that badge empty.
        const [state, prs] = await Promise.all([
          stateService.getState().catch(() => null),
          prService.getPrs().catch(() => null),
        ]);
        return sendJson(res, 200, { success: true, data: navCounts({ state, prs }) });
      }
      if (url.pathname === '/api/prs') {
        const data = await prService.getPrs({ force: url.searchParams.get('refresh') === '1' });
        return sendJson(res, 200, { success: true, data });
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

function main() {
  const config = loadConfig();
  const cache = createSwrCache();
  const stateService = createStateService({
    config,
    claude: createClaudeProvider({ claudeDir: config.claudeDir }),
    cache,
  });
  const prService = createPrService({
    cache,
    getLocalIndex: () => stateService.getState().then(buildLocalIndex),
  });
  createServer(createHandler({ stateService, prService, port: config.port })).listen(config.port, HOST, () => {
    process.stdout.write(`switchyard: http://localhost:${config.port}  (roots: ${config.roots.join(', ')})\n`);
    // Warm the cache so the first page load is quick.
    stateService.getState().catch((error) => process.stderr.write(`Initial scan failed: ${error.message}\n`));
    prService.getPrs().catch((error) => process.stderr.write(`Initial PR load failed: ${error.message}\n`));
  });
}

main();
