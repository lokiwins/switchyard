/*
 * Which session a worktree's Jump and Terminal go to on the Tasks page. No DOM
 * here, so it's tested in node.
 */

// Questions waiting on you first, then working, then waiting; parked ones last.
const jumpRank = (s) => (s.needsYou ? 3 : s.parked ? 0 : s.status === 'busy' ? 2 : 1);

/** The session a worktree's Jump and Terminal go to: the one that most needs you, then the latest; null when none runs. */
export function sessionToJump(link) {
  return [...link.live].sort((a, b) => jumpRank(b) - jumpRank(a) || (b.statusUpdatedAt ?? 0) - (a.statusUpdatedAt ?? 0))[0] ?? null;
}
