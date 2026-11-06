import { existsSync } from 'node:fs';
import { isProcessAlive } from './agents/process.js';
import { ActionError } from './errors.js';
import { run } from './exec.js';
import { shellQuote } from './shell.js';
import { canTypeInto, createTerminal, ttyOf } from './terminal.js';
import { freeWindowName, runInWindow } from './task-session.js';
import { createTmux } from './tmux.js';

const SESSION_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
const WORKTREE_LAUNCHES = new Set(['shell', 'claude']);
const MAX_REPLY_LENGTH = 2000;
// Control characters would act as keys (Return submits, Esc interrupts) rather than text;
// C1 controls and Unicode line separators are refused too, in case a terminal acts on them.
const CONTROL_CHARACTERS = /[\0-\x1f\x7f-\x9f\u2028\u2029]/;

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

/** A reply's text: one line of plain text, trimmed. */
export function parseReply(body) {
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > MAX_REPLY_LENGTH || CONTROL_CHARACTERS.test(text)) {
    throw new ActionError(400, `A reply must be one line of text, up to ${MAX_REPLY_LENGTH} characters`);
  }
  return text;
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
  tmux = createTmux(),
  // With tmux, resumed sessions open as tabs of the switchyard session, like new tasks.
  useTmux = false,
  folderExists = existsSync,
  terminalFor = (app) => createTerminal({ app }),
  lookupTty = ttyOf,
  isAlive = isProcessAlive,
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

  /**
   * Resume a session that is no longer running. With tmux, in a new window of
   * the switchyard session, so it can be watched and steered from the page;
   * otherwise in a new tab of the terminal it ran in (Terminal opens a
   * window), or of the configured terminal. Resolves to { host }, and the
   * tmux window ("switchyard:<name>") when it opened one.
   */
  async function resume(session) {
    if (useTmux) {
      if (!SESSION_ID_PATTERN.test(session.sessionId)) throw new ActionError(400, 'Unexpected session id');
      if (typeof session.cwd !== 'string' || !folderExists(session.cwd)) throw new ActionError(409, `Its folder ${session.cwd ?? ''} no longer exists`);
      const name = await freeWindowName(tmux, session.cwd);
      const { place } = await runInWindow(tmux, { name, cwd: session.cwd, command: `claude --resume ${session.sessionId}` });
      return { host: 'tmux', window: place };
    }
    const driver = session.host?.kind === 'terminal' ? driverFor(session.host.app) : terminal;
    await driver.open(session.resumeCommand);
    return { host: session.host?.kind === 'terminal' ? session.host.label : terminal.app };
  }

  /** Bring back a session whose tab or process has gone, for Jump. */
  async function reopen(session) {
    return { precision: 'resumed', ...await resume(session) };
  }

  /** Select the session's tab; resolves false when its process has gone (the tab was closed). */
  async function focusTerminalTab(session, host) {
    const tty = await lookupTty(session.pid);
    if (!tty) return false;
    if (!(await driverFor(host.app).focus(tty))) {
      throw new ActionError(404, `Couldn't find this session's tab in ${host.label}.`);
    }
    return true;
  }

  /**
   * A tmux window: make it the one its session shows, then select the tab the
   * session is attached in, or attach it in a new tab of the configured
   * terminal when it isn't attached anywhere selectable.
   */
  async function focusTmux(host) {
    await tmux.selectWindow(host.window);
    for (const tty of await tmux.clientTtys(host.session)) {
      if (await terminal.focus(tty).catch(() => false)) return { precision: 'tab', host: host.label };
    }
    await terminal.open(tmux.attachCommand(host.session));
    return { precision: 'attached', host: terminal.app };
  }

  /**
   * Get to a session as precisely as its host allows: the exact tab in a
   * terminal app, the folder's window in an editor, otherwise the app itself.
   * A session that has stopped running is resumed in a new tab instead.
   */
  async function focusSession(body) {
    const sessionId = parseSessionId(body);
    const state = await stateService.getState();
    const session = state.liveSessions.find((s) => s.sessionId === sessionId);
    if (!session) {
      const ended = findEndedSession(state, sessionId);
      if (!ended) throw new ActionError(404, 'Unknown session');
      return reopen(ended);
    }
    if (!isAlive(session.pid)) return reopen(session);
    const host = session.host;
    if (!host) throw new ActionError(404, "Couldn't tell which app this session is running in");

    if (host.kind === 'tmux') return focusTmux(host);
    if (host.kind === 'terminal') {
      if (!(await focusTerminalTab(session, host))) return reopen(session);
      return { precision: 'tab', host: host.label };
    }
    if (host.kind === 'editor') {
      await launch(() => launcher.openUrl(editorUrl(host.scheme, session.cwd)), host.label);
      return { precision: 'window', host: host.label };
    }
    await launch(() => launcher.activateApp(host.appName), host.label);
    return { precision: 'app', host: host.label };
  }

  /**
   * Type a message into a running session's tab, as if you'd typed it there.
   * Claude Code queues a message sent while it's working. A message sent while
   * a prompt is open would answer the prompt, so that is refused.
   */
  async function liveSession(sessionId) {
    const state = await stateService.getState();
    const session = state.liveSessions.find((s) => s.sessionId === sessionId);
    if (!session) throw new ActionError(404, "That session isn't running");
    return session;
  }

  /**
   * The tmux pane a session runs in, checked now rather than when the list was built:
   * if Claude has exited, the pane is back at a shell, which would run what we type.
   */
  async function currentTmuxPane(session) {
    const tty = isAlive(session.pid) ? await lookupTty(session.pid) : null;
    const pane = tty ? (await tmux.listPanes()).get(tty) : null;
    if (pane?.pane !== session.host.pane) throw new ActionError(409, 'That session is no longer running in its tmux pane');
    return pane.pane;
  }

  async function replyToSession(body) {
    const sessionId = parseSessionId(body);
    const text = parseReply(body);
    const session = await liveSession(sessionId);
    const inTmux = session.host?.kind === 'tmux';
    if (!inTmux && (session.host?.kind !== 'terminal' || !canTypeInto(session.host.app))) {
      throw new ActionError(501, 'Replying from switchyard works for sessions running in tmux or iTerm');
    }
    if (session.needsYou) throw new ActionError(409, 'It is showing a question or permission prompt; answer that first');
    if (inTmux) {
      await tmux.sendLine(await currentTmuxPane(session), text);
      return { queued: session.status === 'busy' };
    }
    if (!isAlive(session.pid)) throw new ActionError(409, 'That session has ended');
    const tty = await lookupTty(session.pid);
    if (!tty) throw new ActionError(409, "That session's tab has closed");
    if (!(await driverFor(session.host.app).type(tty, text))) {
      throw new ActionError(404, `Couldn't find this session's tab in ${session.host.label}.`);
    }
    return { queued: session.status === 'busy' };
  }

  /** The tmux session and pane a running session is in, for the live terminal; checked like Reply and Stop. */
  async function tmuxTarget(body) {
    const session = await liveSession(parseSessionId(body));
    if (session.host?.kind !== 'tmux') throw new ActionError(501, 'The live terminal works for sessions running in tmux');
    return { session: session.host.session, pane: await currentTmuxPane(session) };
  }

  /** Stop what a session is doing (Esc), as you would in its terminal. Needs tmux to reach it without a tab. */
  async function interruptSession(body) {
    const session = await liveSession(parseSessionId(body));
    if (session.host?.kind !== 'tmux') throw new ActionError(501, 'Interrupting from switchyard works for sessions running in tmux');
    await tmux.interrupt(await currentTmuxPane(session));
    return { interrupted: true };
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
    return { opened: true, ...await resume(session) };
  }

  /** One of a worktree's recent sessions, to resume from its Open menu. */
  function recentSession(state, path, body) {
    const sessionId = parseSessionId(body);
    const worktree = state.repos.flatMap((repo) => repo.worktrees).find((w) => w.path === path);
    const session = worktree?.agents.recent?.find((s) => s.sessionId === sessionId);
    if (!session) throw new ActionError(404, "That session isn't one of this worktree's recent sessions");
    return session;
  }

  /** The command for a new tab in a worktree: a shell or a new Claude session. */
  function worktreeCommand(path, body) {
    const cd = `cd ${shellQuote(path)}`;
    const launch = body.launch ?? 'shell';
    if (!WORKTREE_LAUNCHES.has(launch)) throw new ActionError(400, 'Expected launch to be "shell" or "claude"');
    return launch === 'claude' ? `${cd} && claude` : cd;
  }

  /** Open a new tab in a worktree's folder, optionally starting or resuming a Claude session there. */
  async function openWorktree(body) {
    const state = await stateService.getState();
    const path = findWorktreePath(state, body?.path);
    // A worktree's recent sessions are found by folder, so that's their folder.
    if (body.sessionId !== undefined) return { opened: true, ...await resume({ ...recentSession(state, path, body), cwd: path }) };
    await terminal.open(worktreeCommand(path, body));
    return { opened: true };
  }

  return { focusSession, replyToSession, interruptSession, tmuxTarget, resumeSession, openWorktree };
}
