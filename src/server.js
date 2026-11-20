import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClaudeProvider } from './agents/claude.js';
import { createAgentProviders } from './agents/providers.js';
import { createSwrCache } from './cache.js';
import { CONFIG_FILE, loadConfig } from './config.js';
import { createLiveConfig } from './live-config.js';
import { createSettingsService, createSettingsStore } from './settings-file.js';
import { createSessionGraphs } from './session-graphs.js';
import { navCounts } from './nav.js';
import { createActionService } from './actions.js';
import { createAgentFeed, watchFolder } from './agent-feed.js';
import { createApprovalBroker } from './approvals.js';
import { HOOK_PATH, isHookInstalled, readClaudeSettings } from './claude-hook.js';
import { CSP, newStyleNonce, withStyleNonce } from './csp.js';
import { ActionError } from './errors.js';
import { buildLocalIndex, createPrService } from './prs.js';
import { resolveTerminalApp } from './settings.js';
import { createSessionRemoval } from './session-removal.js';
import { createStateService } from './state.js';
import { createTaskCleanup } from './task-cleanup.js';
import { SWEEP_MS, createDoneTaskSweep } from './done-task-sweep.js';
import { createTaskService } from './tasks.js';
import { createTaskStarts } from './task-starts.js';
import { CLICKUP_API, createClickUp } from './clickup.js';
import { createTaskTools } from './task-tools.js';
import { createTaskHub } from './task-hub.js';
import { createHubStarter } from './hub-start.js';
import { chooseWorktree, closeHubTask, createHubTask, deleteHubTask } from './hub-actions.js';
import { readJsonBody } from './http-body.js';
import { createLeadAccess } from './lead-access.js';
import { createLeadTools } from './lead-tools.js';
import { createMcpEndpoint } from './mcp-endpoint.js';
import { createWorkerLaunch } from './worker-launch.js';
import { createReviews, withReviews } from './review.js';
import { defaultStoreDir } from './json-store.js';
import { createChecks } from './checks.js';
import { createCheckTriggers } from './check-triggers.js';
import { createStatusTracker } from './status-tracker.js';
import { createTicketDetails } from './ticket-details.js';
import { createGithubIssues, repoChoices } from './github-issues.js';
import { linkHubTasks, linkTasks, sessionHubTasks, tagWorktrees, taskForBranch, worktreeHubTasks } from './task-links.js';
import { createTaskSources } from './task-sources.js';
import { createCleanupService } from './cleanup.js';
import { createLiveTerminals } from './live-terminal.js';
import { canReadScreen, createTerminal } from './terminal.js';
import { conditionalState } from './state-etag.js';
import { themeBootScript } from './theme-boot.js';
import { STATIC_FILES, STYLE_NONCE_PAGES } from './static-files.js';
import { createTmux } from './tmux.js';

// Loopback only: the API exposes local paths and agent prompts.
const HOST = '127.0.0.1';
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
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
  '.woff2': 'font/woff2',
};

function sendJson(res, status, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** A 200 with its JSON body, or a 304 with none; both with the version headers. */
function sendConditional(res, { status, headers, body }) {
  const contentType = body === undefined ? {} : { 'Content-Type': 'application/json' };
  res.writeHead(status, { ...SECURITY_HEADERS, ...contentType, 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

/** The theme boot script, with the appearance saved in Settings as its default (see theme-boot.js). */
async function sendThemeBoot(res, settingsService) {
  const source = await readFile(join(PUBLIC_DIR, 'theme-boot.js'), 'utf8');
  const { appearance } = settingsService.view().values;
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': CONTENT_TYPES['.js'], 'Cache-Control': 'no-store' });
  res.end(themeBootScript(source, appearance));
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

// A key pressed in a dialog redraws the screen without changing the session's
// status, which is what pushes updates, so the page is sent one once it has.
const SCREEN_REDRAW_MS = 300;

/** The text a session's host shows: its tmux pane, or its iTerm tab; null for a host whose screen can't be read. */
function screenReader(tmux, terminalFor = (app) => createTerminal({ app })) {
  return (host) => {
    if (host.kind === 'tmux') return tmux.screenText(host.pane);
    if (host.kind === 'terminal' && host.tty && canReadScreen(host.app)) return terminalFor(host.app).screen(host.tty);
    return null;
  };
}

async function answerPrompt({ actions, agentFeed }, body) {
  const result = await actions.answerPrompt(body);
  setTimeout(() => agentFeed?.changed(), SCREEN_REDRAW_MS).unref();
  return result;
}

/** A new task; made from a session or worktree (`from`), it's saved with where that work is, so it shows under it. */
const POST_ROUTES = {
  '/api/prs/copilot-review': ({ prService }, body) => prService.copilotReview(body),
  '/api/approvals/decide': ({ approvals }, body) => approvals.decide(body),
  '/api/terminal/focus': ({ actions }, body) => actions.focusSession(body),
  '/api/settings/save': ({ settingsService }, body) => settingsService.save(body),
  '/api/terminal/show-sessions': ({ actions }) => actions.showTerminalSessions(),
  '/api/terminal/reply': ({ actions }, body) => actions.replyToSession(body),
  '/api/terminal/interrupt': ({ actions }, body) => actions.interruptSession(body),
  '/api/terminal/end': ({ actions }, body) => actions.endSession(body),
  '/api/agents/hide': ({ sessionRemoval }, body) => sessionRemoval.hide(body),
  '/api/agents/unhide': ({ sessionRemoval }, body) => sessionRemoval.unhide(body),
  '/api/agents/trash': ({ sessionRemoval }, body) => sessionRemoval.trash(body),
  '/api/agents/restore': ({ sessionRemoval }, body) => sessionRemoval.restore(body),
  '/api/terminal/answer': answerPrompt,
  '/api/terminal/input': ({ liveTerminals }, body) => liveTerminals.input(body),
  '/api/terminal/resize': ({ liveTerminals }, body) => liveTerminals.resize(body),
  '/api/terminal/ack': ({ liveTerminals }, body) => liveTerminals.ack(body),
  '/api/tasks/new': ({ tasks }, body) => tasks.startTask(body),
  '/api/tasks/trust': ({ taskStarts }, body) => taskStarts.trust(body),
  '/api/worktrees/cleanup': ({ cleanup }, body) => cleanup.cleanUpWorktree(body),
  '/api/terminal/resume': ({ actions }, body) => actions.resumeSession(body),
  '/api/terminal/open': ({ actions }, body) => actions.openWorktree(body),
  '/api/hub/tasks/create': createHubTask,
  '/api/hub/tasks/update': ({ taskHub }, body) => taskHub.update(body),
  '/api/hub/tasks/close': closeHubTask,
  '/api/hub/tasks/reopen': ({ taskHub }, body) => taskHub.reopen(body),
  '/api/hub/tasks/delete': deleteHubTask,
  '/api/hub/tasks/worktree-choice': chooseWorktree,
  '/api/hub/tasks/start': ({ hubStarter }, body) => hubStarter.start(body),
  '/api/hub/tasks/review': ({ reviews }, body) => reviews.start(body),
  '/api/checks/run': ({ checks }, body) => checks.start(body),
  '/api/hub/ticket/status': ({ ticketDetails }, body) => ticketDetails.setStatus(body),
  '/api/task-tools/connect': ({ taskTools }, body) => taskTools.connect(body),
  '/api/task-tools/disconnect': ({ taskTools }, body) => taskTools.disconnect(body),
  '/api/task-tools/workspace': ({ taskTools }, body) => taskTools.chooseWorkspace(body),
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
    const data = await route(services, await readJsonBody(req, MAX_BODY_BYTES));
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
  // Each session's ClickUp task, by its branch, from the tasks already fetched: never a wait on ClickUp.
  const tasks = services.taskTools.cachedTasks();
  // Each session's own task (from the Tasks page); a row without one offers to make it.
  const hubTasks = sessionHubTasks(await services.taskHub.list().catch(() => []), data);
  const withHubTask = (session) => ({ ...session, hubTask: hubTasks[session.sessionId] ?? null });
  return {
    ...data,
    repos: tagWorktrees(data.repos, tasks),
    liveSessions: data.liveSessions.map(withHubTask),
    endedSessions: data.endedSessions.map((session) => ({ ...withHubTask(session), task: taskForBranch(tasks, session.branch) })),
    approvals: services.approvals.pending(),
    // Tasks from New task whose session hasn't shown up: asking to trust the folder, or quit.
    taskStarts: services.taskStarts.list(data.liveSessions),
    nav: await navFor(services, { state: data }),
    capabilities: { ...services.capabilities, approvalsHook: await services.hookInstalled() },
  };
}

/** Your tasks, each with the worktrees working on it (their PRs and sessions), and what the page's buttons can do. */
async function tasksPayload({ taskTools, stateService, capabilities }, { force }) {
  const [result, sessions] = await Promise.all([
    taskTools.tasks({ force }),
    // Without the local picture the tasks still show, just unlinked.
    stateService.getSessions().catch((error) => {
      process.stderr.write(`[switchyard] linking tasks to worktrees: ${error.message}\n`);
      return { repos: [] };
    }),
  ]);
  return { ...result, tasks: linkTasks(result.tasks, sessions.repos), capabilities };
}

/** Your own tasks, each with the worktrees working on it (their PRs and sessions), and what the page's buttons can do. */
async function hubPayload({
  taskHub, taskCleanup, stateService, approvals, taskStarts, capabilities, checks, reviews,
}, { force }) {
  const [tasks, sessions] = await Promise.all([
    taskHub.list(),
    // Rebuilt for each poll (no git status or GitHub calls, so it's quick): a cached copy would be a poll behind,
    // say a PR that came in since. Refresh rescans everything. Without the local picture the tasks still show, with no work.
    (force ? stateService.getSessions({ force }) : stateService.refreshSessions()).catch((error) => {
      process.stderr.write(`[switchyard] linking tasks to worktrees: ${error.message}\n`);
      return { repos: [] };
    }),
  ]);
  return {
    // Each work line with its latest review (see review.js), the reviewer's session apart from the work's own.
    tasks: withReviews(linkHubTasks(tasks, sessions.repos), await reviews.forTasks(tasks, sessions.liveSessions ?? [])),
    // For Start ▾: the repos a task can be started in.
    repos: sessions.repos.map((repo) => ({ name: repo.name, mainPath: repo.mainPath })),
    // For the work's controls (Allow/Deny), and for tasks just started: asking to trust the folder, or quit.
    approvals: approvals.pending(),
    taskStarts: taskStarts.list(sessions.liveSessions ?? []),
    // Worktrees closed tasks left with changes or unmerged commits, waiting for Keep or Delete.
    worktreeChoices: taskCleanup.pending(),
    // Run check: each worktree's latest results (see checks.js), and each repo's check names.
    checks: await checks.results({ repos: sessions.repos }),
    checkNames: checks.names(),
    capabilities,
    checkedAt: Date.now(),
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

/**
 * Server-sent events for the graph page: a session's context graph now, then
 * again whenever its transcript or a subagent's grows (see session-graphs.js).
 */
async function streamGraph(req, res, url, { sessionGraphs }) {
  let stop = () => {};
  let closed = false;
  req.on('close', () => {
    closed = true;
    stop();
  });
  try {
    const unsubscribe = await sessionGraphs.subscribe(url.searchParams.get('session'), (graph) => {
      if (!res.headersSent) res.writeHead(200, SSE_HEADERS);
      if (!res.writableEnded && !res.destroyed) res.write(`event: graph\ndata: ${JSON.stringify(graph)}\n\n`);
    });
    if (closed) return unsubscribe();
    const heartbeat = setInterval(() => res.write(': ping\n\n'), STREAM_HEARTBEAT_MS);
    stop = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
  } catch (error) {
    if (error instanceof ActionError) return sendJson(res, error.status, { success: false, error: error.message });
    throw error;
  }
  return undefined;
}

async function sendGraph(res, url, { sessionGraphs }) {
  try {
    return sendJson(res, 200, { success: true, data: await sessionGraphs.snapshot(url.searchParams.get('session')) });
  } catch (error) {
    if (error instanceof ActionError) return sendJson(res, error.status, { success: false, error: error.message });
    throw error;
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
    // The size the page has room for, so the first screen comes at it (ignored unless it's a usable size).
    const size = (name) => Number(url.searchParams.get(name));
    close = await liveTerminals.start({ sessionId: url.searchParams.get('sessionId'), cols: size('cols'), rows: size('rows') }, {
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
      // A lead's Claude, with its token; it refuses browsers itself (see mcp-endpoint.js).
      if (url.pathname === '/mcp') return await services.mcpEndpoint.handle(req, res);
      if (req.method === 'POST') return await handlePost(req, res, url, services);
      if (req.method !== 'GET') return sendJson(res, 405, { success: false, error: 'Method not allowed' });
      const force = url.searchParams.get('refresh') === '1';
      if (url.pathname === '/api/state') {
        prService.markActive();
        const [data, hubTasks] = await Promise.all([stateService.getState({ force }), services.taskHub.list().catch(() => [])]);
        // Each worktree's task, or whether one can be made from it (a long-lived branch needs a session to save).
        const repos = worktreeHubTasks(data.repos, hubTasks).map((repo) => ({
          ...repo, worktrees: repo.worktrees.map((w) => ({ ...w, canMakeTask: services.taskSources.canMake(w) })),
        }));
        // A page that already has this version is told so, not sent it all again (see state-etag.js).
        const answer = conditionalState(req.headers['if-none-match'], { ...data, repos, nav: await navFor(services), capabilities: services.capabilities });
        return sendConditional(res, answer);
      }
      if (url.pathname === '/api/agents') {
        return sendJson(res, 200, { success: true, data: await agentsPayload(services, await stateService.getSessions({ force })) });
      }
      if (url.pathname === '/api/nav') {
        return sendJson(res, 200, { success: true, data: await navFor(services) });
      }
      if (url.pathname === '/api/agents/stream') return await streamAgents(req, res, services);
      if (url.pathname === '/api/agents/graph') return await sendGraph(res, url, services);
      if (url.pathname === '/api/agents/graph/stream') return await streamGraph(req, res, url, services);
      if (url.pathname === '/api/prs/stream') return await streamPrs(req, res, services);
      if (url.pathname === '/api/terminal/live') return await streamTerminal(req, res, url, services);
      if (url.pathname === '/api/approvals/detail') return await sendApprovalDetail(res, url, services);
      if (url.pathname === '/api/settings') {
        return sendJson(res, 200, { success: true, data: { ...services.settingsService.view(), nav: await navFor(services) } });
      }
      if (url.pathname === '/api/settings/github-repos') {
        return sendJson(res, 200, { success: true, data: await githubRepoChoices(services) });
      }
      if (url.pathname === '/api/task-tools') {
        return sendJson(res, 200, { success: true, data: { ...(await services.taskTools.sources()), nav: await navFor(services) } });
      }
      if (url.pathname === '/api/hub/ticket') {
        try {
          return sendJson(res, 200, { success: true, data: await services.ticketDetails.get(url.searchParams.get('url')) });
        } catch (error) {
          if (error instanceof ActionError) return sendJson(res, error.status, { success: false, error: error.message });
          throw error;
        }
      }
      if (url.pathname === '/api/hub/tasks/draft') {
        const from = url.searchParams.has('session') ? { sessionId: url.searchParams.get('session') } : { worktree: url.searchParams.get('worktree') };
        return sendJson(res, 200, { success: true, data: await services.taskSources.draft(from) });
      }
      if (url.pathname === '/api/hub/tasks') {
        return sendJson(res, 200, { success: true, data: { ...(await hubPayload(services, { force })), nav: await navFor(services) } });
      }
      if (url.pathname === '/api/task-tools/tickets') {
        // Add from ▾: one tracker's open tickets assigned to you.
        const tool = url.searchParams.get('tool');
        const ticketsOf = { clickup: () => services.taskTools.tasks({ force }), github: () => services.githubIssues.assigned({ force }) };
        if (!ticketsOf[tool]) return sendJson(res, 400, { success: false, error: 'Unknown tracker' });
        return sendJson(res, 200, { success: true, data: await ticketsOf[tool]() });
      }
      if (url.pathname === '/api/task-tools/tasks') {
        return sendJson(res, 200, { success: true, data: await tasksPayload(services, { force }) });
      }
      if (url.pathname === '/api/prs') {
        const data = await prService.getPrs({ force });
        return sendJson(res, 200, { success: true, data: { ...data, nav: await navFor(services, { prs: data }), capabilities: services.capabilities } });
      }
      if (url.pathname === '/theme-boot.js') return await sendThemeBoot(res, services.settingsService);
      const file = STATIC_FILES[url.pathname];
      if (file) return await sendStatic(res, file);
      return sendJson(res, 404, { success: false, error: 'Not found' });
    } catch (error) {
      if (error instanceof ActionError) return sendJson(res, error.status, { success: false, error: error.message });
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

/** The repos Settings offers for the GitHub issues list: those your issues are in, and those in your folders. */
async function githubRepoChoices({ githubIssues, stateService, settingsService }) {
  const [assigned, sessions] = await Promise.all([githubIssues.allAssigned(), stateService.getSessions()]);
  const chosen = settingsService.view().values.github.issueRepos;
  return {
    connected: assigned.connected,
    error: assigned.error ?? null,
    repos: repoChoices(assigned.tasks, sessions.repos.map((repo) => repo.github), chosen),
  };
}

/**
 * A terminal that follows the Settings page: actions hold this one, and it
 * passes each call to the app chosen now.
 */
function followingTerminal(config) {
  let current = createTerminal({ app: resolveTerminalApp(config.settings.terminal.app) });
  config.onChange(({ settings }) => {
    current = createTerminal({ app: resolveTerminalApp(settings.terminal.app) });
  });
  return new Proxy({}, { get: (_, key) => current[key] });
}

async function main() {
  const config = createLiveConfig(loadConfigOrExit());
  const cache = createSwrCache();
  const tmux = createTmux();
  // The board reuses the PR sync's details for your PRs; the sync is created just below.
  let prService = null;
  // Ended sessions deleted from the Agents page; it reads the sessions view, made just below.
  const sessionRemoval = createSessionRemoval({
    claudeDir: config.claudeDir,
    getState: () => stateService.getSessions(),
    keepForMs: () => config.settings.agents.endedHistoryMs,
    onChange: () => {
      stateService.sessionsRemoved();
      agentFeed.changed();
    },
  });
  // The agent CLIs switchyard runs and watches; Claude Code for now, more can be added alongside it.
  // Settings › Agent providers choose the default, turn providers off, and say how each runs; read each time, so saves apply at once.
  const agents = createAgentProviders([
    createClaudeProvider({
      claudeDir: config.claudeDir, listTmuxPanes: tmux.listPanes, readScreen: screenReader(tmux), settings: () => config.settings.providers.claude,
    }),
  ], { settings: () => config.settings.providers });
  // Made here, not inside the state service, so checks can hear its commits too (see check-triggers.js).
  const statusTracker = createStatusTracker();
  const stateService = createStateService({
    statusTracker,
    config,
    hiddenSessions: sessionRemoval.hidden,
    agents,
    cache,
    prSnapshot: () => prService?.syncSnapshot() ?? null,
  });
  prService = createPrService({
    settings: config.settings,
    getLocalIndex: () => stateService.getLocal().then(buildLocalIndex),
  });
  const terminal = followingTerminal(config);
  // Actions only need sessions and worktree paths, so they read the fast sessions view.
  const sessionsView = { getState: stateService.getSessions };
  // Checked once: install tmux, then restart switchyard to get New task and tmux resumes.
  const tmuxInstalled = await tmux.isInstalled();
  const actions = createActionService({ stateService: sessionsView, agents, terminal, tmux, useTmux: tmuxInstalled });
  const taskStarts = createTaskStarts({ tmux, onChange: () => agentFeed.changed() });
  const tasks = createTaskService({ stateService: sessionsView, tmux, agents, starts: taskStarts });
  const liveTerminals = createLiveTerminals({ actions, tmux });
  // The full state: Clean up needs PR data, which the sessions view leaves out.
  const cleanup = createCleanupService({ stateService });
  const capabilities = { terminal: terminal.app, editorScheme: config.settings.editor.urlScheme, tmux: tmuxInstalled };
  const approvals = createApprovalBroker({ onChange: () => agentFeed.changed() });
  const hookInstalled = createHookCheck(config);
  // SWITCHYARD_CLICKUP_API points at a stand-in ClickUp, for the screenshots' made-up tasks.
  const clickupApi = process.env.SWITCHYARD_CLICKUP_API ?? CLICKUP_API;
  const githubIssues = createGithubIssues({ issueRepos: () => config.settings.github.issueRepos });
  const taskTools = createTaskTools({ clickupFor: (token) => createClickUp({ token, baseUrl: clickupApi }), github: githubIssues });
  const taskHub = createTaskHub();
  const ticketDetails = createTicketDetails({ taskTools, github: githubIssues });
  const freshRepos = () => stateService.getSessions({ force: true }).then((s) => s.repos);
  // Start as lead: Claude gets switchyard's MCP server, with a token for its own task's workers.
  // Settings › Workers are read as each lead or worker starts, so a saved change applies to the next one.
  const leadAccess = createLeadAccess({ dir: defaultStoreDir(), port: config.port });
  const workerLaunch = createWorkerLaunch({ dir: defaultStoreDir() });
  const hubStarter = createHubStarter({
    taskHub,
    newTask: tasks,
    rediscover: stateService.rediscover,
    getRepos: freshRepos,
    writeLeadConfig: (id) => leadAccess.writeConfig(id, { withoutAsking: config.settings.workers.leadWithoutAsking }),
    prepareWorker: (id) => workerLaunch.prepare(id, config.settings.workers),
  });
  // Review: a read-only reviewer on a task's worktree, its verdict read back from its transcript (see review.js).
  // `checks` is made below; reviews and leads only need it once asked.
  const reviews = createReviews({
    taskHub,
    tmux,
    provider: () => agents.default,
    getRepos: freshRepos,
    checkResults: (options) => checks.results(options),
    readSession: async (cwd, sessionId) => (agents.default.readSession ? agents.default.readSession(cwd, sessionId) : null),
    dir: defaultStoreDir(),
    starts: taskStarts,
  });
  const leadTools = createLeadTools({
    taskHub, hubStarter, getRepos: freshRepos, actions, checkResults: (options) => checks.results(options), reviewStatus: reviews.status,
  });
  const mcpEndpoint = createMcpEndpoint({ leadFrom: leadAccess.leadFrom, toolsFor: leadTools.forLead });
  const taskSources = createTaskSources({
    claudeDir: config.claudeDir, getState: stateService.getSessions, isLongLivedBranch: (branch) => config.settings.git.isLongLivedBranch(branch),
  });
  const settingsService = createSettingsService({
    store: createSettingsStore({ path: CONFIG_FILE }),
    live: config,
    onSaved: async () => {
      await stateService.settingsChanged();
      agentFeed.changed();
      // Turning on "Delete done tasks", or shortening its days, applies now rather than within the hour.
      sweepDoneTasks();
    },
  });
  // Fresh sessions (PR states as the last full scan saw them), so the sessions to end are the ones running now.
  const taskCleanup = createTaskCleanup({
    getState: () => stateService.getSessions({ force: true }),
    getSessions: () => stateService.getSessions({ force: true }),
    endSession: actions.endSession,
    forgetSessions: sessionRemoval.forget,
  });
  const checks = createChecks({
    settings: () => config.settings.checks,
    getState: () => stateService.getSessions({ force: true }),
  });
  const sessionGraphs = createSessionGraphs({ claudeDir: config.claudeDir, home: homedir() });
  const services = {
    sessionGraphs, sessionRemoval, taskCleanup, checks, stateService, prService, actions, tasks, taskStarts, taskTools, taskHub, taskSources, hubStarter, ticketDetails, githubIssues, liveTerminals, cleanup, approvals, hookInstalled, capabilities, settingsService, mcpEndpoint, reviews, port: config.port,
  };
  const logError = (label) => (error) => process.stderr.write(`[switchyard] ${label}: ${error.message}\n`);
  const doneTaskSweep = createDoneTaskSweep({
    taskHub,
    getSessions: () => stateService.getSessions(),
    settings: () => config.settings.tasks,
    deleteTask: (id) => deleteHubTask(services, { id }),
  });
  function sweepDoneTasks() {
    doneTaskSweep.run()
      .then(({ errors }) => errors.forEach((message) => process.stderr.write(`[switchyard] deleting a done task: ${message}\n`)))
      .catch(logError('deleting done tasks'));
  }
  setInterval(sweepDoneTasks, SWEEP_MS).unref();
  const agentFeed = createAgentFeed({
    load: () => stateService.refreshSessions().then((data) => agentsPayload(services, data)),
    onError: logError('agent update'),
  });
  // A saved terminal app or editor reaches the pages with the next data they load.
  config.onChange(({ settings }) => {
    capabilities.terminal = terminal.app;
    capabilities.editorScheme = settings.editor.urlScheme;
  });
  watchFolder(join(config.claudeDir, 'sessions'), agentFeed.changed, { onError: logError('watching Claude sessions') });

  // Checks that run by themselves hear turns end from the agent feed and commits from the status tracker;
  // the feed is only followed while some check runs by itself, so otherwise this costs nothing.
  const checkTriggers = createCheckTriggers({ checks, listTasks: () => taskHub.list() });
  statusTracker.onRefsChanged((mainPath) => {
    if (checks.watchedRepos().length > 0) checkTriggers.refsChanged(mainPath);
  });
  let stopFollowing = null;
  const followForChecks = () => {
    const wanted = checks.watchedRepos().length > 0;
    if (wanted && !stopFollowing) {
      stopFollowing = agentFeed.subscribe(checkTriggers.seen);
      // A first look, so the next turn's end or commit is noticed.
      stateService.getSessions().then(checkTriggers.seen, logError('looking at worktrees for checks'));
    } else if (!wanted && stopFollowing) {
      stopFollowing();
      stopFollowing = null;
    }
  };
  followForChecks();
  config.onChange(followForChecks);
  createServer(createHandler({ ...services, agentFeed })).listen(config.port, HOST, () => {
    process.stdout.write(`switchyard: http://localhost:${config.port}  (roots: ${config.roots.join(', ')})\n`);
    // Warm the cache so the first page load is quick.
    stateService.getState().catch((error) => process.stderr.write(`Initial scan failed: ${error.message}\n`));
    prService.getPrs().catch((error) => process.stderr.write(`Initial PR load failed: ${error.message}\n`));
    prService.start();
    // After the first scan has found the worktrees, so a task's work is known before it's put away.
    setTimeout(sweepDoneTasks, 60_000).unref();
    // ClickUp takes seconds to list tasks, so the Tasks page's first visit finds them ready.
    taskTools.tasks().catch((error) => process.stderr.write(`Initial ClickUp load failed: ${error.message}\n`));
  });
}

main().catch((error) => {
  process.stderr.write(`switchyard: ${error.stack ?? error}\n`);
  process.exit(1);
});
