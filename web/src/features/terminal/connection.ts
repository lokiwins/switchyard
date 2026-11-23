import type { FitAddon } from '@xterm/addon-fit';
import type { WebglAddon } from '@xterm/addon-webgl';
import type { IDisposable, ITerminalOptions, Terminal } from '@xterm/xterm';
import { keyInput } from '../../../../public/terminal-keys.js';
import { post } from '../../lib/api';
import { currentXtermOptions } from '../../lib/themes';
import { toast } from '../../stores/toast';

/*
 * "Terminal": a session's tmux pane, live in a dialog. The server streams what
 * the pane prints (server-sent events) and xterm.js draws it; what you type is
 * posted back and typed into the pane, keys and all. This is the part without
 * React: the terminal, the stream, typing, sizes. TerminalPane shows it.
 *
 * The page's policy blocks inline styles. xterm.js draws with WebGL, since its
 * default renderer colours cells with style attributes, and the one <style>
 * element it still makes gets this page load's nonce.
 */

type Xterm = typeof import('./xterm');

// Under the server's 2 KB limit even when every character is three UTF-8 bytes.
const INPUT_CHUNK_CHARS = 600;
// Wait for the pane to stop changing size before asking tmux to match it.
const RESIZE_SETTLE_MS = 120;
// How often, at most, to tell the server how much output has been drawn.
const ACK_EVERY_MS = 200;
// How long output waits for a size the page asked for, before it's drawn anyway (tmux may keep another size).
const RESIZE_HOLD_MS = 400;
const THEME_EVENT = 'switchyard:theme';

// What a terminal is drawn with; the same for every one, so a parked terminal fits any session.
const TERMINAL_OPTIONS: ITerminalOptions = {
  allowTransparency: true,
  fontSize: 13,
  lineHeight: 1.15,
  scrollback: 5000,
  cursorBlink: true,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

interface Size { cols: number; rows: number }
type Timer = ReturnType<typeof setTimeout>;

/** What terminal-keys.js answers for a key: `{ send }` when it handles the key (send is null to swallow it), else null. */
const keyFor = keyInput as (event: KeyboardEvent) => { send: string | null } | null;

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** xterm.js's colours for the terminal theme chosen now. */
const xtermColours = (): ITerminalOptions => currentXtermOptions() as ITerminalOptions;

export const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** Give <style> elements created from now on this page load's style nonce, so the policy lets them apply. */
function stampStyleNonce(): void {
  const nonce = document.querySelector<HTMLMetaElement>('meta[name="style-nonce"]')?.content;
  if (!nonce || document.createElement !== Document.prototype.createElement) return;
  const create = Document.prototype.createElement;
  document.createElement = function createElement(this: Document, tag: string, options?: ElementCreationOptions) {
    const element = create.call(this, tag, options);
    if (String(tag).toLowerCase() === 'style') element.nonce = nonce;
    return element;
  } as typeof document.createElement;
}

let xtermModule: Promise<Xterm> | null = null;

/** xterm.js, its WebGL renderer and its stylesheet, loaded the first time a terminal is wanted. */
function loadXterm(): Promise<Xterm> {
  // Before the import: in development Vite adds the stylesheet as a <style> element, which needs the nonce too.
  stampStyleNonce();
  xtermModule ??= import('./xterm');
  // A chunk that failed to load (say, switchyard restarted with a new build) is tried again next time.
  xtermModule.catch(() => { xtermModule = null; });
  return xtermModule;
}

/** Draw with WebGL; if the GPU context is lost, start a new one. False when WebGL isn't available. */
function drawWithWebgl(terminal: Terminal, Webgl: typeof WebglAddon): boolean {
  try {
    const webgl = new Webgl();
    webgl.onContextLoss(() => {
      webgl.dispose();
      drawWithWebgl(terminal, Webgl);
    });
    terminal.loadAddon(webgl);
    return true;
  } catch {
    return false;
  }
}

/** The cols and rows the pane has room for, or null while it has none (not laid out yet). */
function fitted(fit: FitAddon): Size | null {
  const size = fit.proposeDimensions();
  return size && Number.isFinite(size.cols) && Number.isFinite(size.rows) ? { cols: size.cols, rows: size.rows } : null;
}

/**
 * Typing, sent in order: everything typed before a request returns goes in
 * the next one. Typing while disconnected is dropped, not saved for later:
 * keys you couldn't see land would be a surprise when the terminal returns.
 */
function createTypist(getToken: () => string | null): (data: string) => void {
  let queue = '';
  let sending = false;
  async function flush(): Promise<void> {
    if (!getToken()) queue = '';
    if (sending || !queue) return;
    sending = true;
    const data = queue.slice(0, INPUT_CHUNK_CHARS);
    queue = queue.slice(data.length);
    try {
      await post('/api/terminal/input', { token: getToken(), data });
    } catch (error) {
      toast(messageOf(error));
      queue = '';
    } finally {
      sending = false;
      void flush();
    }
  }
  return (data) => {
    queue += data;
    void flush();
  };
}

interface Acker { drawn: (bytes: number) => void; reset: () => void; stop: () => void }

/**
 * Tells the server how much of its output xterm.js has drawn, so it can pause
 * the pane while the page is behind (a flood of output, a background tab).
 * Batched: at most one report every ACK_EVERY_MS, none while nothing arrives.
 */
function createAcker(getToken: () => string | null): Acker {
  let drawn = 0;
  let timer: Timer | null = null;
  const report = () => {
    timer = null;
    const token = getToken();
    const bytes = drawn;
    drawn = 0;
    if (!token || bytes === 0) return;
    post('/api/terminal/ack', { token, bytes }).catch(() => {});
  };
  return {
    drawn(bytes) {
      drawn += bytes;
      timer ??= setTimeout(report, ACK_EVERY_MS);
    },
    // A new connection is a new terminal on the server, which starts at zero.
    reset() {
      if (timer) clearTimeout(timer);
      timer = null;
      drawn = 0;
    },
    stop() {
      if (timer) clearTimeout(timer);
    },
  };
}

interface Fitter { soon: () => void; reset: () => void; stop: () => void }

/**
 * Ask tmux to size the window to what fits the pane, once the pane has settled.
 * The page draws at whatever size tmux reports back (another attached
 * terminal may win), so this only asks.
 */
function createFitter(fit: FitAddon, getToken: () => string | null, onAsk: () => void): Fitter {
  let timer: Timer | undefined;
  let asked: string | null = null;
  const ask = async () => {
    const size = fitted(fit);
    const token = getToken();
    if (!size || !token) return;
    const key = `${size.cols}x${size.rows}`;
    if (key === asked) return;
    asked = key;
    onAsk();
    await post('/api/terminal/resize', { token, cols: size.cols, rows: size.rows }).catch((error: unknown) => toast(messageOf(error)));
  };
  return {
    soon() {
      clearTimeout(timer);
      timer = setTimeout(() => void ask(), RESIZE_SETTLE_MS);
    },
    // After a reconnect the new terminal hasn't been asked yet.
    reset() { asked = null; },
    stop() { clearTimeout(timer); },
  };
}

interface HeldOutput {
  hold: () => void;
  /** Keep `bytes` back while output is held; false when it isn't. */
  keep: (bytes: Uint8Array) => boolean;
  release: (how: { drop: boolean }) => void;
}

/*
 * Asking for a new size: what the pane prints until the size comes back is drawn for the new size, and
 * would look squashed in the old one; the fresh copy of the screen that follows the size has it all.
 * So it's held, and dropped then (or written, if the size doesn't change after all).
 */
function createHeldOutput(writeOut: (bytes: Uint8Array) => void, dropped: (bytes: number) => void): HeldOutput {
  let held: { chunks: Uint8Array[]; timer: Timer } | null = null;
  const release = ({ drop }: { drop: boolean }) => {
    if (!held) return;
    clearTimeout(held.timer);
    const { chunks } = held;
    held = null;
    if (!drop) chunks.forEach(writeOut);
    else dropped(chunks.reduce((sum, c) => sum + c.length, 0));
  };
  return {
    hold() {
      held ??= { chunks: [], timer: setTimeout(() => release({ drop: false }), RESIZE_HOLD_MS) };
    },
    keep(bytes) {
      if (!held) return false;
      held.chunks.push(bytes);
      return true;
    },
    release,
  };
}

interface Built { terminal: Terminal; fit: FitAddon; screen: HTMLDivElement; webgl: boolean }
interface PaneTerminal extends Built { release: () => void }

/*
 * The terminal's screen fills the pane under its header. xterm.css and xterm.js
 * itself paint the viewport black; the glass shows through it instead.
 */
const SCREEN_CLASS = [
  'flex-1 min-h-0 pt-2.5 pr-1.5 pb-2.5 pl-3.5',
  '[&_.xterm-viewport]:bg-transparent! [&_.xterm-viewport]:overscroll-contain',
  '[&_.xterm_.slider]:bg-[color-mix(in_srgb,var(--pane-accent)_22%,transparent)]! [&_.xterm_.slider]:rounded-xs',
].join(' ');

/** Where the shared terminal waits: laid out at a pane's size, so WebGL can draw, but out of sight. */
const PARKING_CLASS = 'fixed left-[-10000px] top-0 w-[720px] h-[480px] overflow-hidden pointer-events-none opacity-0 *:h-full';

function newScreen(): HTMLDivElement {
  const screen = document.createElement('div');
  screen.className = SCREEN_CLASS;
  return screen;
}

/** A terminal with its fit and WebGL renderers, drawn once into `screen` (so WebGL compiles its shaders now). */
function buildTerminal({ Terminal: XtermTerminal, WebglAddon: Webgl, FitAddon: Fit }: Xterm, screen: HTMLDivElement): Built {
  const terminal = new XtermTerminal({ ...TERMINAL_OPTIONS, ...xtermColours() });
  const fit = new Fit();
  terminal.loadAddon(fit);
  terminal.open(screen);
  const webgl = drawWithWebgl(terminal, Webgl);
  terminal.write(' ');
  return { terminal, fit, screen, webgl };
}

/*
 * One terminal is kept between panes. Setting up xterm's WebGL renderer (a GPU
 * context, its shaders, the first draw) blocks the page for a moment, which
 * made opening the pane stutter; so it's built once, ahead of time where it
 * can be, and parked out of sight while no pane shows it. Each pane connects
 * it to its session afresh.
 */
let shared: Promise<Built> | null = null;
let sharedInUse = false;

/** Where the shared terminal waits, laid out (so WebGL can draw) but out of sight. */
function parking(): HTMLElement {
  const found = document.getElementById('term-parking');
  if (found) return found;
  const lot = document.createElement('div');
  lot.id = 'term-parking';
  lot.className = PARKING_CLASS;
  lot.setAttribute('aria-hidden', 'true');
  document.body.append(lot);
  return lot;
}

function sharedTerminal(): Promise<Built> {
  shared ??= loadXterm().then((xterm) => {
    const screen = newScreen();
    parking().append(screen);
    return buildTerminal(xterm, screen);
  });
  shared.catch(() => { shared = null; });
  return shared;
}

/** Get the terminal ready before it's wanted (say, when a Terminal button is pointed at), so opening is quick. */
export function prewarmTerminal(): void {
  sharedTerminal().catch(() => {});
}

/**
 * The shared terminal for a pane, or, when another pane has it, one of its own.
 * Null when the pane went while it waited (React's development double mount
 * does this), so the next pane, not a gone one, gets the shared terminal.
 */
async function terminalForPane(gone: () => boolean): Promise<PaneTerminal | null> {
  if (!sharedInUse) {
    const ready = await sharedTerminal();
    if (gone()) return null;
    if (!sharedInUse) {
      sharedInUse = true;
      return { ...ready, release: () => { sharedInUse = false; } };
    }
  }
  const xterm = await loadXterm();
  if (gone()) return null;
  const own = buildTerminal(xterm, newScreen());
  return {
    ...own,
    release: () => {
      own.terminal.dispose();
      own.screen.remove();
    },
  };
}

/** What the pane shows of the connection. */
export interface TerminalView {
  setStatus: (text: string) => void;
  setLive: (live: boolean) => void;
  setCanReconnect: (can: boolean) => void;
  /** The terminal couldn't be made (xterm.js didn't load). */
  failed: (message: string) => void;
}

export interface LiveTerminal {
  reconnect: () => void;
  focus: () => void;
  close: () => void;
}

interface Connection extends LiveTerminal { connect: () => void }

interface Ready extends Size { token: string }

const isSize = (value: unknown): value is Size => typeof value === 'object' && value !== null
  && Number.isFinite((value as Partial<Size>).cols) && Number.isFinite((value as Partial<Size>).rows);
const isReady = (value: unknown): value is Ready => isSize(value) && typeof (value as Partial<Ready>).token === 'string';

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Show `pane`'s terminal in `slot` and stream `sessionId`'s tmux pane into it. */
function connectPane(sessionId: string, slot: HTMLElement, pane: PaneTerminal, view: TerminalView): Connection {
  const { terminal, fit, screen, webgl, release } = pane;
  // A terminal kept from an earlier pane starts this one clean, in the colours chosen now.
  terminal.reset();
  Object.assign(terminal.options, xtermColours());
  slot.append(screen);
  // Fill the pane now, at the size it has room for, rather than at the size the terminal was parked at.
  const roomFor = fitted(fit);
  if (roomFor) terminal.resize(roomFor.cols, roomFor.rows);

  let source: EventSource | null = null;
  let token: string | null = null;
  const getToken = () => token;
  const acker = createAcker(getToken);
  const writeOut = (bytes: Uint8Array) => terminal.write(bytes, () => acker.drawn(bytes.length));
  const held = createHeldOutput(writeOut, acker.drawn);
  const fitter = createFitter(fit, getToken, held.hold);
  const watchSize = new ResizeObserver(() => fitter.soon());
  // A new terminal theme, or page theme it matches, recolours the open terminal.
  const recolor = () => { Object.assign(terminal.options, xtermColours()); };
  document.addEventListener(THEME_EVENT, recolor);
  const hooks: IDisposable[] = [];
  const focus = () => terminal.focus();

  const close = () => {
    document.removeEventListener(THEME_EVENT, recolor);
    source?.close();
    source = null;
    token = null;
    held.release({ drop: true });
    watchSize.disconnect();
    fitter.stop();
    acker.stop();
    // Unhook this session from the terminal, clear it, and park it for the next pane.
    hooks.forEach((hook) => hook.dispose());
    terminal.attachCustomKeyEventHandler(() => true);
    terminal.reset();
    parking().append(screen);
    release();
  };

  if (!webgl) {
    view.setStatus("Can't draw: WebGL is unavailable");
    return { connect: () => {}, reconnect: () => {}, focus, close };
  }
  const type = createTypist(getToken);
  hooks.push(terminal.onData(type));
  // Keys xterm.js would send as something Claude doesn't expect, e.g. Shift+Enter as Enter.
  terminal.attachCustomKeyEventHandler((event) => {
    const handled = keyFor(event);
    if (!handled) return true;
    if (handled.send) type(handled.send);
    event.preventDefault();
    return false;
  });
  watchSize.observe(screen);

  const showSize = ({ cols, rows }: Size) => {
    terminal.resize(cols, rows);
    view.setStatus(`${cols}×${rows}`);
  };
  const disconnected = (text: string, canReconnect: boolean) => {
    token = null;
    view.setLive(false);
    view.setStatus(text);
    view.setCanReconnect(canReconnect);
  };

  // Each connection is a new terminal on the server: a new token, a fresh copy of the screen.
  let pendingSize: Size | null = null;
  function connect(): void {
    source?.close();
    pendingSize = null;
    held.release({ drop: true });
    view.setCanReconnect(false);
    view.setStatus('Connecting…');
    // Ask to start at the pane's size, so the first screen comes at it and is drawn once.
    const size = fitted(fit);
    const sized = size ? `&cols=${size.cols}&rows=${size.rows}` : '';
    const stream = new EventSource(`/api/terminal/live?sessionId=${encodeURIComponent(sessionId)}${sized}`);
    source = stream;
    stream.addEventListener('ready', (event) => {
      const info = parseJson(event.data);
      if (!isReady(info)) return;
      token = info.token;
      acker.reset();
      terminal.reset();
      showSize(info);
      view.setLive(true);
      fitter.reset();
      fitter.soon();
      terminal.focus();
    });
    stream.addEventListener('output', (event) => {
      const bytes = fromBase64(event.data);
      // A new size is applied with the fresh copy of the screen that follows it, so they're drawn together.
      if (pendingSize) {
        showSize(pendingSize);
        pendingSize = null;
      } else if (held.keep(bytes)) {
        return;
      }
      writeOut(bytes);
    });
    // The server sends a fresh copy of the screen right after a size change. Resizing now would draw the
    // old screen rewrapped to the new width (squashed) until that copy came, so the size waits for it.
    stream.addEventListener('resize', (event) => {
      const size = parseJson(event.data);
      if (!isSize(size)) return;
      pendingSize = { cols: size.cols, rows: size.rows };
      held.release({ drop: true });
    });
    stream.addEventListener('end', () => {
      stream.close();
      disconnected('Session ended', false);
    });
    // The browser retries a dropped stream by itself; it gives up when switchyard
    // refuses it (e.g. the session ended) or isn't running.
    stream.onerror = () => {
      if (stream.readyState === EventSource.CLOSED) disconnected('Disconnected', true);
      else disconnected('Reconnecting…', false);
    };
  }
  connect();
  return { connect, reconnect: connect, focus, close };
}

/**
 * Open a live terminal for `sessionId` in `slot`, telling `view` how it goes.
 * The terminal arrives asynchronously; closing before it does gives it straight
 * back. Close stops everything: the stream, the timers, the size watcher, the
 * theme listener, and parks the terminal for the next pane.
 */
export function startLiveTerminal(sessionId: string, slot: HTMLElement, view: TerminalView): LiveTerminal {
  let closed = false;
  let connection: Connection | null = null;
  terminalForPane(() => closed)
    .then((pane) => {
      if (!pane) return;
      // Still parked and untouched, so giving it back is all closing needs.
      if (closed) {
        pane.release();
        return;
      }
      connection = connectPane(sessionId, slot, pane, view);
    })
    .catch((error: unknown) => {
      if (!closed) view.failed(messageOf(error));
    });
  return {
    reconnect: () => connection?.reconnect(),
    focus: () => connection?.focus(),
    close: () => {
      if (closed) return;
      closed = true;
      connection?.close();
      connection = null;
    },
  };
}
