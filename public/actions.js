import { h, timeAgo, toast } from './dom.js';

const EDITOR_LABELS = { vscode: 'VS Code', 'vscode-insiders': 'VS Code Insiders', cursor: 'Cursor', windsurf: 'Windsurf' };

export async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await res.json();
  if (!payload.success) throw new Error(payload.error ?? `HTTP ${res.status}`);
  return payload.data;
}

/** Tells the page something changed on the server, so it reloads now rather than at its next poll. */
/** Something changed: the page reloads its data, skipping the server's cache with `force`. */
export const announceChange = ({ force = false } = {}) => document.dispatchEvent(new CustomEvent('switchyard:changed', { detail: { force } }));

/** A button that runs a server action, disabling itself meanwhile and toasting the outcome. */
export function actionButton(label, title, perform, className = 'btn btn-action') {
  return h('button', {
    type: 'button',
    class: className,
    title,
    onclick: async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const message = await perform();
        if (message) toast(message);
        announceChange();
      } catch (error) {
        toast(error.message);
      } finally {
        button.disabled = false;
      }
    },
  }, label);
}

/** Where a session runs in tmux, as tmux itself writes it: "switchyard:my-repo-login". */
export const tmuxPlace = (host) => `${host.session}:${host.windowName}`;

/** Get to a running session: its exact tab in a terminal, its window in an editor, or its app. */
export function jumpButton(session) {
  const host = session.host;
  if (!host) return null;
  const isTerminal = host.kind === 'terminal' || host.kind === 'tmux';
  const title = host.kind === 'tmux' ? `Switch to tmux window ${tmuxPlace(host)}, attaching the session in a new tab if needed`
    : isTerminal ? `Switch to this session's tab in ${host.label}`
    : host.kind === 'editor' ? `Bring the ${host.label} window for this folder forward`
      : `Bring ${host.label} to the front`;
  return actionButton(isTerminal ? 'Jump' : `Open ${host.label}`, title, async () => {
    const result = await post('/api/terminal/focus', { sessionId: session.sessionId });
    if (result.precision === 'resumed') return `The session had closed, so it's resuming in a new ${result.host} tab`;
    if (result.precision === 'attached') return `Attached tmux session ${host.session} in a new ${result.host} tab, showing ${host.windowName}`;
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

// The menu that is showing; pages re-render on a timer, so it is kept here to survive that.
let openMenuKey = null;

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

/**
 * A dropdown that stays open across re-renders: a native <details> whose
 * panel is placed under its button. `key` names it among the page's menus.
 */
export function dropdown({ key, label, title, className = 'btn btn-action', panelClass = '' }, ...content) {
  return h('details', {
    class: 'menu',
    open: openMenuKey === key,
    ontoggle: (event) => {
      const menu = event.currentTarget;
      if (menu.open) {
        openMenuKey = key;
        closeMenus(menu);
        placePanel(menu);
        menu.querySelector('input, textarea')?.focus();
      } else if (openMenuKey === key) {
        openMenuKey = null;
      }
    },
  },
  h('summary', { class: className, title }, label),
  h('div', { class: ['menu-panel', panelClass].filter(Boolean).join(' '), role: 'menu' }, content));
}

/** Close a dropdown from inside it, e.g. after its form is sent. */
export function closeDropdown(element) {
  openMenuKey = null;
  element.closest('details.menu')?.removeAttribute('open');
  // The page may have re-rendered while the menu's action ran, putting an open copy in its place.
  closeMenus();
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
      closeDropdown(event.currentTarget);
      try {
        await post('/api/terminal/open', { path, ...body });
      } catch (error) {
        toast(error.message);
      }
    },
  }, children);

  return dropdown({ key: `open:${path}`, label: 'Open ▾', title: `Open a new ${caps.terminal} tab here` },
    choice('Shell', { launch: 'shell' }, `cd into this folder in a new ${caps.terminal} tab`),
    choice('New Claude session', { launch: 'claude' }, 'Start claude in this folder'),
    sessions.length > 0 && h('div', { class: 'menu-label' }, 'Resume'),
    sessions.map((session) => choice([
      h('span', { class: 'menu-title' }, sessionLabel(session)),
      h('span', { class: 'menu-meta' }, timeAgo(session.updatedAt)),
    ], { sessionId: session.sessionId }, session.transcript?.lastPrompt ?? undefined)));
}

/** Open a folder in the configured editor; a plain link, handled by the editor's URL scheme. */
export function editorLink(path, caps) {
  const scheme = caps?.editorScheme;
  if (!scheme) return null;
  const url = `${scheme}://file${path.split('/').map(encodeURIComponent).join('/')}`;
  return h('a', { class: 'btn btn-action', href: url, title: `Open in ${EDITOR_LABELS[scheme] ?? scheme}` }, 'Code');
}
