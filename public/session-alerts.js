import { h, liveAlert, liveTime } from './dom.js';

/*
 * A running session's alerts (see src/stuck.js), on the Agents and Tasks
 * pages: stuck, shown by the page's clock once the session has been working
 * with nothing new for the time set in Settings › Agents; and context over
 * the size set there. Alerts only: nothing is stopped.
 */

const thousands = (tokens) => `${Math.round(tokens / 1000)}k`;

/** The alerts' sig, for drawing them again only when they change. */
export const alertsSig = (session) => [session.stuckAt ?? null, session.lastActivityAt ?? null, Boolean(session.contextHigh),
  session.contextHigh ? thousands(session.transcript?.contextTokens ?? 0) : null];

/** The session's alerts, or null when it can have none. */
export function sessionAlerts(session) {
  const stuck = session.stuckAt && liveAlert(session.stuckAt, {
    class: 'session-alert is-stuck',
    title: 'Working, with nothing new in its transcript for the time set in Settings › Agents. It may be stuck, or running something long.',
  }, 'Stuck? ', liveTime(session.lastActivityAt, 'last activity '));
  const full = session.contextHigh && h('span', {
    class: 'session-alert is-full',
    title: 'Its context is over the size set in Settings › Agents; /compact or a fresh session may help',
  }, `Context ${thousands(session.transcript?.contextTokens ?? 0)} tokens`);
  return stuck || full ? [stuck, full] : null;
}
