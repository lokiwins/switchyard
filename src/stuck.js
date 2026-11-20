/*
 * Alerts on a running session, from Settings › Agents: stuck, when it has
 * been working with nothing new in its transcript for the set time; and too
 * full, when its context is over the set size. Alerts only: nothing is
 * stopped. Being stuck depends on the time, so rather than looking again
 * and again, the session carries when it would count as stuck (`stuckAt`),
 * and the page's own clock shows the alert from then on.
 */

/**
 * A live session's alerts: `stuckAt` (when it counts as stuck, or null when it can't be: not working in
 * the foreground, or the alert is off), its `lastActivityAt`, and `contextHigh`.
 * @param {{ stuckAfterMs: number, contextAlertTokens: number }} settings Settings › Agents (0 turns each off).
 */
export function sessionAlerts(session, { stuckAfterMs, contextAlertTokens }) {
  const lastActivityAt = Math.max(session.transcript?.lastActivityAt ?? 0, session.statusUpdatedAt ?? 0) || null;
  const working = session.status === 'busy' && !session.needsYou && !session.inBackground;
  const stuckAt = working && stuckAfterMs > 0 && lastActivityAt ? lastActivityAt + stuckAfterMs : null;
  const tokens = session.transcript?.contextTokens ?? 0;
  return { stuckAt, lastActivityAt, contextHigh: contextAlertTokens > 0 && tokens >= contextAlertTokens };
}
