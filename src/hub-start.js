import { branchFromTask } from '../shared/branch-name.ts';
import { ActionError } from './errors.js';
import { taskWorktrees, ticketKeys } from './task-links.js';

/*
 * Start on one of your tasks: New task (see tasks.js) in the repo you choose,
 * on a branch that names the task, so its worktree, PR and session show
 * under it, with the agent told the task.
 */

// New task's limit on what's typed after `claude`.
const MAX_PROMPT = 2000;
// A ClickUp task id (as opposed to a custom id like ENG-123): ClickUp reads branches as CU-<id>.
const CLICKUP_ID = /^[a-z0-9]+$/;

/** The task's branch: CU-<id> (or the custom id) when it links a ClickUp ticket, else its own id; then its title's words. */
export function branchForHubTask(task) {
  const [ticket] = ticketKeys(task.links);
  const key = ticket ? (CLICKUP_ID.test(ticket) ? `CU-${ticket}` : ticket) : task.id;
  return `${key}-${branchFromTask(task.title)}`;
}

// What a lead is told besides its task; the tools' own descriptions say the rest.
const LEAD_NOTE = 'You lead this task: you can hand parts of it to worker agents with switchyard\'s start_worker tool '
  + '(each gets a subtask of this task, with its own worktree and branch off yours) and check on them with list_workers. '
  + 'Merge their branches into yours when they are done.';

/** What Claude is told: the title, the notes on one line, then the ticket links to read; and, for a lead, that it leads. */
export function promptForHubTask(task, { lead = false } = {}) {
  const notes = task.notes.split(/\s*\n\s*/).filter(Boolean).join(' ');
  const parts = [task.title, notes, task.links.length > 0 && `Tickets: ${task.links.join(' ')}`, lead && LEAD_NOTE].filter(Boolean);
  const prompt = parts.join('. ').replace(/\.\.\s/g, '. ');
  if (prompt.length > MAX_PROMPT) throw new ActionError(400, `The task, its notes and links come to more than ${MAX_PROMPT} characters; shorten the notes to start it`);
  return prompt;
}

/** The parent's branch in `repo`, for a subtask started there to begin from; null when it has none there. */
function parentBranch(tasks, task, repos, repoPath) {
  const parent = task.parentId ? tasks.find((t) => t.id === task.parentId) : null;
  const repo = repos.find((r) => r.mainPath === repoPath);
  if (!parent || !repo) return null;
  return taskWorktrees(parent, [repo])[0]?.worktree.branch ?? null;
}

/** Whether to start as the task's lead: true, or false when left out. Only a top-level task leads. */
function parseLead(body, task) {
  const lead = body.lead ?? false;
  if (typeof lead !== 'boolean') throw new ActionError(400, 'Expected lead to be true or false');
  if (lead && task.parentId) throw new ActionError(400, 'A subtask can\'t lead: workers are one level deep');
  return lead;
}

/**
 * @param {{ taskHub: { list }, newTask: { startTask }, rediscover?: () => Promise<unknown>,
 *   getRepos?: () => Promise<object[]>, writeLeadConfig?: (taskId: string) => Promise<string> }} deps
 *   `getRepos()` gives the repos and their worktrees, to find a parent's branch; `writeLeadConfig(id)` writes
 *   the files a lead starts with and gives their paths, { mcpConfig, settings } (see lead-access.js);
 *   `prepareWorker(id)` gives how a worker starts, { permissionMode?, settings? } (see worker-launch.js).
 */
export function createHubStarter({
  taskHub, newTask, rediscover = async () => {}, getRepos = async () => [], writeLeadConfig = null, prepareWorker = null,
}) {
  return {
    /**
     * Start a task; with `lead`, as its lead, able to start workers through switchyard's MCP tools.
     * With `worker` (only from a lead's start_worker, never the page), as a worker, with the Workers settings.
     */
    async start(body, { worker = false } = {}) {
      const tasks = await taskHub.list();
      const task = tasks.find((t) => t.id === body?.id);
      if (!task) throw new ActionError(404, 'That task is not there any more');
      if (task.closedAs) throw new ActionError(409, `That task is ${task.closedAs}; Reopen it to start it`);
      const lead = parseLead(body, task);
      if (lead && !writeLeadConfig) throw new ActionError(501, 'Starting as lead is not set up');
      // A subtask started in its parent's repo begins from the parent's branch, so its work can be merged back there.
      const base = task.parentId ? parentBranch(tasks, task, await getRepos(), body.repo) : null;
      const prompt = promptForHubTask(task, { lead });
      const options = lead ? await writeLeadConfig(task.id) : worker && prepareWorker ? await prepareWorker(task.id) : {};
      const started = await newTask.startTask({
        repo: body.repo,
        branch: branchForHubTask(task),
        prompt,
        ...(body.provider !== undefined ? { provider: body.provider } : {}),
        ...(base ? { base } : {}),
      }, options);
      // The repo list is cached for a minute; look again now so the new worktree shows under the task.
      await rediscover().catch(() => {});
      return started;
    },
  };
}
