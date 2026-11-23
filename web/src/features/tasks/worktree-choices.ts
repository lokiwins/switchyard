/*
 * After a task is closed or deleted, its work is put away (see
 * src/task-cleanup.js). This says what happened, and asks about each worktree
 * that was kept because it has uncommitted changes or unmerged commits: keep
 * it, or delete it. The words for that.
 */

import type { WorktreeChoice } from './types';

/** What putting a task's work away did (see src/task-cleanup.js). */
export interface Cleanup { ended: unknown[]; removed: unknown[]; choices: unknown[]; errors?: string[] }

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "ended 1 session · removed 2 worktrees · 1 worktree needs your choice", or '' when nothing was there to put away. */
export function cleanupSummary(cleanup: Cleanup | null | undefined): string {
  if (!cleanup) return '';
  return [
    cleanup.ended.length > 0 && `ended ${count(cleanup.ended.length, 'session')}`,
    cleanup.removed.length > 0 && `removed ${count(cleanup.removed.length, 'worktree')}`,
    cleanup.choices.length > 0 && `${count(cleanup.choices.length, 'worktree')} ${cleanup.choices.length === 1 ? 'needs' : 'need'} your choice`,
  ].filter(Boolean).join(' · ');
}

/** What's in a kept worktree that deleting it would touch. */
export function whatsLeft({ changes, unmerged }: Pick<WorktreeChoice, 'changes' | 'unmerged'>): string {
  return [
    changes > 0 && count(changes, 'uncommitted file'),
    unmerged > 0 && `${count(unmerged, 'commit')} not merged`,
  ].filter(Boolean).join(' and ');
}
