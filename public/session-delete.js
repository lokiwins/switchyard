import { h, toast } from './dom.js';
import { announceChange, closeDropdown, dropdown, post } from './actions.js';

/*
 * Deleting ended sessions from the Agents page. "Remove from list" only takes
 * a session off switchyard's lists: its transcript stays, so `claude --resume`
 * still finds it. "Delete transcript" moves the transcript to the Trash. Both
 * happen at once, with Undo in the toast instead of a "Are you sure?".
 */

const sessionsLabel = (count) => (count === 1 ? 'a session' : `${count} sessions`);

/** Run a server change, then offer to take it back. */
async function withUndo({ perform, message, undo, undone }) {
  await perform();
  announceChange();
  toast(message, {
    action: {
      label: 'Undo',
      run: async () => {
        try {
          await undo();
          toast(undone);
          announceChange();
        } catch (error) {
          toast(error.message);
        }
      },
    },
  });
}

const hideSessions = (sessionIds) => withUndo({
  perform: () => post('/api/agents/hide', { sessionIds }),
  message: `Removed ${sessionsLabel(sessionIds.length)} from the list`,
  undo: () => post('/api/agents/unhide', { sessionIds }),
  undone: 'Back on the list',
});

const trashTranscript = (sessionId) => withUndo({
  perform: () => post('/api/agents/trash', { sessionId }),
  message: 'Moved the transcript to the Trash',
  undo: () => post('/api/agents/restore', { sessionId }),
  undone: 'Transcript restored',
});

function choice(title, hint, perform) {
  return h('button', {
    type: 'button',
    class: 'menu-item delete-choice',
    role: 'menuitem',
    onclick: async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await perform();
        closeDropdown(button);
      } catch (error) {
        toast(error.message);
      } finally {
        button.disabled = false;
      }
    },
  }, h('span', { class: 'menu-title' }, title), h('span', { class: 'delete-hint' }, hint));
}

/** "Delete ▾" on an ended session: off the list, or its transcript to the Trash. */
export function deleteMenu(session) {
  return dropdown({
    key: `delete:${session.sessionId}`,
    label: 'Delete ▾',
    title: 'Delete this ended session',
    className: 'btn btn-sm btn-secondary',
    panelClass: 'delete-panel',
    focusInput: false,
  },
  choice('Remove from list', 'The transcript stays, so claude --resume still finds it.', () => hideSessions([session.sessionId])),
  choice('Delete transcript', 'Moves it to the Trash. It can no longer be resumed.', () => trashTranscript(session.sessionId)));
}

/** Takes every listed ended session off the list (transcripts stay), with Undo. */
export function deleteAllButton(sessions, label) {
  if (sessions.length === 0) return null;
  return h('button', {
    type: 'button',
    class: 'btn btn-sm btn-secondary',
    title: `Remove ${sessionsLabel(sessions.length)} from switchyard's lists. Their transcripts stay, so you can still resume them.`,
    onclick: async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await hideSessions(sessions.map((s) => s.sessionId));
      } catch (error) {
        toast(error.message);
      } finally {
        button.disabled = false;
      }
    },
  }, label);
}
