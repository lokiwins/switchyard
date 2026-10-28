// PR stages that mean the author has work to do.
const NEEDS_FIX_STAGES = new Set(['merge-conflict', 'checks-failing', 'changes-requested', 'needs-update']);

/**
 * Counts for the header badges on every page: what needs you on each one.
 * Either input may be null when it hasn't loaded yet.
 */
export function navCounts({ state, prs }) {
  const live = state?.liveSessions ?? [];
  const waiting = live.filter((s) => s.status === 'idle' && !s.parked).length;
  const interrupted = (state?.endedSessions ?? []).filter((s) => s.needsAttention).length;
  const needFixes = (prs?.authored ?? []).filter((pr) => NEEDS_FIX_STAGES.has(pr.stage)).length;
  const reviewRequests = prs?.reviewRequested?.length ?? 0;
  return {
    agents: {
      count: waiting + interrupted,
      working: live.filter((s) => s.status === 'busy').length,
      waiting,
      interrupted,
      tone: waiting + interrupted > 0 ? 'amber' : null,
    },
    prs: {
      count: needFixes + reviewRequests,
      needFixes,
      reviewRequests,
      tone: needFixes > 0 ? 'red' : reviewRequests > 0 ? 'purple' : null,
    },
  };
}
