import { useQuery } from '@tanstack/react-query';
import { NAV_KEY } from '../../components/nav-api';
import { getJson, post } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { toast } from '../../stores/toast';
import { anyRunning } from './check-status';
import { cleanupSummary, type Cleanup } from './worktree-choices';
import { useTasksUi } from './store';
import type { HubData, TaskTool, Ticket } from './types';

/*
 * The Tasks page's data. Polling keeps the work (sessions, PRs, checks)
 * current; while a task is starting or a check runs it looks often, so
 * Claude's trust question or a check's result shows at once.
 */

export const TASKS_KEY = ['hub-tasks'] as const;
export const TOOLS_KEY = ['task-tools'] as const;
const POLL_MS = 10_000;
const STARTING_POLL_MS = 1_500;

async function fetchTasks(force: boolean, signal?: AbortSignal): Promise<HubData> {
  const data = await getJson<HubData>(`/api/hub/tasks${force ? '?refresh=1' : ''}`, signal);
  if (data.nav) queryClient.setQueryData(NAV_KEY, data.nav);
  return data;
}

/** Whether anything is on its way: a start the server is watching, a check running, or a start you just asked for. */
const busy = (data: HubData | undefined) => Object.keys(useTasksUi.getState().creating).length > 0
  || (data?.taskStarts?.length ?? 0) > 0
  || Object.values(data?.checks ?? {}).some((checks) => anyRunning(checks));

export const useHubTasks = () => useQuery({
  queryKey: TASKS_KEY,
  queryFn: ({ signal }) => fetchTasks(false, signal),
  refetchInterval: (query) => (busy(query.state.data) ? STARTING_POLL_MS : POLL_MS),
});

export const useTaskTools = () => useQuery({
  queryKey: TOOLS_KEY,
  queryFn: ({ signal }) => getJson<{ tools: TaskTool[] }>('/api/task-tools', signal).then((d) => d.tools),
});

export const refreshTasks = (): Promise<unknown> => Promise.all([
  queryClient.fetchQuery({ queryKey: TASKS_KEY, queryFn: () => fetchTasks(true), staleTime: 0 }),
  queryClient.invalidateQueries({ queryKey: TOOLS_KEY }),
]);

/** A tracker's open tickets assigned to you, for Add from ▾ (each asked at most once a minute by the server). */
export const fetchTickets = (tool: string) =>
  getJson<{ connected: boolean; tasks: Ticket[]; error?: string | null }>(`/api/task-tools/tickets?tool=${encodeURIComponent(tool)}`);

interface ChangeResult { cleanup?: Cleanup | null; errors?: string[] }

/**
 * Change a task, say how it went, then show the tasks as they are now. `done`
 * is the toast, or a function of the server's answer giving it. Closing or
 * deleting a task puts its work away, so what went, and what couldn't, is said
 * too. Resolves whether it worked.
 */
export async function changeTask<T extends ChangeResult>(url: string, body: unknown, done?: string | ((result: T) => string)): Promise<boolean> {
  let result: T;
  try {
    result = await post<T>(url, body);
  } catch (error) {
    toast((error as Error).message);
    return false;
  }
  const said = typeof done === 'function' ? done(result) : done;
  const errors = [...(result?.cleanup?.errors ?? []), ...(result?.errors ?? [])];
  const summary = cleanupSummary(result?.cleanup);
  if (errors.length > 0) toast(`${said}. ${errors.join(' ')}`);
  else if (said) toast(summary ? `${said} · ${summary}` : said);
  await queryClient.invalidateQueries({ queryKey: TASKS_KEY });
  return true;
}

/** Connect, disconnect or pick a workspace: the server answers with the trackers as they are now. */
export async function changeTools(url: string, body: unknown, done?: string): Promise<boolean> {
  try {
    const { tools } = await post<{ tools: TaskTool[] }>(url, body);
    queryClient.setQueryData(TOOLS_KEY, tools);
  } catch (error) {
    toast((error as Error).message);
    void queryClient.invalidateQueries({ queryKey: TOOLS_KEY });
    return false;
  }
  if (done) toast(done);
  return true;
}
