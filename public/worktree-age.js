/*
 * A worktree with activity in the last three days counts as active. That is
 * judged here, on the page's clock, so the page draws its list again when one
 * ages out even though the data from the server hasn't changed.
 */

export const RECENT_MS = 3 * 24 * 60 * 60 * 1000;

/** Whether `w` had activity in the last three days. */
export const isRecent = (w, now = Date.now()) => Boolean(w.lastActivityAt) && now - w.lastActivityAt < RECENT_MS;

/** When the next worktree that counts as recent stops counting; Infinity when none will. */
export function nextAgeOut(state, now = Date.now()) {
  return state.repos
    .flatMap((repo) => repo.worktrees)
    .filter((w) => isRecent(w, now))
    .reduce((soonest, w) => Math.min(soonest, w.lastActivityAt + RECENT_MS), Infinity);
}
