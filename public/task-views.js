import { h } from './dom.js';

/*
 * The Tasks page's connections: a card for each tracker. Also
 * which session a worktree's Terminal and Jump go to.
 */

const HELP_URL = 'https://app.clickup.com/settings/apps';

/** The token form on the ClickUp card, before it's connected. `onConnect` resolves whether it worked. */
function connectForm(onConnect) {
  return h('form', {
    class: 'tool-connect',
    onsubmit: async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button');
      button.disabled = true;
      try {
        // Kept after a failure, so a mistyped token can be fixed rather than pasted again.
        if (await onConnect(form.elements.token.value)) form.reset();
      } finally {
        button.disabled = false;
      }
    },
  },
  h('label', { class: 'tool-label', for: 'clickup-token' }, 'Personal API token'),
  h('div', { class: 'reply-form' },
    h('input', {
      id: 'clickup-token', name: 'token', type: 'password', required: true, autocomplete: 'off', spellcheck: 'false', placeholder: 'pk_…',
    }),
    h('button', { type: 'submit', class: 'btn btn-sm' }, 'Connect')),
  h('p', { class: 'tool-help' },
    'Make one in ClickUp under ',
    h('a', { href: HELP_URL, target: '_blank', rel: 'noopener noreferrer' }, 'Settings › Apps'),
    '. switchyard keeps it in ~/.config/switchyard, readable only by you, and sends it only to ClickUp.'));
}

function workspacePicker(tool, onWorkspace) {
  if (tool.workspaces.length === 1) return h('span', { class: 'tool-meta' }, tool.workspaces[0].name);
  return h('select', {
    class: 'tool-select',
    'aria-label': 'ClickUp workspace',
    onchange: (event) => onWorkspace(event.target.value),
  }, tool.workspaces.map((w) => h('option', { value: w.id, selected: w.id === tool.workspaceId }, w.name)));
}

function connectedBody(tool, { onDisconnect, onWorkspace }) {
  return [
    h('p', { class: 'tool-meta' }, h('span', { class: 'dot connected', 'aria-hidden': 'true' }), `Connected as ${tool.user.username}`),
    h('div', { class: 'tool-row' },
      workspacePicker(tool, onWorkspace),
      h('button', { type: 'button', class: 'btn btn-sm btn-secondary', onclick: onDisconnect, title: 'Forget the token' }, 'Disconnect')),
  ];
}

/** GitHub's card: it uses your gh login, so there's nothing to paste, only to sign in to gh. */
function ghBody(tool) {
  if (tool.connected) return h('p', { class: 'tool-meta' }, h('span', { class: 'dot connected', 'aria-hidden': 'true' }), `Signed in to gh as ${tool.user.username}`);
  return h('p', { class: 'tool-help' }, 'Uses your GitHub CLI login. Run ', h('code', {}, 'gh auth login'), ' in a terminal, then press Refresh.');
}

/** One card per tracker: to connect, connected, or coming soon. */
export function renderToolCards(tools, handlers) {
  return tools.map((tool) => h('article', { class: `tool-card${tool.connected ? ' is-connected' : ''}${tool.available ? '' : ' is-later'}` },
    h('header', { class: 'tool-head' },
      h('h3', {}, tool.name),
      !tool.available && h('span', { class: 'pill' }, 'Coming soon')),
    tool.available && (tool.kind === 'gh' ? ghBody(tool)
      : tool.connected ? connectedBody(tool, handlers) : connectForm(handlers.onConnect))));
}

// Questions waiting on you first, then working, then waiting; parked ones last.
const jumpRank = (s) => (s.needsYou ? 3 : s.parked ? 0 : s.status === 'busy' ? 2 : 1);

/** The session a worktree's Jump and Terminal go to: the one that most needs you, then the latest; null when none runs. */
export function sessionToJump(link) {
  return [...link.live].sort((a, b) => jumpRank(b) - jumpRank(a) || (b.statusUpdatedAt ?? 0) - (a.statusUpdatedAt ?? 0))[0] ?? null;
}
