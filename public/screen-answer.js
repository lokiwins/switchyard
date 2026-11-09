import { h, toast } from './dom.js';
import { announceChange, closeDropdown, dropdown, post, tmuxPlace } from './actions.js';
import { renderMarkdown } from './markdown.js';
import { sessionTitle } from './session-text.js';

/*
 * Answering the dialog a tmux session shows (a question, plan approval or
 * permission prompt) from the page. Each option presses its number in the
 * session's terminal; the server first checks its screen still shows that
 * question and option. Options that open a text field send your text too, a
 * multiple-choice question's options tick boxes, and a question in several
 * parts has "Next" to go on to its next tab (the last one submits).
 */

// What you've typed for each option that takes text, kept while the page re-renders.
const drafts = new Map();

const promptOf = (session) => session.screenPrompt;

/** Answer with the dialog's own controls, unless the approvals hook already gives the prompt Allow and Deny. */
export const canAnswer = (session, approvals) => session.host?.kind === 'tmux' && session.needsYou
  && approvals.length === 0 && (promptOf(session)?.options.length ?? 0) > 0;

function optionText(option) {
  const box = option.checked === undefined ? '' : option.checked ? '☑ ' : '☐ ';
  return `${option.number}. ${box}${option.label}`;
}

async function answer(session, fields) {
  const { answered } = await post('/api/terminal/answer', { sessionId: session.sessionId, question: promptOf(session).question, ...fields });
  announceChange();
  return answered;
}

/** Press an option; `done` closes whatever it was chosen from, except after ticking a box, so you can tick another. */
function optionButton(session, option, { className, done }) {
  return h('button', {
    type: 'button',
    class: className,
    title: option.checked === undefined ? `Answer "${option.label}" (presses ${option.number})` : `Tick or untick "${option.label}" (presses ${option.number})`,
    onclick: async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const answered = await answer(session, { number: option.number, label: option.label });
        if (option.checked === undefined) {
          toast(`Answered: ${answered}`);
          done(button);
        }
      } catch (error) {
        toast(error.message);
      } finally {
        button.disabled = false;
      }
    },
  }, optionText(option));
}

/** An option that opens a text field: your answer, typed there and sent. */
function textOption(session, option, { formClass, inputClass, buttonClass, done }) {
  const key = `${session.sessionId}:${option.number}`;
  return h('form', {
    class: formClass,
    onsubmit: async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button');
      button.disabled = true;
      try {
        const answered = await answer(session, { number: option.number, label: option.label, text: form.elements.text.value });
        drafts.delete(key);
        toast(`Answered: ${answered}`);
        done(form);
      } catch (error) {
        toast(error.message);
      } finally {
        button.disabled = false;
      }
    },
  },
  h('input', {
    name: 'text',
    type: 'text',
    class: inputClass,
    maxlength: '2000',
    required: true,
    autocomplete: 'off',
    placeholder: `${option.number}. ${option.label}`,
    'aria-label': option.label,
    value: drafts.get(key) ?? '',
    oninput: (event) => drafts.set(key, event.target.value),
  }),
  h('button', { type: 'submit', class: buttonClass }, 'Send'));
}

function nextTabButton(session, { className }) {
  return h('button', {
    type: 'button',
    class: className,
    title: 'Go on to the next tab, as → does in its terminal; the last tab reviews and submits your answers',
    onclick: async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await answer(session, { next: true });
      } catch (error) {
        toast(error.message);
      } finally {
        button.disabled = false;
      }
    },
  }, 'Next →');
}

/** The dialog's options as controls, styled for where they're shown. */
function answerControls(session, styles) {
  const prompt = promptOf(session);
  return [
    prompt.options.map((option) => (option.takesText ? textOption(session, option, styles) : optionButton(session, option, styles))),
    prompt.tabs && nextTabButton(session, styles),
  ];
}

/** "Answer ▾": the options of the dialog on a tmux session's screen, each pressed there. */
export function answerMenu(session, approvals) {
  if (!canAnswer(session, approvals)) return null;
  const prompt = promptOf(session);
  return dropdown({
    key: `answer:${session.sessionId}`,
    label: 'Answer ▾',
    title: `Answer: ${prompt.question ?? 'its dialog'}`,
    panelClass: 'answer-panel',
    // A text box with the cursor in it holds off the page's updates, which show the boxes you tick.
    focusInput: false,
  },
  prompt.question && h('p', { class: 'answer-question' }, prompt.question),
  answerControls(session, {
    className: 'menu-item', formClass: 'reply-form', inputClass: '', buttonClass: 'btn btn-sm', done: closeDropdown,
  }),
  h('p', { class: 'reply-hint' }, `Pressed in its tmux window ${tmuxPlace(session.host)}, if its screen still shows this question.`));
}

/** "Plan": a plan approval's plan, rendered in the glass pane, with the dialog's options to answer it. */
export function planButton(session, approvals) {
  if (!canAnswer(session, approvals) || !promptOf(session).plan) return null;
  return h('button', {
    type: 'button',
    class: 'btn btn-sm btn-secondary',
    title: `Read the plan before answering (${promptOf(session).planFile})`,
    onclick: () => openPlan(session),
  }, 'Plan');
}

function openPlan(session) {
  const prompt = promptOf(session);
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  const dialog = h('dialog', { class: 'glass-pane review-pane plan-pane', 'aria-label': `Plan: ${sessionTitle(session)}`, onclose: () => dialog.remove() },
    h('header', { class: 'pane-header' },
      h('span', { class: 'pane-dot is-waiting', 'aria-hidden': 'true' }),
      h('div', { class: 'pane-heading' },
        h('strong', {}, `Plan · ${sessionTitle(session)}`),
        h('span', { class: 'pane-sub', title: prompt.question }, prompt.question)),
      h('span', { class: 'pane-pill' }, prompt.planFile),
      h('button', { type: 'button', class: 'pane-btn', title: 'Close (the plan keeps waiting)', onclick: close }, 'Close')),
    h('div', { class: 'review-body' }, renderMarkdown(prompt.plan)),
    h('footer', { class: 'pane-footer plan-answers' }, answerControls(session, {
      className: 'pane-btn', formClass: 'plan-text-answer', inputClass: 'pane-input', buttonClass: 'pane-btn', done: close,
    })));
  document.body.append(dialog);
  dialog.showModal();
}
