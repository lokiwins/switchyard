import { randomBytes } from 'node:crypto';
import { ActionError } from './errors.js';
import { attachControlClient, hexKeys } from './tmux-control.js';

/*
 * The live terminal: a session's tmux pane, mirrored to the browser and typed
 * into from it. Each open terminal is a control client attached to the pane's
 * session; its output is filtered to the pane and passed on as it arrives.
 * Typing needs the token handed out when the terminal opened, on top of the
 * same-origin checks every action has.
 */

// Scrollback sent when a terminal opens, so you can scroll back a little.
const HISTORY_LINES = 2000;
// One request's worth of typing or pasting; the page splits a longer paste.
export const MAX_INPUT_BYTES = 2048;
// The sizes a terminal may ask its window to take.
const COLS = { min: 20, max: 500 };
const ROWS = { min: 5, max: 200 };
// Home, clear the screen and the scrollback, before redrawing a resized pane.
const CLEAR_SCREEN = Buffer.from('\x1b[H\x1b[2J\x1b[3J');
// tmux reports the pane's size under this subscription, now and whenever it changes.
const SIZE_SUBSCRIPTION = 'size';

/** "120x40" -> { cols, rows }, or null. */
export function parseSize(value) {
  const match = /^(\d+)x(\d+)$/.exec(value);
  return match ? { cols: Number(match[1]), rows: Number(match[2]) } : null;
}

/**
 * The bytes that redraw what a pane shows: its scrollback and screen, then the
 * cursor moved to where the pane has it. capture-pane ends lines with \n
 * only, and its last line has a newline the screen doesn't.
 */
export function seedBytes(capture, { cursorX, cursorY }) {
  const text = capture.toString('utf8').replace(/\n$/, '');
  return Buffer.from(`\x1b[0m${text.replaceAll('\n', '\r\n')}\x1b[${cursorY + 1};${cursorX + 1}H`, 'utf8');
}

export function createLiveTerminals({ actions, tmux, attach = attachControlClient, newToken = () => randomBytes(16).toString('hex') }) {
  const open = new Map();

  /**
   * Start mirroring a session's pane to `sink`: ready({ token, cols, rows })
   * and a copy of the screen, then output(bytes) as the pane prints. When the
   * pane's size changes, resize({ cols, rows }) and a fresh copy of the screen:
   * tmux rewraps old lines its own way, so the page redraws from tmux rather
   * than rewrapping them itself. end() if the pane or tmux goes away. Resolves
   * to a function that closes it.
   */
  async function start(body, sink) {
    const { session, pane } = await actions.tmuxTarget(body);
    const first = await tmux.paneSize(pane);
    const token = newToken();
    // Output that arrives while the screen is being captured, sent after it.
    let held = [];
    // The size the page draws at, and the latest one tmux reported.
    let shown = null;
    let latest = { cols: first.cols, rows: first.rows };
    const differs = () => shown && (latest.cols !== shown.cols || latest.rows !== shown.rows);

    async function redraw(size) {
      held = held ?? [];
      const capture = await tmux.capturePane(pane, HISTORY_LINES);
      if (shown) {
        sink.resize({ cols: size.cols, rows: size.rows });
        sink.output(Buffer.concat([CLEAR_SCREEN, seedBytes(capture, size)]));
      } else {
        sink.ready({ token, cols: size.cols, rows: size.rows });
        sink.output(seedBytes(capture, size));
      }
      held.forEach((data) => sink.output(data));
      held = null;
      shown = { cols: size.cols, rows: size.rows };
    }

    // One redraw at a time; a size reported during one redraws again after it.
    // The size measured for a redraw is the latest: only a new report from
    // tmux can start another, so a stale report can't loop.
    let redrawing = false;
    let again = false;
    const redrawForSize = () => {
      if (redrawing) {
        again = true;
        return;
      }
      redrawing = true;
      tmux.paneSize(pane)
        .then((size) => {
          latest = { cols: size.cols, rows: size.rows };
          return redraw(size);
        })
        // A pane that has gone ends the stream through the client closing.
        .catch(() => {})
        .finally(() => {
          redrawing = false;
          if (!again) return;
          again = false;
          if (differs()) redrawForSize();
        });
    };

    const client = attach({
      session,
      onEvent: (event) => {
        if (event.pane !== pane) return;
        if (event.type === 'subscription' && event.name === SIZE_SUBSCRIPTION) {
          latest = parseSize(event.value) ?? latest;
          if (differs()) redrawForSize();
        } else if (event.type === 'output') {
          if (held) held.push(event.data);
          else sink.output(event.data);
        }
      },
      onClose: () => {
        open.delete(token);
        sink.end();
      },
    });
    open.set(token, { client, pane, window: first.window });
    // Quoted: an unquoted # starts a comment in tmux's command syntax.
    client.command(`refresh-client -B '${SIZE_SUBSCRIPTION}:${pane}:#{pane_width}x#{pane_height}'`);
    try {
      await redraw(first);
    } catch (error) {
      client.close();
      throw error;
    }
    // A size change while the first copy was taken.
    if (differs()) redrawForSize();
    return () => client.close();
  }

  /** Type into an open terminal, exactly: keys, escape sequences, pasted text. */
  function input(body) {
    const terminal = open.get(body?.token);
    if (!terminal) throw new ActionError(404, 'That terminal is no longer open');
    if (typeof body.data !== 'string' || body.data.length === 0) throw new ActionError(400, 'Expected { token, data }');
    const bytes = Buffer.from(body.data, 'utf8');
    if (bytes.length > MAX_INPUT_BYTES) throw new ActionError(413, 'Send at most 2 KB at a time');
    terminal.client.command(`send-keys -t ${terminal.pane} -H ${hexKeys(bytes)}`);
    return { sent: bytes.length };
  }

  /**
   * Ask the terminal's window to take the size the page has room for. tmux
   * decides (the most recently active client wins), and a size change comes
   * back as resize().
   */
  function resize(body) {
    const terminal = open.get(body?.token);
    if (!terminal) throw new ActionError(404, 'That terminal is no longer open');
    const { cols, rows } = body;
    const inRange = (n, { min, max }) => Number.isInteger(n) && n >= min && n <= max;
    if (!inRange(cols, COLS) || !inRange(rows, ROWS)) throw new ActionError(400, 'Expected whole-number cols (20–500) and rows (5–200)');
    terminal.client.command(`refresh-client -C ${terminal.window}:${cols}x${rows}`);
    return { requested: { cols, rows } };
  }

  return { start, input, resize };
}
