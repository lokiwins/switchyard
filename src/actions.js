import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { isProcessAlive } from './agents/process.js';
import { parseScreenPrompt } from './agents/screen-prompt.js';
import { ActionError } from './errors.js';
import { run } from './exec.js';
import { shellQuote } from './shell.js';
import { canAnswerIn, canTypeInto, createTerminal, ttyOf } from './terminal.js';
import { TASK_SESSION, freeWindowName, runInWindow } from './task-session.js';
import { createTmux } from './tmux.js';

const SESSION_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
const WORKTREE_LAUNCHES = new Set(['shell', 'claude']);
const MAX_REPLY_LENGTH = 2000;
// Control characters would act as keys (Return submits, Esc interrupts) rather than text;
// C1 controls and Unicode line separators are refused too, in case a terminal acts on them.
const CONTROL_CHARACTERS = /[\0-\x1f\x7f-\x9f\u2028\u2029]/;
// After keys that should open a text field, text is typed only once the screen shows it
// open, checked from this long after the keys until the wait runs out.
const TEXT_FIELD_DELAY_MS = 100;
const TEXT_FIELD_WAIT_MS = 1_000;
const SCREEN_POLL_MS = 50;

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

/** Which option the page answered, checked before the screen is read: a number key 1–9, and your own text for a text field. */
export function parseAnswer(body) {
  if (body?.next === true) return { next: true };
  const { number, label } = body ?? {};
  if (!Number.isInteger(number) || number < 1 || number > 9 || typeof label !== 'string') {
    throw new ActionError(400, 'Expected { number: 1-9, label: "<option>" }');
  }
  // Amending (Tab on a Yes or No) always comes with an instruction.
  const amend = body.amend === true;
  return { number, label, amend, text: body.text === undefined && !amend ? null : parseReply(body) };
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
  textFieldDelayMs = TEXT_FIELD_DELAY_MS,
  textFieldWaitMs = TEXT_FIELD_WAIT_MS,
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
   * A task in tmux: select the tab already showing its window, or open it
   * in a tab of its own, showing just that window (see openView in tmux.js).
   */
  async function focusTmux(host) {
    if (await showsInIterm(host.session, host.pane)) return { precision: 'tab', host: 'iTerm' };
    for (const tty of await tmux.clientsShowing(host.window)) {
      if (await terminal.focus(tty).catch(() => false)) return { precision: 'tab', host: host.label };
    }
    await terminal.open(await tmux.openView(host.window));
    return { precision: 'opened', host: terminal.app };
  }

  /** Whether iTerm's tmux integration shows `session`, and could bring `pane`'s window forward. */
  async function showsInIterm(session, pane) {
    if (terminal.app !== 'iTerm' || (await tmux.integrationClients(session)).length === 0) return false;
    return terminal.focusTmuxPane(pane);
  }

  /**
   * Every task's window, in iTerm: its tmux integration (`tmux -CC`) shows
   * each tmux window as an iTerm window or tab of its own. Brought forward
   * when iTerm already shows them, opened in a new tab otherwise.
   */
  async function showTerminalSessions() {
    if (terminal.app !== 'iTerm') throw new ActionError(501, 'Showing terminal sessions needs iTerm, for its tmux integration');
    if (!(await tmux.hasSession(TASK_SESSION))) throw new ActionError(404, 'No terminal sessions yet: start one with New task');
    if (await showsInIterm(TASK_SESSION, await tmux.activePane(TASK_SESSION))) return { precision: 'tab', host: 'iTerm' };
    await terminal.open(await tmux.integrationCommand(TASK_SESSION));
    return { precision: 'opened', host: 'iTerm' };
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

  // Panes and tabs an answer is being sent to: a second answer would land on whatever the first one brings up.
  const answering = new Set();

  /** The tty of a session's terminal tab, checked now: if Claude has exited or the tab is someone else's, nothing is pressed. */
  async function currentTab(session) {
    const tty = isAlive(session.pid) ? await lookupTty(session.pid) : null;
    if (!tty || tty !== session.host.tty) throw new ActionError(409, `That session is no longer running in its ${session.host.label} tab`);
    return tty;
  }

  /**
   * Where a session's dialog is read and answered: its tmux pane, or its iTerm
   * tab. `id` names it for one-answer-at-a-time; read() gives the text it shows.
   */
  async function dialogScreen(session) {
    const host = session.host;
    if (host?.kind === 'tmux') {
      const pane = await currentTmuxPane(session);
      return {
        id: pane,
        read: () => tmux.screenText(pane),
        press: (key) => tmux.pressKey(pane, key),
        typeLine: (text) => tmux.sendLine(pane, text),
      };
    }
    if (host?.kind === 'terminal' && canAnswerIn(host.app)) {
      const tty = await currentTab(session);
      const driver = driverFor(host.app);
      const found = (ok) => {
        if (!ok) throw new ActionError(404, `Couldn't find this session's tab in ${host.label}.`);
      };
      return {
        id: tty,
        read: async () => (await driver.screen(tty)) ?? '',
        press: async (key) => found(await driver.pressKey(tty, key)),
        typeLine: async (text) => found(await driver.enterLine(tty, text)),
      };
    }
    throw new ActionError(501, 'Answering from switchyard works for sessions running in tmux or iTerm');
  }

  /** Whether the screen comes to show `question` with an option `matches`, waiting up to textFieldWaitMs. */
  async function screenShows(screen, question, matches) {
    await delay(textFieldDelayMs);
    const deadline = Date.now() + textFieldWaitMs;
    for (;;) {
      const prompt = parseScreenPrompt(await screen.read());
      if (prompt?.question === question && prompt.options.some(matches)) return true;
      if (Date.now() >= deadline) return false;
      await delay(SCREEN_POLL_MS);
    }
  }

  /**
   * Add an instruction to a permission prompt's Yes or No, as Tab does in the
   * terminal: arrows move the selection to it (its number would answer
   * straight away), Tab turns it into a text field, then the text is typed.
   * Each step waits for the screen to show it worked; typed into anything
   * else, the text would be keys.
   */
  async function amend(screen, prompt, option, text) {
    const from = prompt.options.findIndex((o) => o.selected);
    const to = prompt.options.indexOf(option);
    if (from < 0) throw new ActionError(409, "Its screen doesn't show which option is selected");
    for (let i = 0; i < Math.abs(to - from); i += 1) await screen.press(to > from ? 'Down' : 'Up');
    const isSelected = (o) => o.number === option.number && o.selected;
    if (!(await screenShows(screen, prompt.question, (o) => isSelected(o) && o.label === option.label))) {
      throw new ActionError(409, `Couldn't select "${option.label}" on its screen, so nothing was typed`);
    }
    await screen.press('Tab');
    if (!(await screenShows(screen, prompt.question, (o) => isSelected(o) && o.label !== option.label))) {
      throw new ActionError(409, `"${option.label}" didn't open for an instruction, so nothing was typed`);
    }
    await screen.typeLine(text);
    return { answered: `${option.label}, and ${text}` };
  }

  async function pressAnswer(screen, body, choice) {
    const prompt = parseScreenPrompt(await screen.read());
    if (!prompt || prompt.question !== body.question) throw new ActionError(409, "Its screen isn't showing that question any more");
    if (choice.next) {
      if (!prompt.tabs) throw new ActionError(409, 'That question has no next tab');
      await screen.press('Right');
      return { answered: 'next' };
    }
    const option = prompt.options.find((o) => o.number === choice.number);
    if (option?.label !== choice.label) throw new ActionError(409, `Its screen no longer shows "${choice.number}. ${choice.label}"`);
    if (choice.amend) {
      if (!option.amends) throw new ActionError(400, 'This option takes no instruction');
      return amend(screen, prompt, option, choice.text);
    }
    if (option.takesText !== (choice.text !== null)) {
      throw new ActionError(400, option.takesText ? 'Type your answer for this option' : 'This option takes no text');
    }
    await screen.press(String(option.number));
    if (choice.text === null) return { answered: option.label };
    // Typed into a dialog whose text field didn't open, the text would be keys: "1" would pick option 1.
    if (!(await screenShows(screen, prompt.question, (o) => o.number === option.number && o.selected))) {
      throw new ActionError(409, `Its text field for "${option.label}" didn't open, so nothing was typed`);
    }
    await screen.typeLine(choice.text);
    return { answered: choice.text };
  }

  /**
   * Answer the dialog a session in tmux or iTerm is showing, as if you'd pressed the
   * option's number in its terminal (or →, to go on to a question's next
   * tab). The screen is read again first: if it no longer shows the question
   * and option the page saw, nothing is pressed, since the same number
   * would answer something else.
   */
  async function answerPrompt(body) {
    const sessionId = parseSessionId(body);
    const choice = parseAnswer(body);
    const session = await liveSession(sessionId);
    if (!session.needsYou) throw new ActionError(409, "It isn't waiting for an answer");
    const screen = await dialogScreen(session);
    if (answering.has(screen.id)) throw new ActionError(409, 'An answer to it is already being sent');
    answering.add(screen.id);
    try {
      return await pressAnswer(screen, body, choice);
    } finally {
      answering.delete(screen.id);
    }
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

  return { focusSession, showTerminalSessions, replyToSession, interruptSession, answerPrompt, tmuxTarget, resumeSession, openWorktree };
}
