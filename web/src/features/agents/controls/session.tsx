import { useState } from 'react';
import { ActionButton } from '../../../components/ActionButton';
import { Menu } from '../../../components/Menu';
import { post } from '../../../lib/api';
import { tmuxPlace } from '../../../lib/paths';
import { canShowTerminalSessions } from '../../../lib/shared';
import type { Capabilities, EndedSession, Host, HubTaskRef, LiveSession } from '../../../lib/types';
import { openPane, type MakeTaskFrom } from '../../../stores/panes';

/* A session's controls: stop it, end it, go to it, resume it, see its graph, make a task from it. */

const EDITOR_LABELS: Record<string, string> = { vscode: 'VS Code', 'vscode-insiders': 'VS Code Insiders', cursor: 'Cursor', windsurf: 'Windsurf' };
// Every Graph button opens the one graph tab: the first opens it, later ones show their session there.
const GRAPH_TAB = 'switchyard-graph';

const inTmux = (session: LiveSession) => session.host?.kind === 'tmux';

/** "Stop": presses Esc in a working tmux session, ending its current turn. */
export function StopButton({ session }: { session: LiveSession }) {
  if (!inTmux(session) || session.status !== 'busy') return null;
  return (
    <ActionButton label="Stop" title="Interrupt what Claude is doing (Esc), as in its terminal" className="btn btn-sm btn-secondary"
      perform={async () => {
        await post('/api/terminal/interrupt', { sessionId: session.sessionId });
        return 'Interrupted';
      }} />
  );
}

/** Where a session outside tmux runs, for End: "iTerm tab", "VS Code terminal", or just "terminal". */
function hostPlace(host: Host | null | undefined) {
  if (host?.kind === 'terminal') return `${host.label} tab`;
  if (host?.kind === 'editor') return `${host.label} terminal`;
  return 'terminal';
}

/**
 * End a session: Claude ends, and it can be resumed. In tmux its window closes
 * too; anywhere else Claude is hung up and its tab stays open at your shell.
 * Two clicks, since what's on screen goes with it.
 */
export function EndMenu({ session }: { session: LiveSession }) {
  const [open, setOpen] = useState(false);
  const tmux = inTmux(session) && session.host;
  const place = tmux ? `tmux window ${tmuxPlace(tmux)}` : hostPlace(session.host);
  return (
    <Menu label="End ▾" className="btn btn-sm btn-secondary" panelClass="end-panel" focusInput={false} open={open} onOpenChange={setOpen}
      title={tmux ? 'End this Claude session and close its tmux window' : `End this Claude session; its ${place} stays open`}>
      <p className="reply-hint">
        {tmux
          ? `Ends Claude and closes ${place}. You can resume the session from Recently ended.`
          : `Ends Claude, as closing its ${place} would, with anything it's running; the ${place} stays open at your shell. You can resume the session from Recently ended.`}
      </p>
      <ActionButton label="End session" title={tmux ? 'End Claude and close its tmux window' : 'End Claude'} className="btn btn-sm btn-danger"
        onDone={() => setOpen(false)}
        perform={async () => {
          await post('/api/terminal/end', { sessionId: session.sessionId });
          return 'Session ended. Resume it from Recently ended.';
        }} />
    </Menu>
  );
}

interface FocusResult { precision: string; window?: string; host?: string }

/** Get to a running session: its exact tab in a terminal, its window in an editor, or its app. */
export function JumpButton({ session }: { session: LiveSession }) {
  const host = session.host;
  if (!host) return null;
  const isTerminal = host.kind === 'terminal' || host.kind === 'tmux';
  const title = host.kind === 'tmux' ? `Switch to the tab showing tmux window ${tmuxPlace(host)}, or open it in a new tab`
    : isTerminal ? `Switch to this session's tab in ${host.label}`
      : host.kind === 'editor' ? `Bring the ${host.label} window for this folder forward`
        : `Bring ${host.label} to the front`;
  const jump = async () => {
    const result = await post<FocusResult>('/api/terminal/focus', { sessionId: session.sessionId });
    if (result.precision === 'resumed') {
      return result.window
        ? `The session had closed, so it's resuming in tmux window ${result.window}`
        : `The session had closed, so it's resuming in a new ${result.host} tab`;
    }
    if (result.precision === 'opened') return `Opened ${host.windowName} in a new ${result.host} tab`;
    if (result.precision === 'window') return `Opened ${result.host}. The session is in one of its terminals.`;
    return null;
  };
  return <ActionButton label={isTerminal ? 'Jump' : `Open ${host.label}`} title={title} perform={jump} />;
}

/** "Graph": the session's context graph on a page of its own. */
export function GraphLink({ sessionId }: { sessionId: string }) {
  return (
    // Same site, so no `noopener`: the graph tab keeps its opener, which is what lets its Close button close it.
    <a href={`/graph?session=${encodeURIComponent(sessionId)}`} target={GRAPH_TAB} className="btn btn-sm btn-secondary"
      title="See what this session brought into context: prompts, files, tools, memory, skills and subagents">
      Graph
    </a>
  );
}

/** Where a resumed session opens: a tab of the switchyard tmux session, or of the terminal app. */
const resumeWhere = (caps: Capabilities) => (caps.tmux ? 'a new tab of the switchyard tmux session' : `a new ${caps.terminal} tab`);

/** Resume an ended session: in tmux when it's installed, so it can be watched and steered from here. */
export function ResumeButton({ session, caps }: { session: EndedSession; caps: Capabilities }) {
  return (
    <ActionButton label="Resume" title={`Resume this session in ${resumeWhere(caps)}`}
      perform={async () => {
        const result = await post<{ window?: string; host?: string }>('/api/terminal/resume', { sessionId: session.sessionId });
        return `Resuming in ${result.window ? `tmux window ${result.window}` : result.host}`;
      }} />
  );
}

export const canResume = (caps: Capabilities): boolean => Boolean(caps.terminal || caps.tmux);

/** Open a folder in the configured editor: a plain link, handled by the editor's URL scheme. */
export function EditorLink({ path, caps }: { path: string; caps: Capabilities }) {
  const scheme = caps.editorScheme;
  if (!scheme) return null;
  const url = `${scheme}://file${path.split('/').map(encodeURIComponent).join('/')}`;
  return <a className="btn btn-action" href={url} title={`Open in ${EDITOR_LABELS[scheme] ?? scheme}`}>Code</a>;
}

/** "Task" to the task this work is on, or "Make task" to make one from it, filled in from its session. */
export function TaskFromWork({ from, hubTask }: { from: MakeTaskFrom; hubTask?: HubTaskRef | null }) {
  if (hubTask) {
    return <a href={`/tasks#${encodeURIComponent(hubTask.id)}`} className="btn btn-sm btn-secondary" title={`Task: ${hubTask.title}`}>Task</a>;
  }
  return (
    <button type="button" className="btn btn-sm btn-secondary" title="Make a task on the Tasks page from this, filled in from its session"
      onClick={() => openPane({ kind: 'make-task', from })}>
      Make task
    </button>
  );
}

/** One button that shows every task's tmux window in iTerm, or brings them forward. */
export function ShowSessionsButton({ caps }: { caps: Capabilities }) {
  if (!canShowTerminalSessions(caps)) return null;
  return (
    <ActionButton label="Show Terminal Sessions" className="btn" title="Show every task's tmux window in iTerm, through its tmux integration"
      perform={async () => {
        const result = await post<{ precision: string }>('/api/terminal/show-sessions', {});
        return result.precision === 'opened' ? 'Opening your terminal sessions in iTerm' : null;
      }} />
  );
}

/** Answer Claude's trust question for a starting task, as you would in its tmux window. */
export function TrustButtons({ path }: { path: string }) {
  const answer = (trust: boolean) => async () => {
    await post('/api/tasks/trust', { path, trust });
    return trust ? 'Trusted the folder; Claude is starting' : 'Not trusted; Claude will exit';
  };
  return (
    <>
      <ActionButton label="Trust folder" title={`Let Claude read, edit and run files in ${path}`} className="btn btn-sm" perform={answer(true)} />
      <ActionButton label="Don't trust" title="Claude exits; the worktree is kept" className="btn btn-sm btn-secondary" perform={answer(false)} />
    </>
  );
}
