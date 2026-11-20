import { useMutation } from '@tanstack/react-query';
import { post } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { toast } from '../../stores/toast';
import { TASKS_KEY } from './api';
import { whatsLeft } from './logic';
import type { WorktreeChoice } from './types';

/*
 * After a task is closed or deleted, its work is put away (see
 * src/task-cleanup.js). A worktree kept because it has uncommitted changes or
 * unmerged commits is asked about here: keep it, or delete it.
 */

const folderName = (path: string) => path.replace(/\/+$/, '').split('/').pop();

function Choice({ choice }: { choice: WorktreeChoice }) {
  const choose = useMutation({
    mutationFn: (keep: boolean) => post('/api/hub/tasks/worktree-choice', { path: choice.path, keep }),
    onSuccess: (_result, keep) => toast(keep ? `Kept ${choice.path}` : `Deleted ${choice.path}`),
    onError: (error) => toast(error.message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: TASKS_KEY }),
  });
  return (
    <div className="worktree-choice" role="group" aria-label={`Keep or delete ${folderName(choice.path)}`}>
      <p className="worktree-choice-text">
        <strong>{choice.taskTitle}</strong> is closed. Its worktree <code title={choice.path}>{folderName(choice.path)}</code>
        {choice.branch ? <> on <code>{choice.branch}</code></> : ''}
        {` has ${whatsLeft(choice)}. Keep it, or delete it?`}
      </p>
      <p className="reply-hint">
        {choice.changes > 0
          ? 'Delete removes the folder, and its uncommitted changes are gone for good. The branch and its commits stay.'
          : 'Delete removes the folder. The branch and its commits stay.'}
      </p>
      <div className="worktree-choice-actions">
        <button type="button" className="btn btn-sm btn-secondary" disabled={choose.isPending} onClick={() => choose.mutate(true)}>Keep worktree</button>
        <button type="button" className="btn btn-sm btn-danger" disabled={choose.isPending} onClick={() => choose.mutate(false)}>Delete worktree</button>
      </div>
    </div>
  );
}

export function WorktreeChoices({ choices }: { choices: WorktreeChoice[] }) {
  return (
    <div id="worktree-choices" className="worktree-choices" aria-live="polite">
      {choices.map((choice) => <Choice key={choice.path} choice={choice} />)}
    </div>
  );
}
