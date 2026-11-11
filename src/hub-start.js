import { branchFromTask } from '../public/branch-name.js';
import { ActionError } from './errors.js';
import { ticketKeys } from './task-links.js';

/*
 * Start on one of your tasks: New task (see tasks.js) in the repo you choose,
 * on a branch that names the task, so its worktree, PR and session show
 * under it, with Claude told the task.
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

/** What Claude is told: the title, the notes on one line, then the ticket links to read. */
export function promptForHubTask(task) {
  const notes = task.notes.split(/\s*\n\s*/).filter(Boolean).join(' ');
  const parts = [task.title, notes, task.links.length > 0 && `Tickets: ${task.links.join(' ')}`].filter(Boolean);
  const prompt = parts.join('. ').replace(/\.\.\s/g, '. ');
  if (prompt.length > MAX_PROMPT) throw new ActionError(400, `The task, its notes and links come to more than ${MAX_PROMPT} characters; shorten the notes to start it`);
  return prompt;
}

/** @param {{ taskHub: { list }, newTask: { startTask }, rediscover?: () => Promise<unknown> }} deps */
export function createHubStarter({ taskHub, newTask, rediscover = async () => {} }) {
  return {
    async start(body) {
      const task = (await taskHub.list()).find((t) => t.id === body?.id);
      if (!task) throw new ActionError(404, 'That task is not there any more');
      if (task.closedAs) throw new ActionError(409, `That task is ${task.closedAs}; Reopen it to start it`);
      const started = await newTask.startTask({ repo: body.repo, branch: branchForHubTask(task), prompt: promptForHubTask(task) });
      // The repo list is cached for a minute; look again now so the new worktree shows under the task.
      await rediscover().catch(() => {});
      return started;
    },
  };
}
