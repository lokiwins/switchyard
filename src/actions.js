import { ActionError } from './errors.js';
import { run } from './exec.js';
import { shellQuote } from './shell.js';
import { createTerminal, ttyOf } from './terminal.js';

const SESSION_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
const WORKTREE_LAUNCHES = new Set(['shell', 'claude']);

/** Editors open a folder (and focus the window that already has it) via <scheme>://file/<path>. */
export function editorUrl(scheme, path) {
  // Encode each segment: encodeURI would leave "#" and "?" in folder names to be read as URL syntax.
  return `${scheme}://file${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** macOS `open`, run without a shell. */
const macLauncher = {
  openUrl: (url) => run('open', [url]),
  activateApp: (appName) => run('open', ['-a', appName]),
};

export function parseSessionId(body) {
  const id = body?.sessionId;
  if (typeof id !== 'string' || !SESSION_ID_PATTERN.test(id)) throw new ActionError(400, 'Expected { sessionId: "<id>" }');
  return id;
}

/** A session that has ended, from the Agents list or a worktree's last session. */
export function findEndedSession(state, sessionId) {
  const ended = state.endedSessions.find((s) => s.sessionId === sessionId);
  if (ended) return ended;
  for (const repo of state.repos) {
    for (const w of repo.worktrees) {
      if (w.agents.live.length === 0 && w.agents.last?.sessionId === sessionId) return w.agents.last;
    }
  }
  return null;
}

/** A worktree path exactly as discovered; anything else is refused. */
export function findWorktreePath(state, path) {
  if (typeof path !== 'string') throw new ActionError(400, 'Expected { path: "<worktree path>" }');
  const known = state.repos.some((repo) => repo.worktrees.some((w) => w.path === path && !w.prunable));
  if (!known) throw new ActionError(404, 'That folder is not one of your worktrees');
  return path;
}

/**
 * Terminal actions. The browser only names a session or worktree; commands
 * are always built here from what the server itself discovered.
 */
export function createActionService({
  stateService,
  terminal,
  terminalFor = (app) => createTerminal({ app }),
  lookupTty = ttyOf,
  launcher = macLauncher,
  platform = process.platform,
}) {
  const drivers = new Map();
  const driverFor = (app) => {
    if (!drivers.has(app)) drivers.set(app, terminalFor(app));
    return drivers.get(app);
  };

  async function launch(step, label) {
    if (platform !== 'darwin') throw new ActionError(501, 'Jumping to sessions is only available on macOS');
    try {
      await step();
    } catch (error) {
      throw new ActionError(502, `Could not open ${label}: ${error.message}`);
    }
  }

  async function focusTerminalTab(session, host) {
    const tty = await lookupTty(session.pid);
    if (!tty) throw new ActionError(410, 'That session has no terminal (it may have just exited)');
    if (!(await driverFor(host.app).focus(tty))) {
      throw new ActionError(404, `Couldn't find this session's tab in ${host.label}.`);
    }
  }

  /**
   * Get to a running session as precisely as its host allows: the exact tab in
   * a terminal app, the folder's window in an editor, otherwise the app itself.
   */
  async function focusSession(body) {
    const sessionId = parseSessionId(body);
    const state = await stateService.getState();
    const session = state.liveSessions.find((s) => s.sessionId === sessionId);
    if (!session) throw new ActionError(404, 'That session is no longer running');
    const host = session.host;
    if (!host) throw new ActionError(404, "Couldn't tell which app this session is running in");

    if (host.kind === 'terminal') {
      await focusTerminalTab(session, host);
      return { precision: 'tab', host: host.label };
    }
    if (host.kind === 'editor') {
      await launch(() => launcher.openUrl(editorUrl(host.scheme, session.cwd)), host.label);
      return { precision: 'window', host: host.label };
    }
    await launch(() => launcher.activateApp(host.appName), host.label);
    return { precision: 'app', host: host.label };
  }

  /** Open a new tab that resumes an ended session in its own folder. */
  async function resumeSession(body) {
    const sessionId = parseSessionId(body);
    const state = await stateService.getState();
    if (state.liveSessions.some((s) => s.sessionId === sessionId)) {
      throw new ActionError(409, 'That session is still running; use Jump instead');
    }
    const session = findEndedSession(state, sessionId);
    if (!session) throw new ActionError(404, 'Unknown session');
    await terminal.open(session.resumeCommand);
    return { opened: true };
  }

  /** The command for a new tab in a worktree: a shell, a new Claude session, or one of its sessions resumed. */
  function worktreeCommand(state, path, body) {
    const cd = `cd ${shellQuote(path)}`;
    if (body.sessionId !== undefined) {
      const sessionId = parseSessionId(body);
      const worktree = state.repos.flatMap((repo) => repo.worktrees).find((w) => w.path === path);
      const session = worktree?.agents.recent?.find((s) => s.sessionId === sessionId);
      if (!session) throw new ActionError(404, "That session isn't one of this worktree's recent sessions");
      return session.resumeCommand;
    }
    const launch = body.launch ?? 'shell';
    if (!WORKTREE_LAUNCHES.has(launch)) throw new ActionError(400, 'Expected launch to be "shell" or "claude"');
    return launch === 'claude' ? `${cd} && claude` : cd;
  }

  /** Open a new tab in a worktree's folder, optionally starting or resuming a Claude session there. */
  async function openWorktree(body) {
    const state = await stateService.getState();
    const path = findWorktreePath(state, body?.path);
    await terminal.open(worktreeCommand(state, path, body));
    return { opened: true };
  }

  return { focusSession, resumeSession, openWorktree };
}
