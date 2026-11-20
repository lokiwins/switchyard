/*
 * The pages' logic that has no DOM in it, shared with the pages not yet moved
 * to React (and tested in node under test/). Typed here for the React pages.
 */
import * as sessionText from '../../../public/session-text.js';
import * as pending from '../../../public/pending-tasks.js';
import { BRANCH_INPUT_PATTERN as branchPattern, branchFromTask as fromTask } from '../../../public/branch-name.js';
import type { Approval, Capabilities, Detail, Host, LiveSession, TaskStart, Transcript } from './types';

/** What the session words read: a live session, an ended one, or a worktree's last one all have these. */
export type SessionLike = Partial<Pick<LiveSession, 'name' | 'nameIsCustom' | 'needsYou' | 'screenPrompt' | 'status' | 'inBackground'>>
  & { transcript?: Transcript; endState?: string | null };

export const sessionTitle = sessionText.sessionTitle as (s: SessionLike) => string;
export const sessionDetail = sessionText.sessionDetail as (s: SessionLike) => Detail | null;
export const sessionSearchText = sessionText.sessionSearchText as (s: SessionLike) => (string | null | undefined)[];
export const sessionLabel = sessionText.sessionLabel as (s: LiveSession) => string;
export const sessionDot = sessionText.sessionDot as (s: LiveSession) => string;
export const answerElsewhere = sessionText.answerElsewhere as (s: LiveSession, approvals: Approval[]) => string | null;
export const canPressKeys = sessionText.canPressKeys as (host: Host | null | undefined) => boolean;
export const canShowTerminalSessions = sessionText.canShowTerminalSessions as (caps: Capabilities | undefined) => boolean;
export const foldsWhenParked = sessionText.foldsWhenParked as (s: LiveSession) => boolean;

export interface PendingTask {
  id: string;
  stage: 'creating' | 'starting' | 'trust' | 'exited';
  repoName?: string;
  prompt: string;
  branch: string;
  createdAt: number;
  startedAt: number | null;
  path?: string;
  place?: string;
  detail?: string | null;
  exitedAt?: number;
}
export interface StartResult { path: string; branch: string; session: string; window: string }

export const { SLOW_MS, EXITED_SHOW_MS, GIVE_UP_MS } = pending as { SLOW_MS: number; EXITED_SHOW_MS: number; GIVE_UP_MS: number };
export const pendingTask = pending.pendingTask as (t: { id: string; repoName?: string; branch: string; prompt: string; now: number }) => PendingTask;
export const startedTask = pending.startedTask as (t: PendingTask, result: StartResult, now: number) => PendingTask;
export const settlePending = pending.settlePending as (tasks: PendingTask[], live: LiveSession[], now: number, starts?: TaskStart[]) =>
  { pending: PendingTask[]; arrived: PendingTask[]; expired: PendingTask[] };
export const pendingText = pending.pendingText as (t: PendingTask, now: number) => { label: string; detail: string; note: string | null };

export const BRANCH_INPUT_PATTERN = branchPattern as string;
export const branchFromTask = fromTask as (task: string) => string;
