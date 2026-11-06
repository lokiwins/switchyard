import { h, toast } from './dom.js';
import { actionButton, announceChange, closeDropdown, dropdown, post, tmuxPlace } from './actions.js';

/*
 * Answering a running session from the page: allow or deny the tool call it's
 * waiting on, type a message into its terminal, or stop what it is doing.
 */

// Apps whose tabs the server can type into (see canTypeInto in src/terminal.js).
const TYPEABLE_APPS = new Set(['iTerm']);
// What you've typed into each session's reply box, kept while the page re-renders.
const drafts = new Map();

/** The permission prompts waiting on this session, oldest first. */
export const approvalsFor = (state, session) => (state.approvals ?? []).filter((a) => a.sessionId === session.sessionId);

/** The row's detail line for a waiting prompt: what Claude wants to do. */
export function approvalDetail(approvals) {
  const [first] = approvals;
  const more = approvals.length > 1 ? ` (+${approvals.length - 1} more)` : '';
  return { kind: 'needs-you', label: `Allow ${first.toolName}${more}?`, text: first.summary };
}

function decide(approval, behavior) {
  return async () => {
    await post('/api/approvals/decide', { id: approval.id, behavior });
    return behavior === 'allow' ? `Allowed ${approval.toolName}` : `Denied ${approval.toolName}`;
  };
}

/** Allow and Deny for the oldest waiting prompt; the terminal's own prompt stays usable too. */
export function approvalButtons([approval]) {
  const what = `${approval.toolName}: ${approval.summary}`;
  return [
    actionButton('Allow', `Allow once: ${what}`, decide(approval, 'allow'), 'btn btn-sm'),
    actionButton('Deny', `Deny: ${what}`, decide(approval, 'deny'), 'btn btn-sm btn-secondary'),
  ];
}

const inTmux = (session) => session.host?.kind === 'tmux';

export const canReply = (session) => !session.needsYou
  && (inTmux(session) || (session.host?.kind === 'terminal' && TYPEABLE_APPS.has(session.host.app)));

/** Where a reply is typed, for hints. */
const replyTarget = (session) => (inTmux(session) ? `tmux window ${tmuxPlace(session.host)}` : `${session.host.label} tab`);

/** "Stop": presses Esc in a working tmux session, ending its current turn. */
export function stopButton(session) {
  if (!inTmux(session) || session.status !== 'busy') return null;
  return actionButton('Stop', 'Interrupt what Claude is doing (Esc), as in its terminal', async () => {
    await post('/api/terminal/interrupt', { sessionId: session.sessionId });
    return 'Interrupted';
  }, 'btn btn-sm btn-secondary');
}

async function sendReply(event, session) {
  event.preventDefault();
  const form = event.currentTarget;
  const input = form.elements.text;
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const { queued } = await post('/api/terminal/reply', { sessionId: session.sessionId, text: input.value });
    drafts.delete(session.sessionId);
    closeDropdown(form);
    toast(queued ? 'Sent. Claude will read it after its current step.' : 'Sent');
    announceChange();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
}

/** "Reply ▾": a one-line message typed into the session's tab, as if you'd typed it there. */
export function replyMenu(session) {
  if (!canReply(session)) return null;
  return dropdown({
    key: `reply:${session.sessionId}`,
    label: 'Reply ▾',
    title: `Type a message into this session's ${replyTarget(session)}`,
    panelClass: 'reply-panel',
  },
  h('form', { class: 'reply-form', onsubmit: (event) => sendReply(event, session) },
    h('input', {
      name: 'text',
      type: 'text',
      maxlength: '2000',
      required: true,
      autocomplete: 'off',
      placeholder: session.status === 'busy' ? 'Queue a message for when it finishes this step' : 'Message Claude',
      'aria-label': 'Message',
      value: drafts.get(session.sessionId) ?? '',
      oninput: (event) => drafts.set(session.sessionId, event.target.value),
    }),
    h('button', { type: 'submit', class: 'btn btn-sm' }, 'Send')),
  h('p', { class: 'reply-hint' }, `Typed into its ${replyTarget(session)}, after anything already in the input box there.`));
}

/** Whether you're typing in a reply box, so a background refresh mustn't replace it. */
export const isTypingReply = () => Boolean(document.activeElement?.closest('.reply-form'));
