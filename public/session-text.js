/*
 * The words shown for a Claude session: a name you'd recognise, and one line
 * on what it's doing or last said (more useful at a glance than your prompt).
 */

// A prompt standing in for a title is cut to about a line, at a word.
const PROMPT_TITLE_CHARS = 80;
// A session with no name, title or prompt yet. The row already says where it runs.
const UNTITLED = 'New session';

function promptTitle(prompt) {
  const flat = prompt?.replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  if (flat.length <= PROMPT_TITLE_CHARS) return flat;
  const cut = flat.slice(0, PROMPT_TITLE_CHARS - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > PROMPT_TITLE_CHARS / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const claudeTitle = (t) => t.agentName ?? t.title ?? null;

/**
 * A name you chose wins, then Claude's own name or title. Until Claude has
 * titled it (after your first prompt), your prompt stands in. Claude Code's
 * generated "<folder>-<hex>" name says nothing the row doesn't, so it's never
 * shown.
 */
export function sessionTitle(session) {
  const t = session.transcript ?? {};
  if (session.nameIsCustom && session.name) return session.name;
  return claudeTitle(t) ?? promptTitle(t.lastPrompt) ?? UNTITLED;
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
  // Not when the prompt is already the title.
  const promptIsTitle = !(session.nameIsCustom && session.name) && !claudeTitle(t);
  if (t.lastPrompt && !promptIsTitle) return { kind: 'prompt', label: 'You', text: t.lastPrompt };
  return null;
}

/** Everything worth matching a search against. */
export function sessionSearchText(session) {
  const t = session.transcript ?? {};
  return [t.agentName, t.title, session.name, t.lastReply, t.activity, t.lastPrompt];
}
