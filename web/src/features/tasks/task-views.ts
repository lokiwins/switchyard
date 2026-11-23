/*
 * Which session a worktree's Jump and Terminal go to on the Tasks page.
 */

import type { LiveSession } from '../../lib/types';

/** What choosing a session to jump to reads. */
type JumpFields = Pick<LiveSession, 'needsYou' | 'parked' | 'status' | 'statusUpdatedAt'>;

// Questions waiting on you first, then working, then waiting; parked ones last.
const jumpRank = (s: JumpFields) => (s.needsYou ? 3 : s.parked ? 0 : s.status === 'busy' ? 2 : 1);

/** The session a worktree's Jump and Terminal go to: the one that most needs you, then the latest; null when none runs. */
export function sessionToJump<S extends JumpFields>(link: { live: S[] }): S | null {
  return [...link.live].sort((a, b) => jumpRank(b) - jumpRank(a) || (b.statusUpdatedAt ?? 0) - (a.statusUpdatedAt ?? 0))[0] ?? null;
}
