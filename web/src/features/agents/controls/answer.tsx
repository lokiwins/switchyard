import { Fragment, useState, type FormEvent } from 'react';
import { Menu, menuItemClass } from '../../../components/Menu';
import { post } from '../../../lib/api';
import { announceChange } from '../../../lib/changes';
import { tmuxPlace } from '../../../lib/paths';
import { canPressKeys } from '../../../lib/shared';
import type { Approval, Host, LiveSession, PromptOption, ScreenPrompt } from '../../../lib/types';
import { openPane } from '../../../stores/panes';
import { useDraft } from '../../../stores/drafts';
import { toast } from '../../../stores/toast';
import { Button, buttonClass } from '../../../components/Button';

/*
 * Answering the dialog a session shows in tmux or iTerm (a question, plan
 * approval or permission prompt) from the page. Each option presses its
 * number in the session's terminal; the server first checks its screen still
 * shows that question and option. Options that open a text field send your
 * text too, a multiple-choice question's options tick boxes, and a question in
 * several parts has "Next" to go on to its next tab (the last one submits). A
 * permission prompt's Yes and No can also carry an instruction for Claude, as
 * Tab to amend does in the terminal.
 */

// What the terminal's text field asks for, once Tab has opened a Yes or No.
const AMEND_PLACEHOLDERS: Record<string, string> = { Yes: 'Yes, and tell Claude what to do next', No: 'No, and tell Claude what to do differently' };
const MAX_ANSWER_CHARS = 2000;

/** A dialog the page can show: one read off the screen, unless the approvals hook already gives it Allow and Deny. */
export const canShow = (session: LiveSession, approvals: Approval[]): session is LiveSession & { screenPrompt: ScreenPrompt } =>
  Boolean(session.needsYou) && approvals.length === 0 && (session.screenPrompt?.options.length ?? 0) > 0;

/** A dialog the page can also answer, pressing keys where the session runs (a tmux pane or an iTerm tab, not Terminal). */
export const canAnswer = (session: LiveSession, approvals: Approval[]): boolean => canShow(session, approvals) && canPressKeys(session.host);

/** Where an answer's keys are pressed, for hints. */
const answerTarget = (host: Host) => (host.kind === 'tmux' ? `its tmux window ${tmuxPlace(host)}` : `its ${host.label} tab`);

interface AnswerFields { number?: number; label?: string; text?: string; amend?: boolean; next?: boolean }

async function answer(session: LiveSession, fields: AnswerFields): Promise<string> {
  const { answered } = await post<{ answered: string }>('/api/terminal/answer', { sessionId: session.sessionId, question: session.screenPrompt?.question, ...fields });
  void announceChange();
  return answered;
}

/** How the controls look where they're shown: a menu's items, or the plan pane's buttons. */
export interface AnswerStyle { button: string; form: string; input: string; send: string }

const optionText = (option: PromptOption) => {
  const box = option.checked === undefined ? '' : option.checked ? '☑ ' : '☐ ';
  return `${option.number}. ${box}${option.label}`;
};

/** Press an option; `onDone` closes whatever it was chosen from, except after ticking a box, so you can tick another. */
function OptionButton({ session, option, style, onDone }: { session: LiveSession; option: PromptOption; style: AnswerStyle; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const press = async () => {
    setBusy(true);
    try {
      const answered = await answer(session, { number: option.number, label: option.label });
      if (option.checked === undefined) {
        toast(`Answered: ${answered}`);
        onDone();
      }
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const title = option.checked === undefined
    ? `Answer "${option.label}" (presses ${option.number})`
    : `Tick or untick "${option.label}" (presses ${option.number})`;
  return <button type="button" className={style.button} title={title} disabled={busy} onClick={press}>{optionText(option)}</button>;
}

/** An option that opens a text field: your answer typed there. With `amend`, a Yes or No with your instruction added. */
function TextOption({ session, option, style, onDone, amend = false }: {
  session: LiveSession; option: PromptOption; style: AnswerStyle; onDone: () => void; amend?: boolean;
}) {
  const [text, setText] = useDraft(`answer:${session.sessionId}:${option.number}${amend ? ':amend' : ''}`);
  const [busy, setBusy] = useState(false);
  const send = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const answered = await answer(session, { number: option.number, label: option.label, text, amend });
      setText('');
      toast(`Answered: ${answered}`);
      onDone();
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className={style.form} onSubmit={send}>
      <input name="text" type="text" className={style.input || undefined} maxLength={MAX_ANSWER_CHARS} required autoComplete="off"
        placeholder={`${option.number}. ${amend ? AMEND_PLACEHOLDERS[option.label] ?? option.label : option.label}`}
        aria-label={option.label} value={text} onChange={(event) => setText(event.target.value)} />
      <button type="submit" className={style.send} disabled={busy}>Send</button>
    </form>
  );
}

function NextTabButton({ session, style }: { session: LiveSession; style: AnswerStyle }) {
  const [busy, setBusy] = useState(false);
  const next = async () => {
    setBusy(true);
    try {
      await answer(session, { next: true });
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className={style.button} disabled={busy} onClick={next}
      title="Go on to the next tab, as → does in its terminal; the last tab reviews and submits your answers">
      Next →
    </button>
  );
}

/** The dialog's options as controls. On a question's last tab, → does nothing, so there's no Next. */
export function AnswerControls({ session, style, onDone }: { session: LiveSession; style: AnswerStyle; onDone: () => void }) {
  const prompt = session.screenPrompt;
  if (!prompt) return null;
  return (
    <>
      {prompt.options.map((option) => (option.takesText
        ? <TextOption key={option.number} session={session} option={option} style={style} onDone={onDone} />
        : (
          <Fragment key={option.number}>
            <OptionButton session={session} option={option} style={style} onDone={onDone} />
            {option.amends && <TextOption session={session} option={option} style={style} onDone={onDone} amend />}
          </Fragment>
        )))}
      {prompt.tabs && !prompt.lastTab && <NextTabButton session={session} style={style} />}
    </>
  );
}

const MENU_STYLE: AnswerStyle = { button: menuItemClass, form: 'reply-form', input: '', send: buttonClass({ size: 'sm' }) };

/** "Answer ▾": the options of the dialog on a session's screen, each pressed there. */
export function AnswerMenu({ session, approvals }: { session: LiveSession; approvals: Approval[] }) {
  const [open, setOpen] = useState(false);
  if (!canAnswer(session, approvals) || !session.host) return null;
  const prompt = session.screenPrompt;
  return (
    // A text box with the cursor in it isn't focused on opening: the boxes you tick show as the page updates.
    <Menu label="Answer ▾" title={`Answer: ${prompt?.question ?? 'its dialog'}`} panelClass="answer-panel" focusInput={false}
      open={open} onOpenChange={setOpen}>
      {prompt?.question && <p className="answer-question">{prompt.question}</p>}
      <AnswerControls session={session} style={MENU_STYLE} onDone={() => setOpen(false)} />
      <p className="reply-hint">{`Pressed in ${answerTarget(session.host)}, if its screen still shows this question.`}</p>
    </Menu>
  );
}

/** "Plan": a plan approval's plan, in the glass pane, with the dialog's options where the page can answer. */
export function PlanButton({ session, approvals }: { session: LiveSession; approvals: Approval[] }) {
  if (!canShow(session, approvals) || !session.screenPrompt.plan) return null;
  const answerable = canAnswer(session, approvals);
  return (
    <Button type="button" variant="secondary" size="sm"
      title={`Read the plan${answerable ? ' before answering' : ''} (${session.screenPrompt.planFile})`}
      onClick={() => openPane({ kind: 'plan', sessionId: session.sessionId })}>
      Plan
    </Button>
  );
}
