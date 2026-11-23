/*
 * The words shown for a Claude session: a name you'd recognise, and one line
 * on what it's doing or last said (more useful at a glance than your prompt).
 */

import type { Capabilities, Detail, Host, LiveSession, ScreenPrompt, Transcript } from './types';

/** What the session words read: a live session, an ended one, or a worktree's last one all have these. */
export type SessionLike = Partial<Pick<LiveSession, 'name' | 'nameIsCustom' | 'needsYou' | 'screenPrompt' | 'status' | 'inBackground'>>
  & { transcript?: Transcript; endState?: string | null };

/** Where a session runs, as far as these words read it. */
type HostLike = Pick<Host, 'kind'> & Partial<Pick<Host, 'label' | 'app' | 'tty'>>;
type MaybeHost = HostLike | null | undefined;

// A prompt standing in for a title is cut to about a line, at a word.
const PROMPT_TITLE_CHARS = 80;
// A session with no name, title or prompt yet. The row already says where it runs.
const UNTITLED = 'New session';

function promptTitle(prompt: string | null | undefined): string | null {
  const flat = prompt?.replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  if (flat.length <= PROMPT_TITLE_CHARS) return flat;
  const cut = flat.slice(0, PROMPT_TITLE_CHARS - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > PROMPT_TITLE_CHARS / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const claudeTitle = (t: Transcript) => t.agentName ?? t.title ?? null;

/** Whether switchyard can press keys where a session runs: a tmux pane, or an iTerm tab (see canAnswerIn in src/terminal.js). */
export const canPressKeys = (host: MaybeHost): boolean => host?.kind === 'tmux' || (host?.kind === 'terminal' && host.app === 'iTerm');

/** Whether the page can show every task's tmux window in iTerm, through iTerm's tmux integration. */
export const canShowTerminalSessions = (caps: Capabilities | undefined): boolean => caps?.terminal === 'iTerm' && caps?.tmux === true;

/** Whether a session has a tab you can go back to: a tmux window, a terminal app's tab, or an editor's terminal. */
const hasOpenTab = (host: MaybeHost): boolean => host?.kind === 'tmux' || host?.kind === 'editor' || (host?.kind === 'terminal' && Boolean(host.tty));

/** A parked session folds behind "Show parked" only when it has no open tab; one you can still go back to stays listed. */
export const foldsWhenParked = (session: { parked?: boolean; host?: MaybeHost }): boolean => Boolean(session.parked) && !hasOpenTab(session.host);

/**
 * For a session waiting on you where the page can't answer (Terminal, an
 * editor's terminal, another app): where to answer it, and how to be able to
 * answer from here next time. Null where the page can answer, including when
 * the approvals hook has already given it Allow and Deny.
 */
export function answerElsewhere(session: { needsYou?: boolean; host?: MaybeHost }, approvals: readonly unknown[]): string | null {
  if (!session.needsYou || approvals.length > 0 || canPressKeys(session.host)) return null;
  return `Answer it in ${session.host?.label ?? 'its terminal'}. To answer from here, run Claude in tmux or start it with New task.`;
}

/**
 * A name you chose wins, then Claude's own name or title. Until Claude has
 * titled it (after your first prompt), your prompt stands in. Claude Code's
 * generated "<folder>-<hex>" name says nothing the row doesn't, so it's never
 * shown.
 */
export function sessionTitle(session: SessionLike): string {
  const t = session.transcript ?? {};
  if (session.nameIsCustom && session.name) return session.name;
  return claudeTitle(t) ?? promptTitle(t.lastPrompt) ?? UNTITLED;
}

/** A dialog read off a waiting session's screen: the question and its options on one line, the dialog as drawn when opened. */
function screenPromptDetail({ question, options, text }: ScreenPrompt): Detail {
  const choices = options.map((o) => `${o.number}. ${o.label}`).join(' · ');
  return { kind: 'needs-you', label: 'Asks', text: [question, choices].filter(Boolean).join(' '), full: text };
}

/**
 * One line about a session, as { label, text, kind }, or null:
 * - needs you: a question or permission prompt is open (its text isn't in
 *   the transcript until you answer, so usually only that it's waiting)
 * - working: the tool call it's running, never the previous turn's reply
 * - interrupted: what it was doing when it was cut off
 * - otherwise: the last thing Claude said, falling back to your prompt
 */
export function sessionDetail(session: SessionLike): Detail | null {
  const t = session.transcript ?? {};
  if (session.needsYou && session.screenPrompt) return screenPromptDetail(session.screenPrompt);
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
export function sessionSearchText(session: SessionLike): (string | null | undefined)[] {
  const t = session.transcript ?? {};
  return [t.agentName, t.title, session.name, t.lastReply, t.activity, t.lastPrompt, session.screenPrompt?.question];
}

const STATUS_LABELS: Record<string, string> = { busy: 'Working', idle: 'Waiting' };

/** A live session's state in a word or two: Needs you, Working, Waiting or Parked. */
export function sessionLabel(session: Pick<LiveSession, 'needsYou' | 'parked' | 'status'>): string {
  if (session.needsYou) return 'Needs you';
  return session.parked ? 'Parked' : STATUS_LABELS[session.status] ?? session.status;
}

/** The status dot for a live session. */
export function sessionDot(session: Pick<LiveSession, 'parked' | 'status'>): string {
  return session.parked ? 'parked' : session.status;
}
