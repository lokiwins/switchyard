/*
 * The words for a worktree's checks (see src/checks.js), kept apart from the
 * DOM so they can be tested.
 */

// A repo given just a command has one check by this name (see settings.js); it reads as "Check".
const SINGLE_CHECK = 'check';

/** A check's label, and a tone class: running or waiting, passed, failed, or stale (interrupted, or from before the worktree changed). */
export function checkLabel(check) {
  const name = check.name === SINGLE_CHECK ? 'Check' : check.name;
  if (check.state === 'running') return { text: `${name}: checking…`, tone: 'is-running' };
  if (check.state === 'queued') return { text: `${name}: waiting`, tone: 'is-running' };
  if (check.state === 'interrupted') return { text: `${name} interrupted`, tone: 'is-stale' };
  const exit = check.exitCode !== null && check.exitCode !== undefined ? ` (exit ${check.exitCode})` : '';
  const base = check.state === 'passed' ? `${name} passed` : `${name} failed${check.detail ? `: ${check.detail}` : exit}`;
  if (check.outOfDate) return { text: `${base} · out of date`, tone: 'is-stale' };
  return { text: base, tone: check.state === 'passed' ? 'is-passed' : 'is-failed' };
}

/** Whether a check failed and still stands (not out of date). */
export const failedNow = (check) => check?.state === 'failed' && !check.outOfDate;

/** Whether any of the task's worktrees has a current failed check: Mark done says so. */
export const hasFailedCheck = (task) => (task.work ?? []).some((w) => (w.checks ?? []).some(failedNow));

/** Whether any of these checks is running or waiting to, so the page looks again soon. */
export const anyRunning = (checks = []) => checks.some((c) => c.state === 'running' || c.state === 'queued');
