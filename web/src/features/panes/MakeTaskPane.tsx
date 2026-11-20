import { useQuery } from '@tanstack/react-query';
import { getJson, post } from '../../lib/api';
import { announceChange } from '../../lib/changes';
import type { MakeTaskFrom, TaskDraft, TaskPaneFields } from '../../stores/panes';
import { toast } from '../../stores/toast';
import { linkedWhere } from '../tasks/logic';
import { TaskEditor } from './TaskEditor';

/*
 * Make a task on the Tasks page from work already under way: the form opens
 * filled in from the session (its title and first prompt) and the server
 * saves where the work is on the task, so it shows under it there.
 */

interface Draft { title: string; notes: string; where: { repoName?: string; branch?: string; sessionOnly?: boolean } }

const HEADING = 'New task';

const draftUrl = (from: MakeTaskFrom) => ('sessionId' in from
  ? `/api/hub/tasks/draft?session=${encodeURIComponent(from.sessionId)}`
  : `/api/hub/tasks/draft?worktree=${encodeURIComponent(from.worktree)}`);

const newTask = (draft: Draft): TaskDraft => ({ id: null, title: draft.title, notes: draft.notes, dueOn: null, links: [] });

export function MakeTaskPane({ from }: { from: MakeTaskFrom }) {
  const draft = useQuery({ queryKey: ['task-draft', from], queryFn: ({ signal }) => getJson<Draft>(draftUrl(from), signal), staleTime: Infinity, retry: false });
  const save = async (fields: TaskPaneFields): Promise<boolean> => {
    try {
      const created = await post<{ title: string }>('/api/hub/tasks/create', { ...fields, from });
      toast(`Added task: ${created.title}`);
    } catch (error) {
      toast((error as Error).message);
      return false;
    }
    // The page looks again (the task is read fresh each time), so this row shows its task.
    void announceChange();
    return true;
  };
  return (
    <TaskEditor
      task={draft.data ? newTask(draft.data) : null}
      note={draft.error?.message}
      label={HEADING}
      heading={HEADING}
      sub={draft.data ? linkedWhere(draft.data.where) : null}
      submitLabel="Add task"
      save={save}
    />
  );
}
