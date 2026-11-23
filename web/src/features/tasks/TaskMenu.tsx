import { useState } from 'react';
import { Menu, MenuItem, MenuTitle } from '../../components/Menu';
import { hasFailedCheck } from './check-status';
import type { ShownTask } from './types';

/* ⋯ on a task: Mark done, Drop, Add subtask…, Reopen, Delete…. Delete asks once more inside the menu. */

// What closing or deleting a task does to its work (see src/task-cleanup.js).
export const PUTS_AWAY = 'Its running sessions end and its worktrees are removed; one with uncommitted changes or unmerged commits asks you first.';

export interface TaskMenuActions {
  close: (as: 'done' | 'dropped') => void;
  reopen: () => void;
  remove: () => void;
  addSubtask: () => void;
}

function Item({ label, title, onChoose }: { label: string; title: string; onChoose: () => void }) {
  return <MenuItem title={title} onClick={onChoose}><MenuTitle>{label}</MenuTitle></MenuItem>;
}

export function TaskMenu({ task, actions }: { task: ShownTask; actions: TaskMenuActions }) {
  const [open, setOpen] = useState(false);
  // Delete's "Click again" is armed only while the menu stays open.
  const [armed, setArmed] = useState(false);
  const toggle = (next: boolean) => {
    setOpen(next);
    if (!next) setArmed(false);
  };
  const choose = (run: () => void) => () => {
    toggle(false);
    run();
  };
  const subtasks = task.subtasks?.length ?? 0;
  const confirm = subtasks > 0 ? `Click again to delete it and its ${subtasks === 1 ? 'subtask' : `${subtasks} subtasks`}` : 'Click again to delete';
  return (
    <Menu label="⋯" title="More" look={{ variant: 'action' }} focusInput={false} open={open} onOpenChange={toggle}>
      {task.closedAs ? <Item label="Reopen" title="Put it back with your open tasks" onChoose={choose(actions.reopen)} /> : (
        <>
          {/* Checks only warn: a failed one is named here, and Mark done still works. */}
          {hasFailedCheck(task)
            ? <Item label="Mark done anyway (check failed)" title={`Its latest check failed. Done anyway, without a merged PR to say so. ${PUTS_AWAY}`} onChoose={choose(() => actions.close('done'))} />
            : <Item label="Mark done" title={`Done, without a merged PR to say so. ${PUTS_AWAY}`} onChoose={choose(() => actions.close('done'))} />}
          <Item label="Drop" title={`Not doing it after all. ${PUTS_AWAY}`} onChoose={choose(() => actions.close('dropped'))} />
          {/* One level deep: a subtask has none of its own. */}
          {!task.parentId && (
            <Item label="Add subtask…" title="A task of its own under this one, with its own worktree, branched from this task's branch" onChoose={choose(actions.addSubtask)} />
          )}
        </>
      )}
      <Item label={armed ? confirm : 'Delete…'} title={`Remove this task from switchyard. ${PUTS_AWAY} Its branches and tickets stay.`}
        onChoose={armed ? choose(actions.remove) : () => setArmed(true)} />
    </Menu>
  );
}
