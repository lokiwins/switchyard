import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Dialog, PaneHeader } from '../../components/Dialog';
import { paneBodyClass, paneButtonClass, paneFooterClass, paneInputClass, paneNoteClass, paneNoteTextClass, panePillClass, paneSectionClass } from '../../components/pane-classes';
import { cx } from '../../lib/cx';
import { usePaneStore, type TaskDraft, type TaskPaneFields } from '../../stores/panes';
import { toast } from '../../stores/toast';
import { STATE_LABELS } from '../tasks/logic';
import { TicketCard } from './TicketCard';

/*
 * A task's details in a glass pane: its title, due day, notes and links, and
 * each linked ticket as its tracker has it. Used for a task you have and for
 * one not made yet (Make task), which has its own heading, line and button.
 */

const MAX_TITLE_CHARS = 200;
const MAX_NOTES_CHARS = 10_000;

interface FormText { title: string; dueOn: string; notes: string; links: string }

const Field = ({ label, children }: { label: string; children: ReactNode }) => <label className="grid gap-1 text-2xs text-pane-dim"><span>{label}</span>{children}</label>;

/** A field's text box; a long one is resized only down the page. */
const INPUT = paneInputClass({ field: true });
const TEXTAREA = cx(INPUT, 'resize-y [font-family:inherit] leading-[1.5]');

function TaskForm({ id, task, onSave }: { id: string; task: TaskDraft; onSave: (fields: TaskPaneFields) => void }) {
  const [text, setText] = useState<FormText>({ title: task.title, dueOn: task.dueOn ?? '', notes: task.notes, links: task.links.join('\n') });
  const change = (key: keyof FormText) => (event: { target: { value: string } }) => setText((t) => ({ ...t, [key]: event.target.value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({ title: text.title, dueOn: text.dueOn || null, notes: text.notes, links: text.links.split(/\s+/).filter(Boolean) });
  };
  return (
    <form className="grid gap-3" id={id} onSubmit={submit}>
      <Field label="Title">
        <input name="title" type="text" className={INPUT} required maxLength={MAX_TITLE_CHARS} data-autofocus value={text.title} onChange={change('title')} />
      </Field>
      <Field label="Due"><input name="dueOn" type="date" className={cx(INPUT, '[color-scheme:var(--pane-scheme)] [justify-self:start]')} value={text.dueOn} onChange={change('dueOn')} /></Field>
      <Field label="Notes (what Claude is told when you start it)">
        <textarea name="notes" className={TEXTAREA} rows={6} maxLength={MAX_NOTES_CHARS} value={text.notes} onChange={change('notes')} />
      </Field>
      <Field label="Ticket links, one per line">
        <textarea name="links" className={TEXTAREA} rows={3} spellCheck={false} value={text.links} onChange={change('links')} />
      </Field>
    </form>
  );
}

const LinkedTickets = ({ links }: { links: string[] }) => (
  <section className="grid gap-2.5" aria-label="Linked tickets">
    <h2 className={paneSectionClass}>Tickets</h2>
    {links.map((link) => <TicketCard key={link} link={link} />)}
  </section>
);

/**
 * The pane. `task` is null while it loads (`note` says why it isn't there,
 * if it can't be); `save(fields)` resolves whether it worked, and the pane
 * closes when it did.
 */
export function TaskEditor({
  task, note, label, heading, sub, submitLabel = 'Save', save,
}: {
  task: TaskDraft | null;
  note?: string | null;
  label: string;
  heading: string;
  sub?: string | null;
  submitLabel?: string;
  save: (fields: TaskPaneFields) => Promise<boolean>;
}) {
  const close = usePaneStore((s) => s.close);
  const saving = useMutation({
    mutationFn: save,
    onSuccess: (saved) => {
      if (saved) close();
    },
    onError: (error) => toast(error.message),
  });
  const formId = `task-form-${task?.id ?? 'new'}`;
  const state = task?.state ? STATE_LABELS[task.state]?.label : undefined;
  return (
    <Dialog label={label} onClose={close}>
      <PaneHeader heading={heading} sub={sub}>
        {state && <span className={panePillClass}>{state}</span>}
        <button type="button" className={paneButtonClass()} title="Close without saving" onClick={close}>Close</button>
      </PaneHeader>
      <div className={cx(paneBodyClass, 'grid gap-[18px] [align-content:start]')}>
        {note && <p className={paneNoteClass}>{note}</p>}
        {task && <TaskForm id={formId} task={task} onSave={(fields) => saving.mutate(fields)} />}
        {task && task.links.length > 0 && <LinkedTickets links={task.links} />}
      </div>
      <footer className={paneFooterClass}>
        <span className={cx(paneNoteTextClass, 'mr-auto')}>Esc closes without saving.</span>
        <button type="submit" form={formId} className={paneButtonClass({ primary: true })} disabled={!task || saving.isPending}>{submitLabel}</button>
      </footer>
    </Dialog>
  );
}
