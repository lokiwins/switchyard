/*
 * Where each of your tasks stands, worked out from its work (the worktrees
 * whose branch names it, their PRs and Claude sessions), and how the Tasks
 * page groups them: what needs you first, then by when it's due, then done.
 */

import type { LiveSession, TaskStart } from '../../lib/types';
import type { HubTask, ShownTask, TaskGroup, Work } from './types';

/** A task as the server sends it, with what you've just asked of it (see ShownTask). */
export type TaskIn = Omit<HubTask, 'work'> & { work?: Partial<Work>[]; creating?: boolean; closing?: ShownTask['closing'] };

type StateTone = { label: string; tone: string };
/** What a task's state is worked out from. */
type StateFields = Partial<Pick<TaskIn, 'closing' | 'closedAs' | 'work' | 'creating' | 'parentId'>>;

const DAY_MS = 24 * 60 * 60 * 1000;
// "This week": today's group aside, up to this many days ahead.
const WEEK_DAYS = 6;

/** How each state reads on the page, and its colour. */
export const STATE_LABELS: Record<string, StateTone> = {
  'needs-you': { label: 'Needs you', tone: 'amber' },
  starting: { label: 'Starting…', tone: 'green' },
  closing: { label: 'Closing…', tone: '' },
  deleting: { label: 'Deleting…', tone: '' },
  working: { label: 'Working', tone: 'green' },
  'in-review': { label: 'In review', tone: 'purple' },
  paused: { label: 'Paused', tone: '' },
  ended: { label: 'Ended', tone: '' },
  'not-started': { label: 'Not started', tone: '' },
  done: { label: 'Done', tone: '' },
  dropped: { label: 'Dropped', tone: '' },
};

// Work under way before work not started, within a group.
const STATE_ORDER = ['needs-you', 'closing', 'deleting', 'starting', 'working', 'in-review', 'paused', 'ended', 'not-started', 'done', 'dropped'];

const GROUPS = [
  { key: 'needs-you', label: 'Needs you' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'later', label: 'Later' },
  { key: 'no-date', label: 'No date' },
  { key: 'done', label: 'Done' },
];

/** A session waiting on you: asking something, or done and waiting for your next message (unless idle over a day). */
const waitsOnYou = (s: LiveSession) => s.needsYou || (s.status === 'idle' && !s.parked);

const trimSlash = (path: string | null | undefined) => String(path ?? '').replace(/\/+$/, '');

// With several of a task's worktrees starting at once, the one to show: a question for you first, then one still on its way.
const START_ORDER = ['asking-trust', 'starting', 'exited'];
const startRank = (start: TaskStart) => {
  const rank = START_ORDER.indexOf(start.state);
  return rank < 0 ? START_ORDER.length : rank;
};

/** The start under way in one of the task's worktrees, as the server watches it (see src/task-starts.js); null when none. */
export function startOf(task: { work?: Partial<Work>[] }, starts: TaskStart[] = []): TaskStart | null {
  const paths = new Set((task.work ?? []).map((w) => trimSlash(w.path)));
  const mine = starts.filter((s) => paths.has(trimSlash(s.path)));
  return mine.reduce<TaskStart | null>((best, s) => (best === null || startRank(s) < startRank(best) ? s : best), null);
}

/**
 * Where a task stands: done or dropped, needs you, starting, working, in
 * review, paused (work but nothing running), ended (a lead's worker whose
 * session has ended: it isn't coming back by itself), or not started. `starts` are the
 * tasks the server is watching start: one asking to trust its folder needs
 * you, and one that quit is paused.
 */
export function taskState(task: StateFields, starts: TaskStart[] = []): string {
  // Shown the moment you click, while the server ends its sessions and puts its worktrees away.
  if (task.closing) return task.closing === 'delete' ? 'deleting' : 'closing';
  if (task.closedAs) return task.closedAs;
  const work = task.work ?? [];
  if (work.some((w) => w.pr?.state === 'MERGED')) return 'done';
  const live = work.flatMap((w) => w.live ?? []);
  const start = startOf(task, starts);
  // A reviewer (see ReviewControl.tsx) needs you only while it asks something; idle, it has said its piece.
  const reviewerAsks = work.some((w) => w.review?.session?.needsYou);
  if (live.some(waitsOnYou) || reviewerAsks || start?.state === 'asking-trust') return 'needs-you';
  if (task.creating || start?.state === 'starting') return 'starting';
  if (live.some((s) => s.status === 'busy')) return 'working';
  if (work.some((w) => w.pr?.state === 'OPEN')) return 'in-review';
  if (work.length === 0) return 'not-started';
  return task.parentId && live.length === 0 ? 'ended' : 'paused';
}

/** A local day as a count of days, so two days can be subtracted. */
const dayNumber = (year: number, month: number, day: number) => Math.round(Date.UTC(year, month - 1, day) / DAY_MS);

function today(now: number) {
  const date = new Date(now);
  return dayNumber(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** Days from today to a "2026-11-20" due day: negative when it's passed. */
function daysUntil(dueOn: string, now: number) {
  const [year = 0, month = 1, day = 1] = dueOn.split('-').map(Number);
  return dayNumber(year, month, day) - today(now);
}

/** "Overdue 2d", "Due today", "Due tomorrow" or "Due Nov 20", with a tone for the first three; null without a date. */
export function dueOnLabel(dueOn: string | null | undefined, now = Date.now()): { text: string; tone: string | null } | null {
  if (!dueOn) return null;
  const days = daysUntil(dueOn, now);
  if (days < 0) return { text: `Overdue ${-days}d`, tone: 'red' };
  if (days === 0) return { text: 'Due today', tone: 'amber' };
  if (days === 1) return { text: 'Due tomorrow', tone: 'amber' };
  const [year = 0, month = 1, day = 1] = dueOn.split('-').map(Number);
  return { text: `Due ${new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, tone: null };
}

function groupOf(task: Pick<ShownTask, 'state' | 'dueOn'>, now: number) {
  if (task.state === 'done' || task.state === 'dropped') return 'done';
  if (task.state === 'needs-you') return 'needs-you';
  if (!task.dueOn) return 'no-date';
  const days = daysUntil(task.dueOn, now);
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  return days <= WEEK_DAYS ? 'week' : 'later';
}

type Sortable = Pick<ShownTask, 'dueOn' | 'state' | 'createdAt' | 'closedAt'>;
const byDue = (a: Sortable, b: Sortable) => (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999');
const byState = (a: Sortable, b: Sortable) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state);
const byNewest = (a: Sortable, b: Sortable) => (b.createdAt ?? 0) - (a.createdAt ?? 0);
const byClosed = (a: Sortable, b: Sortable) => (b.closedAt ?? 0) - (a.closedAt ?? 0);

/** The page's groups, in order, each with its tasks (carrying `state` and any `start`); groups with no tasks are left out. */
export function groupTasks(tasks: TaskIn[], now = Date.now(), starts: TaskStart[] = []): TaskGroup[] {
  const withState = tasks.map((task) => ({ ...task, state: taskState(task, starts), start: startOf(task, starts) }) as ShownTask);
  // Subtasks go under their parent (newest last, as they were added); one whose parent isn't listed stands on its own.
  const listed = new Set(withState.map((task) => task.id));
  const nested = (task: ShownTask) => Boolean(task.parentId) && listed.has(task.parentId ?? '');
  const topLevel = withState.filter((task) => !nested(task)).map((task) => ({
    ...task,
    subtasks: withState.filter((sub) => sub.parentId === task.id).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)),
  }));
  return GROUPS.map((group) => {
    const members = topLevel.filter((task) => groupOf(task, now) === group.key);
    const order = group.key === 'done' ? byClosed : (a: Sortable, b: Sortable) => byDue(a, b) || byState(a, b) || byNewest(a, b);
    return { ...group, tasks: members.sort(order) };
  }).filter((group) => group.tasks.length > 0);
}

/** Whether a task matches the filter box: its title, id, notes, links, or a branch working on it. */
export function matchesHubTask(task: Pick<HubTask, 'title' | 'id' | 'notes' | 'links'> & { work?: Partial<Work>[] }, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return [task.title, task.id, task.notes, ...(task.links ?? []), ...(task.work ?? []).map((w) => w.branch)]
    .some((field) => typeof field === 'string' && field.toLowerCase().includes(q));
}

// What a ticket link reads as on a row: its tracker and number where one is recognised.
interface TicketKind { tracker: string; host: RegExp; path: RegExp; label: (key: string) => string }
const TICKETS: TicketKind[] = [
  { tracker: 'clickup', host: /^app\.clickup\.com$/, path: /^\/t\/(?:\d+\/)?([A-Za-z0-9][A-Za-z0-9_-]*)\/?$/, label: (id) => `ClickUp ${id}` },
  { tracker: 'github', host: /^github\.com$/, path: /^\/[^/]+\/[^/]+\/(?:issues|pull)\/(\d+)/, label: (n) => `GitHub #${n}` },
  { tracker: 'jira', host: /\.atlassian\.net$/, path: /^\/browse\/([A-Z][A-Z0-9_]*-\d+)/, label: (key) => `Jira ${key}` },
  { tracker: 'ado', host: /^dev\.azure\.com$|\.visualstudio\.com$/, path: /\/_workitems\/edit\/(\d+)/, label: (n) => `ADO ${n}` },
];

/** The recognised ticket a link is, with its id or number; null for any other link. */
function recognise(link: string): { ticket: TicketKind | null; key?: string; url: URL } | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  for (const ticket of TICKETS) {
    const match = ticket.host.test(url.hostname) ? ticket.path.exec(url.pathname) : null;
    if (match?.[1]) return { ticket, key: match[1], url };
  }
  return { ticket: null, url };
}

/** Which tracker a link is in ('clickup', 'github', 'jira', 'ado'), for its badge; null for any other link. */
export function trackerOf(link: string): string | null {
  return recognise(link)?.ticket?.tracker ?? null;
}

/** "ClickUp 86b1abc2d", "GitHub #42", "Jira SHOP-17", "ADO 310", or the site's name for any other link. */
export function ticketLabel(link: string): string {
  const found = recognise(link);
  if (!found) return 'link';
  return found.ticket && found.key ? found.ticket.label(found.key) : found.url.hostname.replace(/^www\./, '');
}

/** Where a task made from a session or worktree will be linked, in words, for its form. */
export function linkedWhere({ repoName, branch, sessionOnly }: { repoName?: string; branch?: string | null; sessionOnly?: boolean }): string {
  if (sessionOnly) return branch ? `Linked to this session only, since ${branch} is a long-lived branch` : 'Linked to this session only';
  return `Linked to ${repoName} · ${branch}`;
}
