import { useMutation } from '@tanstack/react-query';
import { post } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { toast } from '../../stores/toast';
import { TASKS_KEY } from './api';
import { whatsLeft } from './worktree-choices';
import type { WorktreeChoice } from './types';
import { Button } from '../../components/Button';
import { MenuHint } from '../../components/Menu';

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
    <div className="flex flex-col gap-1 py-2 px-3 rounded-sm bg-amber-soft shadow-[inset_3px_0_0_var(--amber)]" role="group" aria-label={`Keep or delete ${folderName(choice.path)}`}>
      <p className="m-0 text-sm text-gray-900 [overflow-wrap:anywhere] [&_code]:font-mono [&_code]:text-xs">
        <strong>{choice.taskTitle}</strong> is closed. Its worktree <code title={choice.path}>{folderName(choice.path)}</code>
        {choice.branch ? <> on <code>{choice.branch}</code></> : ''}
        {` has ${whatsLeft(choice)}. Keep it, or delete it?`}
      </p>
      <MenuHint>
        {choice.changes > 0
          ? 'Delete removes the folder, and its uncommitted changes are gone for good. The branch and its commits stay.'
          : 'Delete removes the folder. The branch and its commits stay.'}
      </MenuHint>
      <div className="flex flex-wrap gap-1.5 mt-0.5">
        <Button type="button" variant="secondary" size="sm" disabled={choose.isPending} onClick={() => choose.mutate(true)}>Keep worktree</Button>
        <Button type="button" variant="danger" size="sm" disabled={choose.isPending} onClick={() => choose.mutate(false)}>Delete worktree</Button>
      </div>
    </div>
  );
}

export function WorktreeChoices({ choices }: { choices: WorktreeChoice[] }) {
  return (
    <div id="worktree-choices" className="flex flex-col gap-2 not-empty:mb-3" aria-live="polite">
      {choices.map((choice) => <Choice key={choice.path} choice={choice} />)}
    </div>
  );
}
