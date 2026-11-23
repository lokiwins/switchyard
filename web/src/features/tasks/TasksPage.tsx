import { useIsFetching } from '@tanstack/react-query';
import { useDeferredValue, useEffect } from 'react';
import { Errors } from '../../components/Errors';
import { LiveTime } from '../../components/LiveTime';
import { Panel } from '../../components/Panel';
import { RefreshButton } from '../../components/RefreshButton';
import { SearchBox } from '../../components/SearchBox';
import { TopBar, TopBarStatus } from '../../components/TopBar';
import { useNow } from '../../lib/time';
import { toast } from '../../stores/toast';
import { taskActions, createTask } from './actions';
import { refreshTasks, TASKS_KEY, useHubTasks, useTaskTools } from './api';
import { ConnectionsMenu } from './Connections';
import { groupTasks, matchesHubTask } from './logic';
import { NewTaskForm } from './NewTaskForm';
import { useTasksUi } from './store';
import { TaskGroups } from './TaskGroups';
import type { HubData } from './types';
import { WorktreeChoices } from './WorktreeChoices';
import { Empty } from '../../components/Empty';
import { filtersClass } from '../../components/classes';

/* The Tasks page: your own tasks, what needs you first, then by when they're due, each with the work on it. */

const EMPTY_TEXT = 'No tasks yet. Add what you’re working on above, with links to its tickets; its worktree, PR and Claude session show under it.';

/** Arriving from a session's "Task" link (/tasks#sy-…): open that task's details, once. */
function useOpenFromLink(data: HubData | undefined) {
  useEffect(() => {
    if (!data) return;
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    const task = data.tasks.find((t) => t.id === id);
    if (task) taskActions.open(task);
    else toast('That task is not there any more');
  }, [data]);
}

function TaskList({ data, query }: { data: HubData; query: string }) {
  const creating = useTasksUi((s) => s.creating);
  const closing = useTasksUi((s) => s.closing);
  const now = useNow();
  const shown = data.tasks.filter((task) => matchesHubTask(task, query));
  if (shown.length === 0) {
    return <Empty>{data.tasks.length ? `No tasks match “${query}”.` : EMPTY_TEXT}</Empty>;
  }
  const tasks = shown.map((task) => ({
    ...task,
    // Each worktree's latest checks, and the checks its repo has to run (see src/checks.js).
    work: task.work.map((w) => ({ ...w, checks: data.checks?.[w.path] ?? [], checkNames: data.checkNames?.[w.repoName] ?? [] })),
    ...(creating[task.id] ? { creating: true } : {}),
    ...(closing[task.id] ? { closing: closing[task.id] } : {}),
  }));
  const groups = groupTasks(tasks, now, data.taskStarts);
  return <TaskGroups groups={groups} searching={Boolean(query)} context={{ now, caps: data.capabilities, repos: data.repos, approvals: data.approvals }} />;
}

export function TasksPage() {
  const { data, error } = useHubTasks();
  const tools = useTaskTools();
  const fetching = useIsFetching({ queryKey: TASKS_KEY }) > 0;
  const setQuery = useTasksUi((s) => s.setQuery);
  const query = useDeferredValue(useTasksUi((s) => s.query));
  useOpenFromLink(data);
  const errors = [
    ...(error ? [`Could not load your tasks: ${error.message}`] : []),
    ...(tools.error ? [`Could not load connections: ${tools.error.message}`] : []),
  ];
  const open = data?.tasks.filter((task) => !task.closedAs).length ?? 0;
  return (
    <>
      <TopBar current="/tasks">
        <span id="connections"><ConnectionsMenu /></span>
        <TopBarStatus>{data ? <LiveTime since={data.checkedAt} prefix="Updated " /> : 'Loading…'}</TopBarStatus>
        <RefreshButton busy={fetching} onRefresh={refreshTasks} />
      </TopBar>
      <main>
        <Errors errors={errors.map((message) => ({ source: '', message }))} bare />
        <Panel id="tasks-title" title="Tasks" head={(
          <div className={filtersClass}>
            <span id="task-count" className="text-xs text-gray-500">{data?.tasks.length ? `${open} open` : ''}</span>
            <SearchBox placeholder="Filter title, id, notes, link, branch…" label="Filter tasks" value={query} onChange={setQuery} />
          </div>
        )}>
          <div id="new-task"><NewTaskForm tasks={data?.tasks ?? []} onCreate={(fields) => createTask(fields)} /></div>
          <WorktreeChoices choices={data?.worktreeChoices ?? []} />
          <div id="tasks">{data ? <TaskList data={data} query={query} /> : <Empty>Loading your tasks…</Empty>}</div>
        </Panel>
      </main>
    </>
  );
}
