import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClaudeProvider } from './agents/claude.js';
import { createSwrCache } from './cache.js';
import { loadConfig } from './config.js';
import { navCounts } from './nav.js';
import { createActionService } from './actions.js';
import { createAgentFeed, watchFolder } from './agent-feed.js';
import { createApprovalBroker } from './approvals.js';
import { HOOK_PATH, isHookInstalled, readClaudeSettings } from './claude-hook.js';
import { CSP, newStyleNonce, withStyleNonce } from './csp.js';
import { ActionError } from './errors.js';
import { buildLocalIndex, createPrService } from './prs.js';
import { resolveTerminalApp } from './settings.js';
import { createStateService } from './state.js';
import { createTaskService } from './tasks.js';
import { createCleanupService } from './cleanup.js';
import { createLiveTerminals } from './live-terminal.js';
import { createTerminal } from './terminal.js';
import { createTmux } from './tmux.js';

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
  '/session-text.js': 'session-text.js',
  '/session-controls.js': 'session-controls.js',
  '/new-task.js': 'new-task.js',
  '/branch-name.js': 'branch-name.js',
  '/markdown.js': 'markdown.js',
  '/review-pane.js': 'review-pane.js',
  '/live-terminal.js': 'live-terminal.js',
  '/vendor/xterm/xterm.mjs': 'vendor/xterm/xterm.mjs',
  '/vendor/xterm/addon-fit.mjs': 'vendor/xterm/addon-fit.mjs',
  '/vendor/xterm/addon-webgl.mjs': 'vendor/xterm/addon-webgl.mjs',
  '/vendor/xterm/xterm.css': 'vendor/xterm/xterm.css',
  '/dom.js': 'dom.js',
  '/views.js': 'views.js',
  '/styles.css': 'styles.css',
};
const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
// Pages hosting the live terminal, which get a style nonce on each load (see csp.js).
const STYLE_NONCE_PAGES = new Set(['agents.html']);
// Rejecting other Host headers blocks DNS-rebinding pages from reading the API.
const ALLOWED_HOSTNAMES = new Set(['localhost', '127.0.0.1']);
const MAX_BODY_BYTES = 4 * 1024;
// A hook payload carries the whole tool input, e.g. a file Claude wants to write. A bigger one
// is refused, which leaves that prompt to the terminal.
const MAX_HOOK_BODY_BYTES = 256 * 1024;
// How often to re-read Claude Code's settings for whether the approvals hook is installed.
const HOOK_CHECK_MS = 10_000;
const STREAM_HEARTBEAT_MS = 25_000;
const TERMINAL_RETRY_MS = 2_000;
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function sendJson(res, status, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function sendStatic(res, file) {
  let body = await readFile(join(PUBLIC_DIR, file));
  let csp = CSP;
  if (STYLE_NONCE_PAGES.has(file)) ({ csp, body } = withStyleNonce(body.toString('utf8'), newStyleNonce()));
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Security-Policy': csp, 'Content-Type': CONTENT_TYPES[extname(file)], 'Cache-Control': 'no-cache' });
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

function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
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
  '/api/approvals/decide': ({ approvals }, body) => approvals.decide(body),
  '/api/terminal/focus': ({ actions }, body) => actions.focusSession(body),
  '/api/terminal/reply': ({ actions }, body) => actions.replyToSession(body),
  '/api/terminal/interrupt': ({ actions }, body) => actions.interruptSession(body),
  '/api/terminal/input': ({ liveTerminals }, body) => liveTerminals.input(body),
  '/api/terminal/resize': ({ liveTerminals }, body) => liveTerminals.resize(body),
  '/api/terminal/ack': ({ liveTerminals }, body) => liveTerminals.ack(body),
  '/api/tasks/new': ({ tasks }, body) => tasks.startTask(body),
  '/api/worktrees/cleanup': ({ cleanup }, body) => cleanup.cleanUpWorktree(body),
  '/api/terminal/resume': ({ actions }, body) => actions.resumeSession(body),
  '/api/terminal/open': ({ actions }, body) => actions.openWorktree(body),
};

/**
 * Claude Code's PermissionRequest hook. The response is held until the prompt
 * is answered on the page, answered in the terminal, or Claude gives up; an
 * empty 200 leaves the decision to the terminal. Browsers always send Origin
 * on a POST and Claude Code never does, so a request with one is refused.
 */
async function handleHook(req, res, { approvals }) {
  if (req.headers.origin !== undefined || !/^application\/json\b/.test(req.headers['content-type'] ?? '')) {
    return sendJson(res, 403, { success: false, error: 'Hook requests come from Claude Code only' });
  }
  // Listen before reading the body, so a hook that disconnects early is never left pending.
  let cancel = () => {};
  let closed = false;
  res.on('close', () => {
    closed = !res.writableEnded;
    if (closed) cancel();
  });
  try {
    const request = approvals.ask(await readJsonBody(req, MAX_HOOK_BODY_BYTES));
    cancel = request.cancel;
    if (closed) cancel();
    const output = await request.decision;
    if (res.destroyed) return undefined;
    if (output) return sendJson(res, 200, output);
    res.writeHead(200, SECURITY_HEADERS);
    return res.end();
  } catch (error) {
    if (error instanceof ActionError) return sendJson(res, error.status, { success: false, error: error.message });
    throw error;
  }
}

async function handlePost(req, res, url, services) {
  if (url.pathname === HOOK_PATH) return handleHook(req, res, services);
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
// Badges are a convenience: a page never waits longer than this for one (e.g. the first GitHub load).
const NAV_WAIT_MS = 500;

/** Resolves to the promise's value, or null if it fails or takes longer than `ms`. */
function within(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  return Promise.race([promise.catch(() => null), timeout]).finally(() => clearTimeout(timer));
}

/** Header badge counts, added to every page's data so the current page's badges are as fresh as the page. */
async function navFor({ stateService, prService }, { state, prs } = {}) {
  const [sessions, prPage] = await Promise.all([
    state ?? within(stateService.getSessions(), NAV_WAIT_MS),
    prs ?? within(prService.getPrs(), NAV_WAIT_MS),
  ]);
  return navCounts({ state: sessions, prs: prPage });
}

/** The Agents page's data: sessions plus the prompts waiting to be answered and the badges. */
async function agentsPayload(services, data) {
  services.approvals.reconcile(data);
  return {
    ...data,
    approvals: services.approvals.pending(),
    nav: await navFor(services, { state: data }),
    capabilities: { ...services.capabilities, approvalsHook: await services.hookInstalled() },
  };
}

const SSE_HEADERS = { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' };

/**
 * Server-sent events: the Agents page's data now, then again whenever a
 * session or a waiting prompt changes (see agent-feed.js).
 */
async function streamAgents(req, res, services) {
  const { stateService, agentFeed } = services;
  res.writeHead(200, SSE_HEADERS);
  const send = (data) => {
    if (!res.writableEnded && !res.destroyed) res.write(`event: agents\ndata: ${JSON.stringify(data)}\n\n`);
  };
  // Subscribe first, so a change while the first copy is built isn't missed; the page keeps the newest.
  const unsubscribe = agentFeed.subscribe(send);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), STREAM_HEARTBEAT_MS);
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
  try {
    // The cached copy shows at once; it can predate a change missed while the page was hidden, so a fresh one follows.
    send(await agentsPayload(services, await stateService.getSessions()));
    agentFeed.changed();
  } catch (error) {
    res.write(`event: failure\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
  }
}

async function streamPrs(req, res, services) {
  const { prService, capabilities } = services;
  res.writeHead(200, SSE_HEADERS);
  // Skip a page identical to the last one sent (e.g. the initial send racing the first update).
  let lastSent = null;
  const send = async (page) => {
    const { generatedAt, ...content } = page;
    const signature = JSON.stringify(content);
    if (signature === lastSent) return;
    lastSent = signature;
    const nav = await navFor(services, { prs: page });
    res.write(`event: prs\ndata: ${JSON.stringify({ ...page, nav, capabilities })}\n\n`);
  };
  const unsubscribe = prService.subscribe(send);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), STREAM_HEARTBEAT_MS);
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
  try {
    await send(await prService.getPrs());
  } catch (error) {
    res.write(`event: failure\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
  }
}

/**
 * Server-sent events for the live terminal: `ready` with its token and size,
 * `output` as base64 bytes, `resize` when the pane's size changes, `end`
 * when the pane goes. Opening one attaches a
 * tmux client, so only this page may: browsers mark requests from other sites
 * in Sec-Fetch-Site (and couldn't read the stream anyway).
 */
async function streamTerminal(req, res, url, { liveTerminals }) {
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin') return sendJson(res, 403, { success: false, error: 'Cross-origin request refused' });
  const event = (name, data) => { if (!res.writableEnded) res.write(`event: ${name}\ndata: ${data}\n\n`); };
  let close = null;
  let closed = false;
  req.on('close', () => {
    closed = true;
    close?.();
  });
  try {
    close = await liveTerminals.start({ sessionId: url.searchParams.get('sessionId') }, {
      ready: (info) => {
        res.writeHead(200, SSE_HEADERS);
        // If the stream drops, the browser reconnects after this long (a new terminal, a fresh copy).
        res.write(`retry: ${TERMINAL_RETRY_MS}\n\n`);
        event('ready', JSON.stringify(info));
      },
      output: (bytes) => event('output', bytes.toString('base64')),
      resize: (size) => event('resize', JSON.stringify(size)),
      end: () => {
        event('end', '{}');
        res.end();
      },
    });
    if (closed) close();
  } catch (error) {
    if (error instanceof ActionError) return sendJson(res, error.status, { success: false, error: error.message });
    throw error;
  }
  return undefined;
}

/**
 * A waiting prompt in full, for the review pane. A GET, so the Origin check
 * doesn't apply; other sites can't read the answer, and the Host check stops
 * DNS rebinding, as for the rest of the API.
 */
async function sendApprovalDetail(res, url, { approvals }) {
  try {
    return sendJson(res, 200, { success: true, data: await approvals.detail(url.searchParams.get('id')) });
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
      const force = url.searchParams.get('refresh') === '1';
      if (url.pathname === '/api/state') {
        prService.markActive();
        const data = await stateService.getState({ force });
        return sendJson(res, 200, { success: true, data: { ...data, nav: await navFor(services), capabilities: services.capabilities } });
      }
      if (url.pathname === '/api/agents') {
        return sendJson(res, 200, { success: true, data: await agentsPayload(services, await stateService.getSessions({ force })) });
      }
      if (url.pathname === '/api/nav') {
        return sendJson(res, 200, { success: true, data: await navFor(services) });
      }
      if (url.pathname === '/api/agents/stream') return await streamAgents(req, res, services);
      if (url.pathname === '/api/prs/stream') return await streamPrs(req, res, services);
      if (url.pathname === '/api/terminal/live') return await streamTerminal(req, res, url, services);
      if (url.pathname === '/api/approvals/detail') return await sendApprovalDetail(res, url, services);
      if (url.pathname === '/api/prs') {
        const data = await prService.getPrs({ force });
        return sendJson(res, 200, { success: true, data: { ...data, nav: await navFor(services, { prs: data }), capabilities: services.capabilities } });
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

/** Whether Claude Code's settings send permission prompts here, re-read at most every HOOK_CHECK_MS. */
function createHookCheck({ claudeDir, port }) {
  let checked = { at: 0, installed: false };
  return async () => {
    if (Date.now() - checked.at < HOOK_CHECK_MS) return checked.installed;
    const settings = await readClaudeSettings(join(claudeDir, 'settings.json')).catch(() => ({}));
    checked = { at: Date.now(), installed: isHookInstalled(settings, port) };
    return checked.installed;
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

async function main() {
  const config = loadConfigOrExit();
  const cache = createSwrCache();
  const tmux = createTmux();
  // The board reuses the PR sync's details for your PRs; the sync is created just below.
  let prService = null;
  const stateService = createStateService({
    config,
    claude: createClaudeProvider({ claudeDir: config.claudeDir, listTmuxPanes: tmux.listPanes }),
    cache,
    prSnapshot: () => prService?.syncSnapshot() ?? null,
  });
  prService = createPrService({
    settings: config.settings,
    getLocalIndex: () => stateService.getLocal().then(buildLocalIndex),
  });
  const terminal = createTerminal({ app: resolveTerminalApp(config.settings.terminal.app) });
  // Actions only need sessions and worktree paths, so they read the fast sessions view.
  const sessionsView = { getState: stateService.getSessions };
  // Checked once: install tmux, then restart switchyard to get New task and tmux resumes.
  const tmuxInstalled = await tmux.isInstalled();
  const actions = createActionService({ stateService: sessionsView, terminal, tmux, useTmux: tmuxInstalled });
  const tasks = createTaskService({ stateService: sessionsView, tmux });
  const liveTerminals = createLiveTerminals({ actions, tmux });
  // The full state: Clean up needs PR data, which the sessions view leaves out.
  const cleanup = createCleanupService({ stateService });
  const capabilities = { terminal: terminal.app, editorScheme: config.settings.editor.urlScheme, tmux: tmuxInstalled };
  const approvals = createApprovalBroker({ onChange: () => agentFeed.changed() });
  const hookInstalled = createHookCheck(config);
  const services = { stateService, prService, actions, tasks, liveTerminals, cleanup, approvals, hookInstalled, capabilities, port: config.port };
  const logError = (label) => (error) => process.stderr.write(`[switchyard] ${label}: ${error.message}\n`);
  const agentFeed = createAgentFeed({
    load: () => stateService.refreshSessions().then((data) => agentsPayload(services, data)),
    onError: logError('agent update'),
  });
  watchFolder(join(config.claudeDir, 'sessions'), agentFeed.changed, { onError: logError('watching Claude sessions') });
  createServer(createHandler({ ...services, agentFeed })).listen(config.port, HOST, () => {
    process.stdout.write(`switchyard: http://localhost:${config.port}  (roots: ${config.roots.join(', ')})\n`);
    // Warm the cache so the first page load is quick.
    stateService.getState().catch((error) => process.stderr.write(`Initial scan failed: ${error.message}\n`));
    prService.getPrs().catch((error) => process.stderr.write(`Initial PR load failed: ${error.message}\n`));
    prService.start();
  });
}

main().catch((error) => {
  process.stderr.write(`switchyard: ${error.stack ?? error}\n`);
  process.exit(1);
});
