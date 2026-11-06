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
// Flow control: output sent that the page hasn't drawn yet. Above HIGH the pane
// is paused; below LOW it continues. xterm.js's guide suggests at most ~500 KB
// in flight to keep typing responsive.
const HIGH_WATER_BYTES = 512 * 1024;
const LOW_WATER_BYTES = 128 * 1024;
// An acknowledgement can't claim more than this at once.
const MAX_ACK_BYTES = 64 * 1024 * 1024;

/**
 * Counts output sent to the page and not yet drawn there. Calls pause() once
 * more than `high` bytes are in flight, and resume() once acknowledgements
 * bring it under `low`.
 */
export function createFlow({ high = HIGH_WATER_BYTES, low = LOW_WATER_BYTES, pause, resume }) {
  let inFlight = 0;
  let paused = false;
  return {
    sent(bytes) {
      inFlight += bytes;
      if (paused || inFlight <= high) return;
      paused = true;
      pause();
    },
    acked(bytes) {
      inFlight = Math.max(0, inFlight - bytes);
      if (!paused || inFlight >= low) return;
      paused = false;
      resume();
    },
    get inFlight() { return inFlight; },
    get paused() { return paused; },
  };
}

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
   * than rewrapping them itself. When the page falls behind (see ack), the
   * pane is paused in tmux, and redrawn from a fresh copy once it catches up.
   * end() if the pane or tmux goes away. Resolves to a function that closes it.
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
    let client = null;
    // tmux drops a paused pane's output, so catching up means redrawing from a copy.
    const flow = createFlow({
      pause: () => client.command(`refresh-client -A '${pane}:pause'`),
      resume: () => {
        client.command(`refresh-client -A '${pane}:continue'`);
        scheduleRedraw({ always: true });
      },
    });
    const send = (bytes) => {
      sink.output(bytes);
      flow.sent(bytes.length);
    };

    async function redraw(size) {
      held = held ?? [];
      const capture = await tmux.capturePane(pane, HISTORY_LINES);
      if (shown) {
        sink.resize({ cols: size.cols, rows: size.rows });
        send(Buffer.concat([CLEAR_SCREEN, seedBytes(capture, size)]));
      } else {
        sink.ready({ token, cols: size.cols, rows: size.rows });
        send(seedBytes(capture, size));
      }
      held.forEach(send);
      held = null;
      shown = { cols: size.cols, rows: size.rows };
    }

    // One redraw at a time. A request during one runs after it: always when
    // catching up, and for a size report only if the size still differs. The
    // size measured for a redraw is the latest, so a stale report can't loop.
    let redrawing = false;
    let queued = null;
    const scheduleRedraw = ({ always = false } = {}) => {
      if (redrawing) {
        queued = { always: always || Boolean(queued?.always) };
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
          const next = queued;
          queued = null;
          if (next && (next.always || differs())) scheduleRedraw(next);
        });
    };

    client = attach({
      session,
      onEvent: (event) => {
        if (event.pane !== pane) return;
        if (event.type === 'subscription' && event.name === SIZE_SUBSCRIPTION) {
          latest = parseSize(event.value) ?? latest;
          if (differs()) scheduleRedraw();
        } else if (event.type === 'output') {
          if (held) held.push(event.data);
          else send(event.data);
        }
      },
      onClose: () => {
        open.delete(token);
        sink.end();
      },
    });
    open.set(token, { client, pane, window: first.window, flow });
    // Quoted: an unquoted # starts a comment in tmux's command syntax.
    client.command(`refresh-client -B '${SIZE_SUBSCRIPTION}:${pane}:#{pane_width}x#{pane_height}'`);
    try {
      await redraw(first);
    } catch (error) {
      client.close();
      throw error;
    }
    // A size change while the first copy was taken.
    if (differs()) scheduleRedraw();
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

  /** The page has drawn `bytes` more of the output it was sent. */
  function ack(body) {
    const terminal = open.get(body?.token);
    if (!terminal) throw new ActionError(404, 'That terminal is no longer open');
    const { bytes } = body;
    if (!Number.isInteger(bytes) || bytes < 1 || bytes > MAX_ACK_BYTES) throw new ActionError(400, 'Expected { token, bytes }');
    terminal.flow.acked(bytes);
    return { inFlight: terminal.flow.inFlight };
  }

  return { start, input, resize, ack };
}
