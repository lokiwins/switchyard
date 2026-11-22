import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { CopyButton } from '../../components/CopyButton';
import { Menu, MenuHint, MenuActions } from '../../components/Menu';
import { post } from '../../lib/api';
import { shortPath } from '../../lib/paths';
import { toast } from '../../stores/toast';
import { refreshBoard } from './api';
import type { RepoGroup, WorktreeRow } from './types';
import { cleanupCommand } from './views';
import { Button } from '../../components/Button';

/*
 * "Clean up ▾" for a worktree whose PR is merged or closed. The server checks
 * again before removing anything: no running session, nothing uncommitted,
 * nothing that isn't in the PR or on origin.
 */

interface CleanupResult { removed: string; deletedBranch?: string | null; branchError?: string | null }

const Mono = ({ text }: { text: string }) => <span className="font-mono text-xs">{text}</span>;

/** What Clean up will do, said before it does it. */
function Summary({ w }: { w: WorktreeRow }) {
  const folder = <Mono text={shortPath(w.path)} />;
  if (w.pr?.state === 'MERGED' && w.branch) return <p className="mt-0 mb-2">Removes {folder} and deletes branch <Mono text={w.branch} />, since its PR was merged.</p>;
  return <p className="mt-0 mb-2">Removes {folder}{w.branch ? <> and keeps branch <Mono text={w.branch} />, since its PR was closed without merging.</> : '.'}</p>;
}

function outcome(result: CleanupResult, w: WorktreeRow): string {
  const folder = shortPath(result.removed);
  if (result.deletedBranch) return `Removed ${folder} and branch ${result.deletedBranch}`;
  if (result.branchError) return `Removed ${folder}, but couldn't delete its branch: ${result.branchError}`;
  return `Removed ${folder}${w.branch ? `; kept branch ${w.branch}` : ''}`;
}

export function CleanupMenu({ repo, w }: { repo: RepoGroup; w: WorktreeRow }) {
  const [open, setOpen] = useState(false);
  const remove = useMutation({
    mutationFn: () => post<CleanupResult>('/api/worktrees/cleanup', { path: w.path }),
    onSuccess: (result) => {
      setOpen(false);
      toast(outcome(result, w));
      void refreshBoard().catch(() => {});
    },
    onError: (error) => toast(error.message),
  });
  const command = cleanupCommand(repo, w);
  return (
    <Menu label="Clean up ▾" title={`PR ${w.pr?.state.toLowerCase()}: remove this worktree`} look={{ size: 'sm' }} roomy width={[340, 420]} panelClass="gap-1.5" open={open} onOpenChange={setOpen}>
      <div className="w-[min(380px,80vw)] text-xs">
        <Summary w={w} />
        <MenuHint className="mb-2">Checked again first: no session running in it, no uncommitted or untracked files, and no commits that aren&apos;t in the PR or on origin.</MenuHint>
        <MenuActions>
          <CopyButton label="copy command" text={command} title={`Copy the commands instead: ${command}`} />
          <Button type="button" variant="danger" size="sm" disabled={remove.isPending} onClick={() => remove.mutate()}>Remove</Button>
        </MenuActions>
      </div>
    </Menu>
  );
}
