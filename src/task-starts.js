import { ActionError } from './errors.js';

/*
 * Tasks just started from New task, watched until their Claude session shows
 * up. Claude registers a session only once it's running in a folder it
 * trusts, so until then the page would hear nothing: not that Claude is
 * asking whether to trust the folder, nor that it quit (No, exit) or never
 * ran. This watches the tmux pane switchyard started it in, once a second,
 * and says which, and answers the trust question when asked to.
 */

const WATCH_EVERY_MS = 1000;
// A claude that hasn't shown up in its pane by now never ran (not installed, say).
export const NOT_STARTED_MS = 8000;
// After this long, stop watching; the page stops waiting at the same time.
export const GIVE_UP_MS = 120_000;
// How long an exited task stays listed, for the page to say so.
export const EXITED_KEEP_MS = 30_000;

// What a pane runs when no program is in front: its shell.
const SHELLS = new Set(['bash', 'zsh', 'fish', 'sh', 'dash', 'ksh', 'tcsh', 'csh', 'nu', 'login']);
const isShell = (command) => SHELLS.has(String(command).replace(/^-/, ''));

const RULE = /^\s*─{20,}\s*$/;
// A choice, optionally numbered (older versions), with ❯ on the highlighted one.
const CHOICE = /^\s*(❯)?\s*(?:\d+\.\s+)?(\S.*?)\s*$/;
const HINTS = /\bEnter to confirm\b/;
const TRUST_WORDING = /\btrust\b/i;
const YES = /^Yes\b/i;
const NO = /^No\b/i;
const SGR = /\x1b\[[0-9;:]*m/g;

const trimSlash = (path) => String(path ?? '').replace(/\/+$/, '');

/** A screen's lines without colours, blank ones left out. */
const screenLines = (screen) => String(screen ?? '').replace(SGR, '').split('\n').map((line) => line.trimEnd()).filter((line) => line.trim());

// A file or folder path, which may well contain the word "trust".
const PATH_LINE = /^[~/]/;

/**
 * Claude asking whether to trust the folder, on a pane's screen, or null:
 * its choices (a Yes and a No) with which one is highlighted. Only the
 * choices are read; Claude's wording is left to Claude.
 */
export function parseTrustPrompt(screen) {
  const lines = String(screen ?? '').split('\n').map((line) => line.replace(SGR, '').trimEnd());
  const hints = lines.findLastIndex((line) => HINTS.test(line));
  if (hints < 0) return null;
  // The choices: the block of lines just above the hints.
  let end = hints - 1;
  while (end >= 0 && lines[end].trim() === '') end -= 1;
  let start = end;
  while (start > 0 && lines[start - 1].trim() !== '') start -= 1;
  const options = lines.slice(start, end + 1).map((line) => {
    const [, mark, label] = CHOICE.exec(line) ?? [];
    return { label, selected: Boolean(mark) };
  });
  if (options.length < 2 || !options.some((o) => YES.test(o.label)) || !options.some((o) => NO.test(o.label))) return null;
  const top = lines.slice(0, start).findLastIndex((line) => RULE.test(line)) + 1;
  const asks = lines.slice(top, start).map((line) => line.trim()).some((line) => !PATH_LINE.test(line) && TRUST_WORDING.test(line));
  return asks ? { options } : null;
}

// The command New task typed: claude and its quoted task, which may wrap onto more lines.
const TYPED_COMMAND = /\bclaude\s+'/;

const endsCommand = (line) => line.endsWith("'");

/**
 * Where the command New task typed starts and ends on a fresh window's
 * screen, and how many lines its prompt takes. Keys typed before the shell
 * drew its prompt echo bare first, so the command that counts is the last
 * one after a prompt; its prompt is the lines from there up, below any echo.
 * Null when the command isn't there.
 */
function typedCommand(lines) {
  const matches = lines.flatMap((line, i) => (TYPED_COMMAND.test(line) ? [i] : []));
  if (matches.length === 0) return null;
  const first = matches.findLast((i) => lines[i].search(TYPED_COMMAND) > 0) ?? matches.at(-1);
  const last = lines.findIndex((line, i) => i >= first && endsCommand(line));
  if (last < 0) return null;
  const promptStart = lines.slice(0, first).findLastIndex((line) => TYPED_COMMAND.test(line) || endsCommand(line)) + 1;
  return { first, last, promptLines: first - promptStart + 1 };
}

/**
 * What the shell said when claude failed to start ("claude: command not
 * found"): the lines between the command and the new prompt, which takes as
 * many lines as the first one did. Null when it said nothing.
 */
function shellSaid(screen) {
  const lines = screenLines(screen);
  const command = typedCommand(lines);
  if (!command) return null;
  const said = lines.slice(command.last + 1, lines.length - command.promptLines).map((line) => line.trim());
  return said.length > 0 ? said.join(' ') : null;
}

/**
 * Whether the shell is back at its prompt after the command New task typed:
 * lines follow the command, and the last ends as the prompt before it did
 * ("#", "$", "%", "❯"…), though a prompt's time or folder may have changed.
 */
export function backAtPrompt(screen) {
  const lines = screenLines(screen);
  const command = typedCommand(lines);
  if (!command || command.last === lines.length - 1) return false;
  const typed = lines[command.first];
  const promptEnd = typed.slice(0, typed.search(TYPED_COMMAND)).trim().at(-1);
  return Boolean(promptEnd) && lines.at(-1).trim().endsWith(promptEnd);
}

const sameTrust = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * @param {{ tmux: { paneCommand, screenText, pressKey, confirm }, onChange: () => void, now?: () => number, timers?: { setInterval, clearInterval } }} deps
 */
export function createTaskStarts({ tmux, onChange, now = Date.now, timers = globalThis }) {
  const tracked = new Map();
  let timer = null;

  const watching = () => [...tracked.values()].some((t) => t.state !== 'exited');

  function startTimer() {
    if (timer || !watching()) return;
    timer = timers.setInterval(() => { tick().catch(() => {}); }, WATCH_EVERY_MS);
    timer?.unref?.();
  }

  function stopTimerIfIdle() {
    if (!timer || watching()) return;
    timers.clearInterval(timer);
    timer = null;
  }

  /** Start watching a task's pane. */
  function track({ path, place, pane }) {
    tracked.set(trimSlash(path), {
      path, place, pane, state: 'starting', trust: null, detail: null, startedAt: now(), seenRunning: false, exitedAt: null,
    });
    startTimer();
  }

  function exit(task, detail) {
    Object.assign(task, { state: 'exited', trust: null, detail, exitedAt: now() });
  }

  /** Look at one pane; true when what the page should say has changed. */
  async function look(task) {
    const before = { state: task.state, trust: task.trust };
    const command = await tmux.paneCommand(task.pane).catch(() => null);
    if (command === null) {
      exit(task, 'The tmux window was closed');
      return true;
    }
    const running = !isShell(command);
    if (running) task.seenRunning = true;
    const screen = await tmux.screenText(task.pane).catch(() => '');
    // Back at the prompt on two looks running: the command ran and finished (claude failed outright, say).
    task.atPrompt = !running && backAtPrompt(screen) ? (task.atPrompt ?? 0) + 1 : 0;
    if (!running && (task.seenRunning || task.atPrompt >= 2 || now() - task.startedAt >= NOT_STARTED_MS)) {
      // Once claude has run, what's left on screen is its own, not the shell's.
      exit(task, task.seenRunning ? null : shellSaid(screen));
      return true;
    }
    task.trust = running ? parseTrustPrompt(screen) : null;
    task.state = task.trust ? 'asking-trust' : 'starting';
    return task.state !== before.state || !sameTrust(task.trust, before.trust);
  }

  /** Look at every watched pane once, and say if anything changed. */
  async function tick() {
    const live = [...tracked.values()].filter((t) => t.state !== 'exited');
    const changed = await Promise.all(live.map(look));
    stopTimerIfIdle();
    if (changed.some(Boolean)) onChange();
  }

  /**
   * What the page shows: every task still to come, or exited a moment ago.
   * Tasks whose session is among `liveSessions` are done and dropped, as are
   * ones given up on.
   */
  function list(liveSessions) {
    const arrived = new Set(liveSessions.map((s) => trimSlash(s.cwd)));
    for (const [key, task] of tracked) {
      const expired = task.state === 'exited' ? now() - task.exitedAt >= EXITED_KEEP_MS : now() - task.startedAt >= GIVE_UP_MS;
      if (arrived.has(key) || expired) tracked.delete(key);
    }
    stopTimerIfIdle();
    return [...tracked.values()].map(({ path, place, state, trust, detail }) => ({ path, place, state, trust, detail }));
  }

  /** Answer the trust question for a task switchyard started: move to Yes (or No), then confirm. */
  async function trust(body) {
    if (typeof body?.trust !== 'boolean') throw new ActionError(400, 'Say whether to trust the folder');
    const task = tracked.get(trimSlash(body?.path));
    if (!task || task.state === 'exited') throw new ActionError(404, 'That task is not starting');
    // Read the screen now: the highlight may have moved since the last look.
    const prompt = parseTrustPrompt(await tmux.screenText(task.pane));
    if (!prompt) throw new ActionError(409, 'Claude is not asking whether to trust the folder');
    const target = prompt.options.findIndex((o) => (body.trust ? YES : NO).test(o.label));
    const from = Math.max(0, prompt.options.findIndex((o) => o.selected));
    const key = target > from ? 'Down' : 'Up';
    for (let i = 0; i < Math.abs(target - from); i += 1) await tmux.pressKey(task.pane, key);
    await tmux.confirm(task.pane);
    Object.assign(task, { state: 'starting', trust: null });
    onChange();
    return { trusted: body.trust };
  }

  return { track, tick, list, trust };
}
