import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Menu, MenuHint, MenuActions } from '../../components/Menu';
import { post } from '../../lib/api';
import { readPref, writePref } from '../../lib/prefs';
import { BRANCH_INPUT_PATTERN, branchFromTask } from '../../../../shared/branch-name.ts';
import { pendingTask, startedTask, type StartResult } from '../../lib/pending-tasks';
import type { AgentsData, Repo } from '../../lib/types';
import { usePendingStore } from '../../stores/pending';
import { toast } from '../../stores/toast';
import { refreshAgents } from './api';
import { Button } from '../../components/Button';
import { Field, fieldInputClass, fieldSelectClass, formClass } from '../../components/Field';

/*
 * "New task ▾": Claude Code on a task, in a worktree on its own branch beside
 * the repo, in a window of the same name in the switchyard tmux session. The
 * branch is optional: left empty, it's named after the task.
 */

const REPO_PREF = 'switchyard.newTaskRepo';
// Claude takes a few seconds to register a new session; look again over that time, so it shows as soon as it's there.
const LOOK_AGAIN_MS = [1500, 3000, 5000, 8000];
const MAX_TASK_CHARS = 2000;
const MAX_BRANCH_CHARS = 100;

let nextPendingId = 1;

interface Fields { repo: string; prompt: string; branch: string }

const lastSegment = (branch: string) => branch.split('/').pop();

/** What will be created, shown as you type. */
function preview(repo: Repo | undefined, { prompt, branch }: Fields): string {
  const typed = branch.trim();
  const task = prompt.trim();
  if (!repo || (!typed && !task)) return 'Starts claude on the task in a worktree beside the repo, in a new tab of the switchyard tmux session.';
  const name = typed || branchFromTask(task);
  return typed
    ? `Folder ${repo.name}-${lastSegment(name)}, on ${name}: yours if it exists, else origin's, else new from the default branch.`
    : `New branch ${name} (or ${name}-2… if taken) in folder ${repo.name}-${name}, from the default branch.`;
}

function NewTaskForm({ repos, onStarted }: { repos: Repo[]; onStarted: () => void }) {
  const remembered = readPref(REPO_PREF);
  const initialRepo = repos.find((r) => r.mainPath === remembered)?.mainPath ?? repos[0]?.mainPath ?? '';
  const empty = { repo: initialRepo, prompt: '', branch: '' };
  const [fields, setFields] = useState<Fields>(empty);
  const { add, update, remove } = usePendingStore.getState();
  const start = useMutation({
    mutationFn: async (sent: Fields & { id: string }) => {
      const repoName = repos.find((r) => r.mainPath === sent.repo)?.name;
      // Shown on the page right away; the form stays filled in, behind the menu, in case it fails.
      add(pendingTask({ id: sent.id, repoName, branch: sent.branch, prompt: sent.prompt.trim(), now: Date.now() }));
      onStarted();
      return post<StartResult>('/api/tasks/new', { repo: sent.repo, branch: sent.branch, prompt: sent.prompt });
    },
    onSuccess: (result, sent) => {
      writePref(REPO_PREF, sent.repo);
      setFields({ ...empty, repo: sent.repo });
      update(sent.id, (t) => startedTask(t, result, Date.now()));
      void refreshAgents();
      LOOK_AGAIN_MS.forEach((ms) => setTimeout(() => void refreshAgents({ force: true }).catch(() => {}), ms));
    },
    onError: (error, sent) => {
      remove(sent.id);
      toast(error.message);
    },
  });
  const change = (key: keyof Fields) => (event: { target: { value: string } }) => setFields((f) => ({ ...f, [key]: event.target.value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    start.mutate({ ...fields, id: `task-${nextPendingId++}` });
  };
  return (
    <form className={formClass} onSubmit={submit}>
      <Field label="Repository">
        <select name="repo" className={fieldSelectClass} required value={fields.repo} onChange={change('repo')}>
          {repos.map((r) => <option key={r.mainPath} value={r.mainPath}>{r.name}</option>)}
        </select>
      </Field>
      <Field label="Task">
        <input name="prompt" type="text" className={fieldInputClass} required maxLength={MAX_TASK_CHARS} autoComplete="off" placeholder="What should Claude do?"
          value={fields.prompt} onChange={change('prompt')} />
      </Field>
      <Field label="Branch (optional)">
        <input name="branch" type="text" className={fieldInputClass} maxLength={MAX_BRANCH_CHARS} autoComplete="off" placeholder="Named after the task"
          pattern={BRANCH_INPUT_PATTERN} title={'Letters, digits, ".", "_", "-" and "/"'} value={fields.branch} onChange={change('branch')} />
      </Field>
      <MenuActions>
        <MenuHint>{preview(repos.find((r) => r.mainPath === fields.repo), fields)}</MenuHint>
        <Button type="submit" size="sm" disabled={start.isPending}>Start</Button>
      </MenuActions>
    </form>
  );
}

/** The New task menu, or nothing when tmux isn't installed. */
export function NewTaskMenu({ data }: { data: AgentsData }) {
  const [open, setOpen] = useState(false);
  if (!data.capabilities.tmux || data.repos.length === 0) return null;
  const repos = [...data.repos].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Menu label="New task ▾" title="Start Claude on a new branch in its own worktree" look={{ variant: 'primary' }} roomy width={[340, 420]} panelClass="gap-1.5" open={open} onOpenChange={setOpen}>
      <NewTaskForm repos={repos} onStarted={() => setOpen(false)} />
    </Menu>
  );
}
