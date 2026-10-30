import { h, timeAgo, toast } from './dom.js';

const EDITOR_LABELS = { vscode: 'VS Code', 'vscode-insiders': 'VS Code Insiders', cursor: 'Cursor', windsurf: 'Windsurf' };

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await res.json();
  if (!payload.success) throw new Error(payload.error ?? `HTTP ${res.status}`);
  return payload.data;
}

/** A button that runs a server action, disabling itself meanwhile and toasting the outcome. */
function actionButton(label, title, perform) {
  return h('button', {
    type: 'button',
    class: 'btn btn-action',
    title,
    onclick: async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const message = await perform();
        if (message) toast(message);
      } catch (error) {
        toast(error.message);
      } finally {
        button.disabled = false;
      }
    },
  }, label);
}

/** Get to a running session: its exact tab in a terminal, its window in an editor, or its app. */
export function jumpButton(session) {
  const host = session.host;
  if (!host) return null;
  const isTerminal = host.kind === 'terminal';
  const title = isTerminal ? `Switch to this session's tab in ${host.label}`
    : host.kind === 'editor' ? `Bring the ${host.label} window for this folder forward`
      : `Bring ${host.label} to the front`;
  return actionButton(isTerminal ? 'Jump' : `Open ${host.label}`, title, async () => {
    const result = await post('/api/terminal/focus', { sessionId: session.sessionId });
    if (result.precision === 'resumed') return `The session had closed, so it's resuming in a new ${result.host} tab`;
    if (result.precision === 'window') return `Opened ${result.host}. The session is in one of its terminals.`;
    return null;
  });
}

/** Resume an ended session in a new terminal tab. */
export function resumeButton(session, caps) {
  if (!caps?.terminal) return null;
  return actionButton('Resume', `Resume this session in a new ${caps.terminal} tab`, async () => {
    await post('/api/terminal/resume', { sessionId: session.sessionId });
    return `Resuming in ${caps.terminal}`;
  });
}

// The folder whose Open menu is showing; pages re-render on a timer, so it is kept here to survive that.
let openMenuPath = null;

function closeMenus(except) {
  for (const menu of document.querySelectorAll('details.menu[open]')) {
    if (menu !== except) menu.open = false;
  }
}

document.addEventListener('click', (event) => {
  if (!event.target.closest('details.menu')) closeMenus(null);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeMenus(null);
});
// The panel is fixed-positioned (tables scroll and would clip it), so it can't follow a scroll.
document.addEventListener('scroll', () => closeMenus(null), { capture: true, passive: true });

const PANEL_GAP = 4;
const VIEWPORT_MARGIN = 8;

/** Put the panel under its button, right-aligned, flipping above when there's no room below. */
function placePanel(menu) {
  const panel = menu.querySelector('.menu-panel');
  const button = menu.querySelector('summary').getBoundingClientRect();
  const below = button.bottom + PANEL_GAP;
  const fitsBelow = below + panel.offsetHeight <= window.innerHeight - VIEWPORT_MARGIN;
  panel.style.top = `${fitsBelow ? below : Math.max(VIEWPORT_MARGIN, button.top - PANEL_GAP - panel.offsetHeight)}px`;
  panel.style.left = `${Math.max(VIEWPORT_MARGIN, button.right - panel.offsetWidth)}px`;
}

function sessionLabel(session) {
  const t = session.transcript ?? {};
  return t.title ?? t.agentName ?? t.lastPrompt ?? session.sessionId.slice(0, 8);
}

/**
 * "Open ▾" for a worktree: a new terminal tab with a plain shell, a new Claude
 * session, or one of the folder's recent sessions resumed.
 */
export function openMenu(path, sessions, caps) {
  if (!caps?.terminal) return null;
  const choice = (children, body, title) => h('button', {
    type: 'button',
    class: 'menu-item',
    role: 'menuitem',
    title,
    onclick: async (event) => {
      const menu = event.currentTarget.closest('details');
      openMenuPath = null;
      menu.open = false;
      try {
        await post('/api/terminal/open', { path, ...body });
      } catch (error) {
        toast(error.message);
      }
    },
  }, children);

  return h('details', {
    class: 'menu',
    open: openMenuPath === path,
    ontoggle: (event) => {
      const menu = event.currentTarget;
      if (menu.open) {
        openMenuPath = path;
        closeMenus(menu);
        placePanel(menu);
      } else if (openMenuPath === path) {
        openMenuPath = null;
      }
    },
  },
  h('summary', { class: 'btn btn-action', title: `Open a new ${caps.terminal} tab here` }, 'Open ▾'),
  h('div', { class: 'menu-panel', role: 'menu' },
    choice('Shell', { launch: 'shell' }, `cd into this folder in a new ${caps.terminal} tab`),
    choice('New Claude session', { launch: 'claude' }, 'Start claude in this folder'),
    sessions.length > 0 && h('div', { class: 'menu-label' }, 'Resume'),
    sessions.map((session) => choice([
      h('span', { class: 'menu-title' }, sessionLabel(session)),
      h('span', { class: 'menu-meta' }, timeAgo(session.updatedAt)),
    ], { sessionId: session.sessionId }, session.transcript?.lastPrompt ?? undefined))));
}

/** Open a folder in the configured editor; a plain link, handled by the editor's URL scheme. */
export function editorLink(path, caps) {
  const scheme = caps?.editorScheme;
  if (!scheme) return null;
  const url = `${scheme}://file${path.split('/').map(encodeURIComponent).join('/')}`;
  return h('a', { class: 'btn btn-action', href: url, title: `Open in ${EDITOR_LABELS[scheme] ?? scheme}` }, 'Code');
}
