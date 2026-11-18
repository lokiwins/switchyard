import { branchFromTask } from '../public/branch-name.js';
import { ActionError } from './errors.js';
import { ticketKeys } from './task-links.js';

/*
 * Start on one of your tasks: New task (see tasks.js) in the repo you choose,
 * on a branch that names the task, so its worktree, PR and session show
 * under it, with the agent told the task. With attempts, it starts several
 * at once, each in its own worktree on <branch>-try1, -try2…, all told the
 * same thing, so you can compare them and keep the best.
 */

// The most attempts one Start makes: past this, there's more to review than time saved.
export const MAX_ATTEMPTS = 4;

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

/** How many attempts a start asks for: 1 when it doesn't say; a 400 for anything but 1 to MAX_ATTEMPTS. */
export function parseAttempts(value) {
  if (value === undefined) return 1;
  if (!Number.isInteger(value) || value < 1 || value > MAX_ATTEMPTS) throw new ActionError(400, `Attempts must be a whole number from 1 to ${MAX_ATTEMPTS}`);
  return value;
}

/**
 * @param {{ taskHub: { list, recordAttempts }, newTask: { startTask }, rediscover?: () => Promise<unknown>, now?: () => number }} deps
 */
export function createHubStarter({ taskHub, newTask, rediscover = async () => {}, now = Date.now }) {
  /** Start each attempt in turn (git locks the repo while it adds a worktree); one that fails doesn't stop the rest. */
  async function startAttempts(base, count) {
    const attempts = [];
    const errors = [];
    for (let n = 1; n <= count; n += 1) {
      try {
        attempts.push(await newTask.startTask({ ...base, branch: `${base.branch}-try${n}` }));
      } catch (error) {
        errors.push({ error, message: `Attempt ${n}: ${error.message}` });
      }
    }
    return { attempts, errors };
  }

  return {
    async start(body) {
      const count = parseAttempts(body?.attempts);
      const task = (await taskHub.list()).find((t) => t.id === body?.id);
      if (!task) throw new ActionError(404, 'That task is not there any more');
      if (task.closedAs) throw new ActionError(409, `That task is ${task.closedAs}; Reopen it to start it`);
      const base = {
        repo: body.repo,
        branch: branchForHubTask(task),
        prompt: promptForHubTask(task),
        ...(body.provider !== undefined ? { provider: body.provider } : {}),
      };
      if (count === 1) {
        const started = await newTask.startTask(base);
        // The repo list is cached for a minute; look again now so the new worktree shows under the task.
        await rediscover().catch(() => {});
        return started;
      }
      const { attempts, errors } = await startAttempts(base, count);
      // None started: say why, as a single start would.
      if (attempts.length === 0) throw errors[0].error;
      await taskHub.recordAttempts(task.id, {
        provider: attempts[0].provider, repo: body.repo, branches: attempts.map((a) => a.branch), startedAt: now(),
      });
      await rediscover().catch(() => {});
      return { attempts, errors: errors.map((e) => e.message) };
    },
  };
}
