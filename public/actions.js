import { h, toast } from './dom.js';

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

/** Open a new terminal tab in a worktree. */
export function terminalButton(path, caps) {
  if (!caps?.terminal) return null;
  return actionButton('Terminal', `Open a new ${caps.terminal} tab here`, async () => {
    await post('/api/terminal/open', { path });
    return null;
  });
}

/** Open a folder in the configured editor; a plain link, handled by the editor's URL scheme. */
export function editorLink(path, caps) {
  const scheme = caps?.editorScheme;
  if (!scheme) return null;
  const url = `${scheme}://file${path.split('/').map(encodeURIComponent).join('/')}`;
  return h('a', { class: 'btn btn-action', href: url, title: `Open in ${EDITOR_LABELS[scheme] ?? scheme}` }, 'Code');
}
