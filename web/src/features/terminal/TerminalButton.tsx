import { useEffect } from 'react';
import { tmuxPlace } from '../../lib/paths';
import type { LiveSession } from '../../lib/types';
import { openPane } from '../../stores/panes';
import { prewarmTerminal } from './connection';

// How long the browser may put off the idle warm-up, and the wait where it has no idle callback (Safari).
const IDLE_TIMEOUT_MS = 3000;
const NO_IDLE_CALLBACK_MS = 1000;

// When the page first shows a Terminal button, the terminal is got ready while the page is idle.
let idleWarmup = false;
function warmUpWhenIdle(): void {
  if (idleWarmup) return;
  idleWarmup = true;
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(prewarmTerminal, { timeout: IDLE_TIMEOUT_MS });
  else setTimeout(prewarmTerminal, NO_IDLE_CALLBACK_MS);
}

/** Open the session's tmux pane here, live. Pointing at the button gets the terminal ready. */
export function TerminalButton({ session }: { session: LiveSession }) {
  const host = session.host?.kind === 'tmux' ? session.host : null;
  const isTmux = host !== null;
  useEffect(() => {
    if (isTmux) warmUpWhenIdle();
  }, [isTmux]);
  if (!host) return null;
  return (
    <button
      type="button"
      className="btn btn-action"
      title={`Open tmux window ${tmuxPlace(host)} here, live, and type into it`}
      onPointerEnter={prewarmTerminal}
      onFocus={prewarmTerminal}
      onClick={() => openPane({ kind: 'terminal', session })}
    >
      Terminal
    </button>
  );
}
