import { h, toast } from './dom.js';
import { post, tmuxPlace } from './actions.js';
import { sessionTitle } from './session-text.js';
import { keyInput } from './terminal-keys.js';

/*
 * "Terminal": a session's tmux pane, live in a dialog. The server streams what
 * the pane prints (server-sent events) and xterm.js draws it; what you type is
 * posted back and typed into the pane, keys and all.
 *
 * The page's policy blocks inline styles. xterm.js draws with WebGL, since its
 * default renderer colours cells with style attributes, and the one <style>
 * element it still makes gets this page load's nonce.
 */

const XTERM = '/vendor/xterm/xterm.mjs';
const XTERM_WEBGL = '/vendor/xterm/addon-webgl.mjs';
const XTERM_FIT = '/vendor/xterm/addon-fit.mjs';
const XTERM_CSS = '/vendor/xterm/xterm.css';
// Under the server's 2 KB limit even when every character is three UTF-8 bytes.
const INPUT_CHUNK_CHARS = 600;
// Wait for the pane to stop changing size before asking tmux to match it.
const RESIZE_SETTLE_MS = 120;
// How often, at most, to tell the server how much output has been drawn.
const ACK_EVERY_MS = 200;
// Transparent cells let the glass pane show through; the rest picks out cursor and selection.
const THEME = {
  background: 'rgba(0, 0, 0, 0)',
  cursor: '#7dd3fc',
  cursorAccent: '#0b1220',
  selectionBackground: 'rgba(125, 211, 252, 0.3)',
};

let xtermModule = null;

/** Give <style> elements created from now on this page load's style nonce, so the policy lets them apply. */
function stampStyleNonce() {
  const nonce = document.querySelector('meta[name="style-nonce"]')?.content;
  if (!nonce || document.createElement !== Document.prototype.createElement) return;
  const create = Document.prototype.createElement;
  document.createElement = function createElement(tag, options) {
    const element = create.call(this, tag, options);
    if (String(tag).toLowerCase() === 'style') element.nonce = nonce;
    return element;
  };
}

/** xterm.js, its WebGL renderer and its stylesheet, loaded the first time a terminal opens. */
function loadXterm() {
  if (!document.querySelector(`link[href="${XTERM_CSS}"]`)) {
    document.head.append(h('link', { rel: 'stylesheet', href: XTERM_CSS }));
  }
  stampStyleNonce();
  xtermModule ??= Promise.all([import(XTERM), import(XTERM_WEBGL), import(XTERM_FIT)])
    .then(([{ Terminal }, { WebglAddon }, { FitAddon }]) => ({ Terminal, WebglAddon, FitAddon }));
  return xtermModule;
}

/** Draw with WebGL; if the GPU context is lost, start a new one. False when WebGL isn't available. */
function useWebgl(terminal, WebglAddon) {
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => {
      webgl.dispose();
      useWebgl(terminal, WebglAddon);
    });
    terminal.loadAddon(webgl);
    return true;
  } catch {
    return false;
  }
}

const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/**
 * Typing, sent in order: everything typed before a request returns goes in
 * the next one. Typing while disconnected is dropped, not saved for later:
 * keys you couldn't see land would be a surprise when the terminal returns.
 */
function createTypist(getToken) {
  let queue = '';
  let sending = false;
  async function flush() {
    if (!getToken()) queue = '';
    if (sending || !queue) return;
    sending = true;
    const data = queue.slice(0, INPUT_CHUNK_CHARS);
    queue = queue.slice(data.length);
    try {
      await post('/api/terminal/input', { token: getToken(), data });
    } catch (error) {
      toast(error.message);
      queue = '';
    } finally {
      sending = false;
      flush();
    }
  }
  return (data) => {
    queue += data;
    flush();
  };
}

/**
 * Tells the server how much of its output xterm.js has drawn, so it can pause
 * the pane while the page is behind (a flood of output, a background tab).
 * Batched: at most one report every ACK_EVERY_MS, none while nothing arrives.
 */
function createAcker(getToken) {
  let drawn = 0;
  let timer = null;
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
      clearTimeout(timer);
      timer = null;
      drawn = 0;
    },
    stop() { clearTimeout(timer); },
  };
}

/**
 * Ask tmux to size the window to what fits the pane, once the pane has settled.
 * The page draws at whatever size tmux reports back (another attached
 * terminal may win), so this only asks.
 */
function createFitter(fit, getToken) {
  let timer = null;
  let asked = null;
  const ask = async () => {
    const size = fit.proposeDimensions();
    const token = getToken();
    if (!size || !token || !Number.isFinite(size.cols) || !Number.isFinite(size.rows)) return;
    const key = `${size.cols}x${size.rows}`;
    if (key === asked) return;
    asked = key;
    await post('/api/terminal/resize', { token, cols: size.cols, rows: size.rows }).catch((error) => toast(error.message));
  };
  return {
    soon() {
      clearTimeout(timer);
      timer = setTimeout(ask, RESIZE_SETTLE_MS);
    },
    // After a reconnect the new terminal hasn't been asked yet.
    reset() { asked = null; },
    stop() { clearTimeout(timer); },
  };
}

async function openTerminal(session) {
  const { Terminal, WebglAddon, FitAddon } = await loadXterm();
  const screen = h('div', { class: 'term-screen' });
  const status = h('span', { class: 'pane-pill' }, 'Connecting…');
  let source = null;
  let token = null;
  const terminal = new Terminal({
    allowTransparency: true,
    theme: THEME,
    fontSize: 13,
    lineHeight: 1.15,
    scrollback: 5000,
    cursorBlink: true,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  });
  const fit = new FitAddon();
  const fitter = createFitter(fit, () => token);
  const acker = createAcker(() => token);
  const watchSize = new ResizeObserver(() => fitter.soon());
  const reconnect = h('button', { type: 'button', class: 'pane-btn', hidden: true, onclick: () => connect() }, 'Reconnect');

  const close = () => {
    source?.close();
    watchSize.disconnect();
    fitter.stop();
    acker.stop();
    terminal.dispose();
    dialog.close();
    dialog.remove();
  };
  const dialog = h('dialog', {
    class: 'glass-pane term-pane',
    'aria-label': `Live terminal: ${sessionTitle(session)}`,
    // Esc belongs to the terminal (it stops Claude), so it doesn't close the dialog.
    oncancel: (event) => event.preventDefault(),
  },
  h('header', { class: 'pane-header' },
    h('span', { class: 'pane-dot', 'aria-hidden': 'true' }),
    h('div', { class: 'pane-heading' },
      h('strong', {}, sessionTitle(session)),
      h('span', { class: 'pane-sub' }, tmuxPlace(session.host))),
    status,
    reconnect,
    h('button', { type: 'button', class: 'pane-btn', title: 'Close the terminal (the session keeps running)', onclick: close }, 'Close')),
  screen);
  document.body.append(dialog);
  dialog.showModal();

  terminal.loadAddon(fit);
  terminal.open(screen);
  if (!useWebgl(terminal, WebglAddon)) {
    status.textContent = "Can't draw: WebGL is unavailable";
    return;
  }
  const type = createTypist(() => token);
  terminal.onData(type);
  // Keys xterm.js would send as something Claude doesn't expect, e.g. Shift+Enter as Enter.
  terminal.attachCustomKeyEventHandler((event) => {
    const handled = keyInput(event);
    if (!handled) return true;
    if (handled.send) type(handled.send);
    event.preventDefault();
    return false;
  });
  watchSize.observe(screen);

  const showSize = ({ cols, rows }) => {
    terminal.resize(cols, rows);
    status.textContent = `${cols}×${rows}`;
  };
  const disconnected = (text, { canReconnect }) => {
    token = null;
    dialog.classList.remove('is-live');
    status.textContent = text;
    reconnect.hidden = !canReconnect;
  };

  // Each connection is a new terminal on the server: a new token, a fresh copy of the screen.
  function connect() {
    source?.close();
    reconnect.hidden = true;
    status.textContent = 'Connecting…';
    source = new EventSource(`/api/terminal/live?sessionId=${encodeURIComponent(session.sessionId)}`);
    source.addEventListener('ready', (event) => {
      const info = JSON.parse(event.data);
      token = info.token;
      acker.reset();
      terminal.reset();
      showSize(info);
      dialog.classList.add('is-live');
      fitter.reset();
      fitter.soon();
      terminal.focus();
    });
    source.addEventListener('output', (event) => {
      const bytes = fromBase64(event.data);
      terminal.write(bytes, () => acker.drawn(bytes.length));
    });
    source.addEventListener('resize', (event) => showSize(JSON.parse(event.data)));
    source.addEventListener('end', () => {
      source.close();
      disconnected('Session ended', { canReconnect: false });
    });
    // The browser retries a dropped stream by itself; it gives up when switchyard
    // refuses it (e.g. the session ended) or isn't running.
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) disconnected('Disconnected', { canReconnect: true });
      else disconnected('Reconnecting…', { canReconnect: false });
    };
  }
  connect();
}

/** Open the session's tmux pane here, live. */
export function terminalButton(session) {
  if (session.host?.kind !== 'tmux') return null;
  return h('button', {
    type: 'button',
    class: 'btn btn-action',
    title: `Open tmux window ${tmuxPlace(session.host)} here, live, and type into it`,
    onclick: () => openTerminal(session).catch((error) => toast(error.message)),
  }, 'Terminal');
}
