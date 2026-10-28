import { ActionError } from './errors.js';
import { run } from './exec.js';

/*
 * Drives a macOS terminal app through AppleScript. Every value reaches the
 * script as an `argv` item, never spliced into the script text, so a path or
 * command cannot change what the script does.
 */

const SCRIPTS = {
  iTerm: {
    focus: `on run argv
  set targetTty to item 1 of argv
  tell application "iTerm"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if tty of s is targetTty then
            select w
            tell t to select
            tell s to select
            activate
            return "found"
          end if
        end repeat
      end repeat
    end repeat
  end tell
  return "missing"
end run`,
    // Not running: launch it and reuse the window it opens on its own.
    // Running with no windows: open a window. Otherwise: a new tab in the front window.
    open: `on run argv
  set cmd to item 1 of argv
  set wasRunning to application "iTerm" is running
  tell application "iTerm"
    activate
    if not wasRunning then
      repeat 30 times
        if (count of windows) > 0 then exit repeat
        delay 0.1
      end repeat
    end if
    if (count of windows) is 0 then
      create window with default profile
    else if wasRunning then
      tell current window to create tab with default profile
    end if
    tell current session of current window to write text cmd
  end tell
  return "opened"
end run`,
  },
  Terminal: {
    focus: `on run argv
  set targetTty to item 1 of argv
  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is targetTty then
          set selected of t to true
          set index of w to 1
          activate
          return "found"
        end if
      end repeat
    end repeat
  end tell
  return "missing"
end run`,
    open: `on run argv
  tell application "Terminal"
    activate
    do script (item 1 of argv)
  end tell
  return "opened"
end run`,
  },
};

export const TERMINAL_APPS = Object.keys(SCRIPTS);

export class TerminalError extends ActionError {}

// AppleScript error -1743: the user hasn't allowed this process to control the app.
const NOT_AUTHORIZED = /-1743|not authori[sz]ed/i;

async function osascript(script, args, app) {
  try {
    return (await run('osascript', ['-e', script, ...args])).trim();
  } catch (error) {
    if (NOT_AUTHORIZED.test(error.message)) {
      throw new TerminalError(403,
        `macOS blocked switchyard from controlling ${app}. Allow it in System Settings → Privacy & Security → Automation.`);
    }
    throw new TerminalError(502, `Could not talk to ${app}: ${error.message}`);
  }
}

/** A typed shell command must be a single line, or the extra lines would run too. */
export function assertSingleLine(command) {
  if (/[\r\n\0]/.test(command)) throw new TerminalError(400, 'Refusing to run a multi-line command');
  return command;
}

/** The controlling terminal device of a process, e.g. "/dev/ttys004", or null. */
export async function ttyOf(pid) {
  try {
    const tty = (await run('ps', ['-o', 'tty=', '-p', String(pid)])).trim();
    return tty && tty !== '??' ? `/dev/${tty}` : null;
  } catch {
    return null;
  }
}

export function createTerminal({ app, platform = process.platform }) {
  const scripts = SCRIPTS[app];
  const supported = platform === 'darwin' && Boolean(scripts);

  function ensureSupported() {
    if (!supported) throw new TerminalError(501, 'Terminal actions are only available on macOS with iTerm or Terminal.');
  }

  return {
    app: supported ? app : null,

    /** Bring the tab owning `tty` to the front. Resolves false if no tab has it. */
    async focus(tty) {
      ensureSupported();
      return (await osascript(scripts.focus, [tty], app)) === 'found';
    },

    /** Open a new tab and type `command` into it. */
    async open(command) {
      ensureSupported();
      await osascript(scripts.open, [assertSingleLine(command)], app);
    },
  };
}
