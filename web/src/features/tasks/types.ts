import type { RecentSession } from '../../components/OpenMenu';
import type { Approval, Capabilities, LiveSession, Nav, TaskStart } from '../../lib/types';

/* What /api/hub/tasks and /api/task-tools send (see src/server.js), as far as the Tasks page reads them. */

export type CheckState = 'running' | 'queued' | 'passed' | 'failed' | 'interrupted';
export interface CheckResult {
  name: string;
  command: string;
  state: CheckState;
  exitCode?: number | null;
  detail?: string | null;
  output?: string;
  outOfDate?: boolean;
  startedAt?: number | null;
  finishedAt?: number | null;
  trigger?: string | null;
}

export interface Review {
  state: 'reviewing' | 'needs you' | 'passed' | 'changes' | 'no verdict';
  sessionId: string;
  startedAt: number;
  summary?: string | null;
  session?: LiveSession | null;
}

/** A worktree working on a task, with its checks and the checks its repo has (added by the page). */
export interface Work {
  path: string;
  repoName: string;
  branch?: string | null;
  pr?: { url: string; number: number; state: string } | null;
  live: LiveSession[];
  recent: RecentSession[];
  review?: Review | null;
  checks: CheckResult[];
  checkNames: string[];
}

export interface HubTask {
  id: string;
  title: string;
  notes: string;
  dueOn: string | null;
  links: string[];
  createdAt?: number;
  closedAt?: number | null;
  closedAs?: 'done' | 'dropped' | null;
  parentId?: string | null;
  work: Work[];
}

/** A task as the page shows it: where it stands, any start under way, its subtasks, and what you've just asked of it. */
export interface ShownTask extends HubTask {
  state: string;
  start: TaskStart & { place?: string } | null;
  subtasks?: ShownTask[];
  creating?: boolean;
  closing?: 'done' | 'dropped' | 'delete';
}

export interface TaskGroup { key: string; label: string; tasks: ShownTask[] }

export interface WorktreeChoice { path: string; taskTitle: string; branch?: string | null; changes: number; unmerged: number }

export interface HubData {
  tasks: (HubTask & { work: Omit<Work, 'checks' | 'checkNames'>[] })[];
  checkedAt: number;
  capabilities: Capabilities;
  repos: { name: string; mainPath: string }[];
  approvals: Approval[];
  checks?: Record<string, CheckResult[]>;
  checkNames?: Record<string, string[]>;
  taskStarts?: TaskStart[];
  worktreeChoices?: WorktreeChoice[];
  nav?: Nav;
}

export interface TaskTool {
  id: string;
  name: string;
  kind?: string;
  available: boolean;
  connected: boolean;
  user?: { username: string } | null;
  workspaceId?: string | null;
  workspaces?: { id: string; name: string }[];
}

export interface Ticket {
  id: string;
  customId?: string | null;
  name: string;
  url?: string;
  status: { name: string; color?: string | null };
  where?: string | null;
  dueAt?: number | null;
}

/** What a task form sends. */
export interface TaskFields { title: string; dueOn: string | null; notes: string; links: string[] }
