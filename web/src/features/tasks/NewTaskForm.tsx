import { useRef, useState, type FormEvent } from 'react';
import { AddFromMenu } from './AddFromMenu';
import type { HubTask, TaskFields } from './types';
import { Button } from '../../components/Button';

/* The add-a-task form: a title and due day, with notes and links behind "Notes and links"; and Add from ▾. */

const MAX_TITLE_CHARS = 200;
const MAX_NOTES_CHARS = 10_000;
const EMPTY = { title: '', dueOn: '', notes: '', links: '' };

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
    <form className="hub-new" aria-label="Add a task" onSubmit={submit}>
      <div className="hub-new-row">
        <input ref={title} name="title" type="text" required maxLength={MAX_TITLE_CHARS} autoComplete="off" aria-label="Task" placeholder="Add a task: what needs doing?"
          value={fields.title} onChange={change('title')} />
        <input name="dueOn" type="date" aria-label="Due date" title="Due date (optional)" value={fields.dueOn} onChange={change('dueOn')} />
        <Button type="submit"  disabled={busy}>Add</Button>
        <AddFromMenu tasks={tasks} onCreate={onCreate} />
      </div>
      <details className="hub-new-more" open={moreOpen} onToggle={(event) => setMoreOpen(event.currentTarget.open)}>
        <summary>Notes and links</summary>
        <label className="task-field">
          <span>Notes (what Claude is told when you start it)</span>
          <textarea name="notes" rows={3} maxLength={MAX_NOTES_CHARS} value={fields.notes} onChange={change('notes')} />
        </label>
        <label className="task-field">
          <span>Ticket links (ClickUp, GitHub, Jira, Azure DevOps or any other), one per line</span>
          <textarea name="links" rows={2} spellCheck={false} placeholder="https://app.clickup.com/t/…" value={fields.links} onChange={change('links')} />
        </label>
      </details>
    </form>
  );
}
