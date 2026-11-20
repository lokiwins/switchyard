import { useState, type FormEvent } from 'react';
import { Menu } from '../../components/Menu';
import { readPref, writePref } from '../../lib/prefs';
import { parentWorkFor } from './logic';
import type { ShownTask } from './types';
import { Button } from '../../components/Button';

/*
 * Start ▾: pick the repo, then Start: the agent on the task in a new
 * worktree, in the switchyard tmux session. A subtask offers its parent's
 * repo first, where it starts from the parent's branch (see src/hub-start.js).
 * A top-level task can start as lead, able to start workers on its subtasks.
 */

// The repo you last started a task in, shared with New task on the Agents page.
const REPO_PREF = 'switchyard.newTaskRepo';

export function StartMenu({ task, repos, parent, onStart }: {
  task: ShownTask;
  repos: { name: string; mainPath: string }[];
  parent: ShownTask | null;
  onStart: (repo: string, lead: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const sorted = [...repos].sort((a, b) => a.name.localeCompare(b.name));
  const parentWork = parentWorkFor(parent, sorted);
  const parentRepo = parentWork ? sorted.find((r) => r.name === parentWork.repoName)?.mainPath : undefined;
  const remembered = parentRepo ?? readPref(REPO_PREF);
  const [repo, setRepo] = useState(sorted.find((r) => r.mainPath === remembered)?.mainPath ?? sorted[0]?.mainPath ?? '');
  const [lead, setLead] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    writePref(REPO_PREF, repo);
    setOpen(false);
    onStart(repo, lead);
  };
  return (
    <Menu label="Start ▾" title="Start Claude on this task" look={{ size: 'sm' }} panelClass="reply-panel" focusInput={false} open={open} onOpenChange={setOpen}>
      <form className="task-form" onSubmit={submit}>
        <label className="task-field">
          <span>Repository</span>
          <select name="repo" required value={repo} onChange={(event) => setRepo(event.target.value)}>
            {sorted.map((r) => <option key={r.mainPath} value={r.mainPath}>{r.name}</option>)}
          </select>
        </label>
        {parentWork && (
          <p className="reply-hint">In <strong>{parentWork.repoName}</strong> it starts from <code>{parentWork.branch}</code>, its parent&apos;s branch, so its work can be merged back there.</p>
        )}
        {/* Only a top-level task leads: its workers are its subtasks, one level deep. */}
        {!task.parentId && (
          <label className="task-check">
            <input type="checkbox" name="lead" checked={lead} onChange={(event) => setLead(event.target.checked)} />
            <span><strong>Start as lead</strong>: Claude can start workers on subtasks of this task with switchyard&apos;s tools, and asks you before using them.</span>
          </label>
        )}
        <div className="task-actions">
          <p className="reply-hint">Starts Claude on this task in a new worktree beside the repo, on a branch that names the task, in the switchyard tmux session.</p>
          <Button type="submit" size="sm">Start</Button>
        </div>
      </form>
    </Menu>
  );
}
