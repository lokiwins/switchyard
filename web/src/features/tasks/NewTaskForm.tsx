import { useRef, useState, type FormEvent } from 'react';
import { AddFromMenu } from './AddFromMenu';
import type { HubTask, TaskFields } from './types';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { cx } from '../../lib/cx';

/* The add-a-task form: a title and due day, with notes and links behind "Notes and links"; and Add from ▾. */

const MAX_TITLE_CHARS = 200;
const MAX_NOTES_CHARS = 10_000;
const EMPTY = { title: '', dueOn: '', notes: '', links: '' };

// Its boxes: sunken, with a faint ring.
const BOX = [
  '[font-family:inherit] [line-height:inherit] text-sm py-1.5 px-2.5 border-0 rounded-sm',
  'bg-surface-sunken text-gray-900 shadow-[inset_0_0_0_1px_var(--divider)]',
].join(' ');
const NOTES = cx(BOX, 'w-full resize-y');

export function NewTaskForm({ tasks, onCreate }: { tasks: HubTask[]; onCreate: (fields: TaskFields) => Promise<boolean> }) {
  const [fields, setFields] = useState(EMPTY);
  const [moreOpen, setMoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const title = useRef<HTMLInputElement>(null);
  const change = (key: keyof typeof EMPTY) => (event: { target: { value: string } }) => setFields((f) => ({ ...f, [key]: event.target.value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const created = await onCreate({ title: fields.title, dueOn: fields.dueOn || null, notes: fields.notes, links: fields.links.split(/\s+/).filter(Boolean) });
      // Kept after a failure, to fix rather than type again.
      if (created) {
        setFields(EMPTY);
        setMoreOpen(false);
        title.current?.focus();
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="grid grid-cols-[minmax(0,1fr)] gap-2 mb-3" aria-label="Add a task" onSubmit={submit}>
      {/* On a phone the title gets the whole line; the due day and Add go under it. */}
      <div className="flex gap-2 max-phone:flex-wrap">
        <input ref={title} className={cx(BOX, 'flex-1 min-w-0 max-phone:basis-full')} name="title" type="text" required maxLength={MAX_TITLE_CHARS} autoComplete="off" aria-label="Task" placeholder="Add a task: what needs doing?"
          value={fields.title} onChange={change('title')} />
        <input className={BOX} name="dueOn" type="date" aria-label="Due date" title="Due date (optional)" value={fields.dueOn} onChange={change('dueOn')} />
        <Button type="submit"  disabled={busy}>Add</Button>
        <AddFromMenu tasks={tasks} onCreate={onCreate} />
      </div>
      <details className="open:grid open:gap-2" open={moreOpen} onToggle={(event) => setMoreOpen(event.currentTarget.open)}>
        <summary className="cursor-pointer text-xs text-gray-500 w-max">Notes and links</summary>
        <Field label="Notes (what Claude is told when you start it)">
          <textarea className={NOTES} name="notes" rows={3} maxLength={MAX_NOTES_CHARS} value={fields.notes} onChange={change('notes')} />
        </Field>
        <Field label="Ticket links (ClickUp, GitHub, Jira, Azure DevOps or any other), one per line">
          <textarea className={NOTES} name="links" rows={2} spellCheck={false} placeholder="https://app.clickup.com/t/…" value={fields.links} onChange={change('links')} />
        </Field>
      </details>
    </form>
  );
}
