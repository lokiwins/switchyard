/*
 * The Tasks page's logic with no DOM in it, kept in public/ and tested in node
 * (task-state.js, check-status.js, review-status.js, ticket-import.js,
 * worktree-choices.js, task-views.js), typed here for the page.
 */
import * as taskState from '../../../../public/task-state.js';
import * as checkStatus from '../../../../public/check-status.js';
import * as reviewStatus from '../../../../public/review-status.js';
import * as ticketImport from '../../../../public/ticket-import.js';
import * as choices from '../../../../public/worktree-choices.js';
import * as taskViews from '../../../../public/task-views.js';
import type { LiveSession, TaskStart } from '../../lib/types';
import type { CheckResult, HubTask, Review, ShownTask, TaskFields, TaskGroup, Ticket, Work, WorktreeChoice } from './types';

export const STATE_LABELS = taskState.STATE_LABELS as Record<string, { label: string; tone: string }>;
export const groupTasks = taskState.groupTasks as (tasks: (HubTask & Partial<ShownTask>)[], now: number, starts?: TaskStart[]) => TaskGroup[];
export const matchesHubTask = taskState.matchesHubTask as (task: HubTask, query: string) => boolean;
export const dueOnLabel = taskState.dueOnLabel as (dueOn: string | null, now: number) => { text: string; tone: string | null } | null;
export const ticketLabel = taskState.ticketLabel as (link: string) => string;
export const trackerOf = taskState.trackerOf as (link: string) => string | null;
export const linkedWhere = taskState.linkedWhere as (w: { repoName?: string; branch?: string; sessionOnly?: boolean }) => string;

export const checkLabel = checkStatus.checkLabel as (check: CheckResult) => { text: string; tone: string };
export const anyRunning = checkStatus.anyRunning as (checks?: CheckResult[]) => boolean;
export const hasFailedCheck = checkStatus.hasFailedCheck as (task: { work?: Work[] }) => boolean;
export const ranBy = checkStatus.ranBy as (check: CheckResult) => string | null;

export const reviewLabel = reviewStatus.reviewLabel as (review: Review) => { text: string; tone: string };
export const reviewReasons = reviewStatus.reviewReasons as (summary: string | null | undefined) => string;

export const unlinkedTickets = ticketImport.unlinkedTickets as (tickets: Ticket[], tasks: HubTask[]) => Ticket[];
export const taskFromTicket = ticketImport.taskFromTicket as (ticket: Ticket) => TaskFields;
export const matchesTicket = ticketImport.matchesTicket as (ticket: Ticket, query: string) => boolean;

export const cleanupSummary = choices.cleanupSummary as (cleanup: unknown) => string;
export const whatsLeft = choices.whatsLeft as (choice: WorktreeChoice) => string;

export const sessionToJump = taskViews.sessionToJump as (work: { live: LiveSession[] }) => LiveSession | null;

/** The due date as of now; a closed task shows none. */
export const rowDue = (task: ShownTask, now: number) => (task.state === 'done' || task.state === 'dropped' ? null : dueOnLabel(task.dueOn, now));

/** Whether Start ▾ is offered: a task not started yet, with tmux and a repo to start in. */
export const canStart = (task: ShownTask, { tmux, repos }: { tmux: boolean; repos: unknown[] }) => task.state === 'not-started' && tmux && repos.length > 0;

/** The parent's worktree a subtask starts from: its first one with a branch in a known repo. */
export const parentWorkFor = (parent: ShownTask | null | undefined, repos: { name: string }[]): Work | null =>
  parent?.work.find((w) => w.branch && repos.some((r) => r.name === w.repoName)) ?? null;
