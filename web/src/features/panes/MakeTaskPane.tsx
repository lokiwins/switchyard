import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Dialog, PaneHeader } from '../../components/Dialog';
import { getJson, post } from '../../lib/api';
import { announceChange } from '../../lib/changes';
import { linkedWhere as where } from '../../../../public/task-state.js';
import { usePaneStore, type MakeTaskFrom } from '../../stores/panes';
import { toast } from '../../stores/toast';

/*
 * Make a task on the Tasks page from work already under way: the form opens
 * filled in from the session (its title and first prompt) and the server
 * saves where the work is on the task, so it shows under it there.
 */

interface Draft { title: string; notes: string; where: { repoName?: string; branch?: string; sessionOnly?: boolean } }
interface TaskFields { title: string; dueOn: string; notes: string; links: string }

const linkedWhere = where as (w: Draft['where']) => string;
const MAX_TITLE_CHARS = 200;
const MAX_NOTES_CHARS = 10_000;
const FORM_ID = 'task-form-new';

const draftUrl = (from: MakeTaskFrom) => ('sessionId' in from
  ? `/api/hub/tasks/draft?session=${encodeURIComponent(from.sessionId)}`
  : `/api/hub/tasks/draft?worktree=${encodeURIComponent(from.worktree)}`);

const Field = ({ label, children }: { label: string; children: ReactNode }) => <label className="pane-field"><span>{label}</span>{children}</label>;

function TaskForm({ draft, onSave }: { draft: Draft; onSave: (fields: TaskFields) => void }) {
  const [fields, setFields] = useState<TaskFields>({ title: draft.title, dueOn: '', notes: draft.notes, links: '' });
  const change = (key: keyof TaskFields) => (event: { target: { value: string } }) => setFields((f) => ({ ...f, [key]: event.target.value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave(fields);
  };
  return (
    <form className="pane-form" id={FORM_ID} onSubmit={submit}>
      <Field label="Title">
        <input name="title" type="text" className="pane-input" required maxLength={MAX_TITLE_CHARS} autoFocus value={fields.title} onChange={change('title')} />
      </Field>
      <Field label="Due"><input name="dueOn" type="date" className="pane-input" value={fields.dueOn} onChange={change('dueOn')} /></Field>
      <Field label="Notes (what Claude is told when you start it)">
        <textarea name="notes" className="pane-input pane-textarea" rows={6} maxLength={MAX_NOTES_CHARS} value={fields.notes} onChange={change('notes')} />
      </Field>
      <Field label="Ticket links, one per line">
        <textarea name="links" className="pane-input pane-textarea" rows={3} spellCheck={false} value={fields.links} onChange={change('links')} />
      </Field>
    </form>
  );
}

export function MakeTaskPane({ from }: { from: MakeTaskFrom }) {
  const close = usePaneStore((s) => s.close);
  const draft = useQuery({ queryKey: ['task-draft', from], queryFn: ({ signal }) => getJson<Draft>(draftUrl(from), signal), staleTime: Infinity, retry: false });
  const save = useMutation({
    mutationFn: (fields: TaskFields) => post<{ title: string }>('/api/hub/tasks/create', {
      title: fields.title, dueOn: fields.dueOn || null, notes: fields.notes, links: fields.links.split(/\s+/).filter(Boolean), from,
    }),
    onSuccess: (created) => {
      toast(`Added task: ${created.title}`);
      close();
      // The page looks again (the task is read fresh each time), so this row shows its task.
      void announceChange();
    },
    onError: (error) => toast(error.message),
  });
  return (
    <Dialog label="New task" className="task-pane" onClose={close}>
      <PaneHeader heading="New task" sub={draft.data ? linkedWhere(draft.data.where) : null}>
        <button type="button" className="pane-btn" title="Close without saving" onClick={close}>Close</button>
      </PaneHeader>
      <div className="review-body task-pane-body">
        {draft.error && <p className="pane-note">{draft.error.message}</p>}
        {draft.data && <TaskForm draft={draft.data} onSave={(fields) => save.mutate(fields)} />}
      </div>
      <footer className="pane-footer">
        <span className="pane-note pane-footer-note">Esc closes without saving.</span>
        <button type="submit" form={FORM_ID} className="pane-btn is-primary" disabled={!draft.data || save.isPending}>Add task</button>
      </footer>
    </Dialog>
  );
}
