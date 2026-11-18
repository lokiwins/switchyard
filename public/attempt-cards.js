import { formatTokens } from './graph-model.js';

/*
 * The words on a task's attempt cards (see attempt-pane.js and
 * src/attempt-compare.js), kept apart from the DOM so they can be tested.
 */

const STATE_LABELS = { working: 'Working', 'needs-you': 'Needs you', idle: 'Idle', 'not-running': 'Not running' };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Its session's state as a word; '' for one not known. */
export const stateLabel = (state) => STATE_LABELS[state] ?? '';

/** "3 files · +10 −2 · 1 new": what it changed since it left the main branch. */
export function changeSummary(changes) {
  if (!changes) return 'Changes unknown';
  if (changes.files.length === 0) return 'No changes yet';
  const fresh = changes.files.filter((f) => f.untracked).length;
  return [plural(changes.files.length, 'file'), `+${changes.added} −${changes.removed}`, fresh > 0 && `${fresh} new`].filter(Boolean).join(' · ');
}

/** "2 commits", or null when git couldn't say. */
export function commitSummary(commits) {
  if (commits === null || commits === undefined) return null;
  return commits === 0 ? 'No commits yet' : plural(commits, 'commit');
}

/** "31k tokens in context", as its session last reported, or null. */
export const contextSummary = (tokens) => (typeof tokens === 'number' ? `${formatTokens(tokens)} tokens in context` : null);

/** One changed file: its lines added and removed, or binary, or new. */
export function fileLine(file) {
  if (file.untracked) return `new  ${file.path}`;
  if (file.added === null) return `binary  ${file.path}`;
  return `+${file.added} −${file.removed}  ${file.path}`;
}

/** Whether a task's attempts can be compared: two or more, none picked yet. */
export const canCompare = (task) => (task.attempts?.branches?.length ?? 0) > 1 && !task.attempts.picked;
