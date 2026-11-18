/*
 * The words for a worktree's check (see src/checks.js), kept apart from the
 * DOM so they can be tested.
 */

/** A check's label, and a tone class: running, passed, failed, or stale (interrupted, or from before the worktree changed). */
export function checkLabel(check) {
  if (check.state === 'running') return { text: 'Checking…', tone: 'is-running' };
  if (check.state === 'interrupted') return { text: 'Check interrupted', tone: 'is-stale' };
  const base = check.state === 'passed'
    ? 'Check passed'
    : `Check failed${check.detail ? `: ${check.detail}` : check.exitCode !== null && check.exitCode !== undefined ? ` (exit ${check.exitCode})` : ''}`;
  if (check.outOfDate) return { text: `${base} · out of date`, tone: 'is-stale' };
  return { text: base, tone: check.state === 'passed' ? 'is-passed' : 'is-failed' };
}

/** Whether one of the task's worktrees' latest check failed and is still current: Mark done says so. */
export const hasFailedCheck = (task) => (task.work ?? []).some((w) => w.check?.state === 'failed' && !w.check.outOfDate);
