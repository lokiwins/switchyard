import { useEffect, useRef, useState } from 'react';
import { Dialog, PaneHeader } from '../../components/Dialog';
import { paneButtonClass, panePillClass, paneSelectClass } from '../../components/pane-classes';
import { ResizeHandle } from '../../components/ResizeHandle';
import { appearanceApi, useAppearance } from '../../lib/appearance';
import { cx } from '../../lib/cx';
import { tmuxPlace } from '../../lib/paths';
import { sessionTitle } from '../../lib/session-text';
import { terminalPicker } from '../../../../shared/terminal-themes.ts';
import type { LiveSession } from '../../lib/types';
import { usePaneStore } from '../../stores/panes';
import { toast } from '../../stores/toast';
import { startLiveTerminal, type LiveTerminal } from './connection';

/* A session's tmux pane, live in a glass pane: see connection.ts for how it's streamed and typed into. */

const TERMINAL_WIDTH_PREF = 'switchyard.terminalWidth';

const closePane = () => usePaneStore.getState().close();

/**
 * A picker for the terminal colours, for the terminal pane's header: the pane
 * covers the page, top bar and all, so the ◐ menu can't be reached while it's
 * open. It changes this browser's choice, as the ◐ menu does, and keeps up
 * with changes made there or in another tab. `onPicked` gives the keyboard
 * back to the terminal.
 */
function TerminalColours({ onPicked }: { onPicked: () => void }) {
  const appearance = useAppearance();
  if (!appearance) return null;
  const { options, selected } = terminalPicker(appearance);
  return (
    <select
      className={cx(paneSelectClass, 'flex-none max-w-[15em]')}
      title="Terminal colours, for this browser"
      aria-label="Terminal colours"
      value={selected}
      onChange={(event) => {
        appearanceApi()?.choose({ terminal: event.target.value || null });
        onPicked();
      }}
    >
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
}

function LivePane({ session }: { session: LiveSession }) {
  const slot = useRef<HTMLDivElement>(null);
  const live = useRef<LiveTerminal | null>(null);
  const [status, setStatus] = useState('Connecting…');
  const [isLive, setLive] = useState(false);
  const [canReconnect, setCanReconnect] = useState(false);
  const { sessionId } = session;
  const title = sessionTitle(session);

  useEffect(() => {
    const element = slot.current;
    if (!element) return undefined;
    const terminal = startLiveTerminal(sessionId, element, {
      setStatus,
      setLive,
      setCanReconnect,
      failed: (message) => {
        toast(message);
        closePane();
      },
    });
    live.current = terminal;
    return () => {
      terminal.close();
      live.current = null;
    };
  }, [sessionId]);

  return (
    // Esc belongs to the terminal (it stops Claude), so it doesn't close the dialog.
    <Dialog label={`Live terminal: ${title}`} onClose={closePane} keepOnEscape>
      <PaneHeader heading={title} sub={tmuxPlace(session.host ?? {})} dot={isLive ? 'live' : undefined}>
        <span className={panePillClass}>{status}</span>
        <TerminalColours onPicked={() => live.current?.focus()} />
        {canReconnect && (
          <button type="button" className={paneButtonClass()} onClick={() => live.current?.reconnect()}>Reconnect</button>
        )}
        <button type="button" className={paneButtonClass()} title="Close the terminal (the session keeps running)" onClick={closePane}>
          Close
        </button>
      </PaneHeader>
      {/* The terminal's screen is moved in here, out of its parking place; `contents` keeps it a flex item of the pane. */}
      <div ref={slot} className="contents" />
      {/* Drag its left edge to make it wider or narrower; the width is remembered. */}
      <ResizeHandle prefKey={TERMINAL_WIDTH_PREF} label="Terminal width" />
    </Dialog>
  );
}

/** The live terminal pane; a different session is a new connection, starting from Connecting…. */
export function TerminalPane({ session }: { session: LiveSession }) {
  return <LivePane key={session.sessionId} session={session} />;
}
