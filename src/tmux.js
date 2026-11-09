import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { ActionError } from './errors.js';
import { run } from './exec.js';
import { shellQuoteAlways } from './shell.js';

/*
 * Drives the tmux windows switchyard starts: one session, a window (tab) per
 * task. A session is addressed by its exact name (`=name`), a window by its
 * id (`@4`) and a pane by its id (`%3`). Ids are unique on the tmux server
 * and don't change, so typing and keys reach the right pane wherever, or
 * whether, the session is attached.
 */

const PANE_FORMAT = '#{pane_tty}\t#{session_name}\t#{window_id}\t#{window_name}\t#{pane_id}';
const NEW_WINDOW_FORMAT = '#{window_id}\t#{pane_id}';
const MAX_WINDOW_NAME = 60;
// The PATH a new terminal tab starts from. tmux gives a new window the PATH
// of the tmux command that made it (`-e PATH=` doesn't change that), so that
// command runs with this one: the window's login shell then builds PATH from
// your profile, as a new tab does, instead of inheriting switchyard's, which a
// Node version manager puts its own bin folder (and any old global `claude`
// in it) at the front of.
const LOGIN_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
// Escape stops Claude Code's current turn without exiting it.
const INTERRUPT_KEY = 'Escape';
// Typed text must not contain keys of its own (Return, Esc, Ctrl-…).
const CONTROL_CHARACTERS = /[\0-\x1f\x7f-\x9f\u2028\u2029]/;

export class TmuxError extends ActionError {}

export const hasControlCharacters = (text) => CONTROL_CHARACTERS.test(text);

/** Parse `list-panes -a -F PANE_FORMAT` into tty -> { session, window, windowName, pane }. */
export function parsePanes(text) {
  return new Map(text.split('\n').flatMap((line) => {
    const [tty, session, window, windowName, pane] = line.split('\t');
    return tty && session && window && pane ? [[tty, { session, window, windowName: windowName ?? '', pane }]] : [];
  }));
}

/** A tmux window name from a label: "." and ":" would read as target separators, the rest just reads better as dashes. */
export function windowNameFor(label) {
  return label.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, MAX_WINDOW_NAME);
}

/** The full path of `command` on `path`, or the bare name when it isn't there. */
export function findOnPath(command, path = process.env.PATH ?? '') {
  for (const dir of path.split(delimiter).filter(Boolean)) {
    try {
      accessSync(join(dir, command), constants.X_OK);
      return join(dir, command);
    } catch {
      // Not in this folder.
    }
  }
  return command;
}

function parseNewWindow(text) {
  const [window, pane] = text.trim().split('\t');
  return { window, pane };
}

export function createTmux({ exec = run, locate = () => findOnPath('tmux') } = {}) {
  async function tmux(args, { fromNewTab = false, encoding } = {}) {
    try {
      return fromNewTab
        ? await exec(locate(), args, { env: { ...process.env, PATH: LOGIN_PATH } })
        : await exec('tmux', args, encoding ? { encoding } : undefined);
    } catch (error) {
      if (/ENOENT/.test(error.message)) throw new TmuxError(501, 'tmux is not installed (brew install tmux)');
      throw new TmuxError(502, `tmux: ${error.message}`);
    }
  }

  return {
    /** Whether tmux is installed. */
    async isInstalled() {
      try {
        await exec('tmux', ['-V']);
        return true;
      } catch {
        return false;
      }
    },

    /** Every pane on the server by tty; empty when tmux is missing or not running. */
    async listPanes() {
      try {
        return parsePanes(await exec('tmux', ['list-panes', '-a', '-F', PANE_FORMAT]));
      } catch {
        return new Map();
      }
    },

    /** Whether `session` has a window called `name`; false when the session doesn't exist. */
    async hasWindow(session, name) {
      try {
        const names = await exec('tmux', ['list-windows', '-t', `=${session}`, '-F', '#{window_name}']);
        return names.split('\n').includes(name);
      } catch {
        return false;
      }
    },

    /**
     * Open a window running your shell in `cwd`, in `session`, starting the
     * session (detached) if it isn't running. The window opens in the
     * background, so whoever is attached stays where they are. Resolves to
     * { window, pane } ids.
     */
    async newWindow({ session, name, cwd }) {
      const window = ['-n', name, '-c', cwd, '-P', '-F', NEW_WINDOW_FORMAT];
      const open = async (args) => parseNewWindow(await tmux(args, { fromNewTab: true }));
      const inSession = ['new-window', '-d', '-t', `=${session}:`, ...window];
      const newSession = ['new-session', '-d', '-s', session, ...window];
      try {
        return await open(inSession);
      } catch (error) {
        if (error.status !== 502) throw error;
      }
      try {
        return await open(newSession);
      } catch (error) {
        // Another task started the session in between: add the window to it.
        if (!/duplicate session/.test(error.message)) throw error;
        return await open(inSession);
      }
    },

    /** Make a window the one its session shows. */
    async selectWindow(window) {
      await tmux(['select-window', '-t', window]);
    },

    /** Type one line into a pane and press Enter. */
    async sendLine(pane, text) {
      if (hasControlCharacters(text)) throw new TmuxError(400, 'Refusing to type control characters');
      await tmux(['send-keys', '-t', pane, '-l', '--', text]);
      await tmux(['send-keys', '-t', pane, 'Enter']);
    },

    async interrupt(pane) {
      await tmux(['send-keys', '-t', pane, INTERRUPT_KEY]);
    },

    /** A pane's window, size and cursor position. */
    async paneSize(pane) {
      const [window, ...numbers] = (await tmux(['display-message', '-p', '-t', pane, '#{window_id} #{pane_width} #{pane_height} #{cursor_x} #{cursor_y}']))
        .trim().split(' ');
      const [cols, rows, cursorX, cursorY] = numbers.map(Number);
      return { window, cols, rows, cursorX, cursorY };
    },

    /** What a pane shows right now, as plain text. */
    async screenText(pane) {
      return tmux(['capture-pane', '-p', '-t', pane]);
    },

    /** What a pane shows, with colours, plus up to `history` lines of scrollback, as raw bytes. */
    async capturePane(pane, history) {
      return tmux(['capture-pane', '-p', '-e', '-t', pane, '-S', `-${history}`], { encoding: 'buffer' });
    },

    /** The terminals (ttys) currently attached to a session. */
    async clientTtys(name) {
      return (await tmux(['list-clients', '-t', `=${name}`, '-F', '#{client_tty}'])).split('\n').filter(Boolean);
    },

    /** Close a window; closing a session's last window ends the session. */
    async killWindow(window) {
      await tmux(['kill-window', '-t', window]);
    },

    /** A shell command attaching the session. Any tmux session can be named anything, so the name is always quoted. */
    attachCommand: (name) => `tmux attach-session -t ${shellQuoteAlways(`=${name}`)}`,
  };
}
