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
    // Types into the session that owns the tty, then presses Return, without bringing iTerm forward.
    type: `on run argv
  set targetTty to item 1 of argv
  tell application "iTerm"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if tty of s is targetTty then
            tell s to write text (item 2 of argv)
            return "typed"
          end if
        end repeat
      end repeat
    end repeat
  end tell
  return "missing"
end run`,
    // The text a tab shows, found with "whose", which is about twice as fast as walking every tab.
    screen: `on run argv
  tell application "iTerm"
    repeat with w in windows
      repeat with found in (sessions of tabs of w whose tty is (item 1 of argv))
        repeat with s in found
          return "screen:" & (contents of s)
        end repeat
      end repeat
    end repeat
  end tell
  return "missing"
end run`,
    // Sends characters to the tab without a Return: a dialog key, without bringing iTerm forward.
    press: `on run argv
  tell application "iTerm"
    repeat with w in windows
      repeat with found in (sessions of tabs of w whose tty is (item 1 of argv))
        repeat with s in found
          tell s to write text (item 2 of argv) newline no
          return "pressed"
        end repeat
      end repeat
    end repeat
  end tell
  return "missing"
end run`,
    // A line for a dialog's text field: the text, then Return on its own. Sent together, as
    // "write text" sends them, the field takes the newline as part of a paste and doesn't submit.
    enterLine: `on run argv
  tell application "iTerm"
    repeat with w in windows
      repeat with found in (sessions of tabs of w whose tty is (item 1 of argv))
        repeat with s in found
          tell s to write text (item 2 of argv) newline no
          delay 0.1
          tell s to write text (ASCII character 13) newline no
          return "typed"
        end repeat
      end repeat
    end repeat
  end tell
  return "missing"
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
    // The text a tab shows. Terminal has no way to send a tab keys without bringing it to the
    // front, so its dialogs can be shown on the page but not answered from it.
    screen: `on run argv
  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        -- "contents of t" alone is the tab t refers to, not its text: AppleScript's own "contents".
        if tty of t is (item 1 of argv) then return "screen:" & (contents of (contents of t))
      end repeat
    end repeat
  end tell
  return "missing"
end run`,
  },
};

export const TERMINAL_APPS = Object.keys(SCRIPTS);

/** Whether switchyard can type into one of this app's tabs (Terminal can't target a tab without focusing it). */
export const canTypeInto = (app) => Boolean(SCRIPTS[app]?.type);

/** Whether switchyard can read what one of this app's tabs shows, e.g. a dialog waiting for an answer. */
export const canReadScreen = (app) => Boolean(SCRIPTS[app]?.screen);

/** Whether switchyard can also press keys in one of this app's tabs, to answer a dialog. */
export const canAnswerIn = (app) => Boolean(SCRIPTS[app]?.press);

// The keys that work a dialog, as the characters a terminal sends for them.
const DIALOG_KEYS = {
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [String(n), String(n)])),
  Right: '\x1b[C',
  Up: '\x1b[A',
  Down: '\x1b[B',
  Tab: '\t',
};

export class TerminalError extends ActionError {}

// AppleScript error -1743: the user hasn't allowed this process to control the app.
const NOT_AUTHORIZED = /-1743|not authori[sz]ed/i;

async function osascript(script, args, app, exec = run) {
  try {
    return (await exec('osascript', ['-e', script, ...args])).trim();
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

export function createTerminal({ app, platform = process.platform, exec = run }) {
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
      return (await osascript(scripts.focus, [tty], app, exec)) === 'found';
    },

    /** Type a line into the tab owning `tty` and submit it. Resolves false if no tab has it. */
    async type(tty, text) {
      ensureSupported();
      if (!scripts.type) throw new TerminalError(501, `switchyard can't type into ${app} tabs`);
      return (await osascript(scripts.type, [tty, assertSingleLine(text)], app, exec)) === 'typed';
    },

    /** The text the tab owning `tty` shows, or null if no tab has it. */
    async screen(tty) {
      ensureSupported();
      if (!scripts.screen) throw new TerminalError(501, `switchyard can't read ${app} tabs`);
      const output = await osascript(scripts.screen, [tty], app, exec);
      return output.startsWith('screen:') ? output.slice('screen:'.length) : null;
    },

    /** Press a key that works a dialog (a digit, Right, Up, Down or Tab) in the tab owning `tty`. Resolves false if no tab has it. */
    async pressKey(tty, key) {
      ensureSupported();
      if (!Object.hasOwn(DIALOG_KEYS, key)) throw new TerminalError(400, 'Only an option number, arrows or Tab can be pressed');
      if (!scripts.press) throw new TerminalError(501, `switchyard can't press keys in ${app} tabs`);
      return (await osascript(scripts.press, [tty, DIALOG_KEYS[key]], app, exec)) === 'pressed';
    },

    /** Type a line into a dialog's text field in the tab owning `tty`, then press Return. Resolves false if no tab has it. */
    async enterLine(tty, text) {
      ensureSupported();
      if (!scripts.enterLine) throw new TerminalError(501, `switchyard can't type into ${app} tabs`);
      return (await osascript(scripts.enterLine, [tty, assertSingleLine(text)], app, exec)) === 'typed';
    },

    /** Open a new tab and type `command` into it. */
    async open(command) {
      ensureSupported();
      await osascript(scripts.open, [assertSingleLine(command)], app, exec);
    },
  };
}
