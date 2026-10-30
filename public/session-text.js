/*
 * The words shown for a Claude session: a name you'd recognise, and one line
 * on what it's doing or last said (more useful at a glance than your prompt).
 */

/** A name you chose wins, then Claude's own title; the registry's "<folder>-<hex>" name is a last resort. */
export function sessionTitle(session) {
  const t = session.transcript ?? {};
  if (session.nameIsCustom && session.name) return session.name;
  return t.agentName ?? t.title ?? session.name ?? session.cwd?.split('/').pop() ?? session.sessionId.slice(0, 8);
}

/**
 * One line about a session, as { label, text, kind }, or null:
 * - needs you: a question or permission prompt is open (its text isn't in
 *   the transcript until you answer, so usually only that it's waiting)
 * - working: the tool call it's running, never the previous turn's reply
 * - interrupted: what it was doing when it was cut off
 * - otherwise: the last thing Claude said, falling back to your prompt
 */
export function sessionDetail(session) {
  const t = session.transcript ?? {};
  if (session.needsYou) return { kind: 'needs-you', label: 'Needs you', text: t.activity ?? 'Waiting for your answer or approval' };
  if (session.status === 'busy') {
    if (session.inBackground) return { kind: 'activity', label: null, text: 'Waiting for a background command' };
    return { kind: 'activity', label: null, text: t.activity ?? 'Thinking…' };
  }
  if (t.activity && (session.endState ?? t.endState) === 'interrupted') {
    return { kind: 'cut-off', label: 'Cut off while', text: t.activity };
  }
  if (t.lastReply) return { kind: 'reply', label: null, text: t.lastReply };
  if (t.lastPrompt) return { kind: 'prompt', label: 'You', text: t.lastPrompt };
  return null;
}

/** Everything worth matching a search against. */
export function sessionSearchText(session) {
  const t = session.transcript ?? {};
  return [t.agentName, t.title, session.name, t.lastReply, t.activity, t.lastPrompt];
}
