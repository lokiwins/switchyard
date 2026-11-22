import { useState, type ReactNode } from 'react';
import { post } from '../lib/api';
import { announceChange } from '../lib/changes';
import type { Capabilities, Transcript } from '../lib/types';
import { toast } from '../stores/toast';
import { LiveTime } from './LiveTime';
import { Menu, MenuItem, MenuLabel, menuMetaClass, MenuTitle } from './Menu';

/* "Open ▾" for a worktree: a new terminal tab with a plain shell, a new Claude session, or one of the folder's recent sessions resumed. */

export interface RecentSession { sessionId: string; updatedAt?: number; transcript?: Transcript }

const sessionLabel = (s: RecentSession) => s.transcript?.title ?? s.transcript?.agentName ?? s.transcript?.lastPrompt ?? s.sessionId.slice(0, 8);
/** Where a resumed session opens: a tab of the switchyard tmux session, or of the terminal app. */
export const resumeWhere = (caps: Capabilities): string => (caps.tmux ? 'a new tab of the switchyard tmux session' : `a new ${caps.terminal} tab`);
export const resumedMessage = (result: { window?: string; host?: string }): string =>
  `Resuming in ${result.window ? `tmux window ${result.window}` : result.host}`;

function Choice({ path, body, title, onDone, children }: { path: string; body: Record<string, string>; title?: string; onDone: () => void; children: ReactNode }) {
  const open = async () => {
    onDone();
    try {
      const result = await post<{ window?: string; host?: string }>('/api/terminal/open', { path, ...body });
      if (result.window) {
        toast(resumedMessage(result));
        void announceChange();
      }
    } catch (error) {
      toast((error as Error).message);
    }
  };
  return <MenuItem title={title} onClick={open}>{children}</MenuItem>;
}

export function OpenMenu({ path, sessions, caps }: { path: string; sessions: RecentSession[]; caps: Capabilities | undefined }) {
  const [open, setOpen] = useState(false);
  if (!caps?.terminal) return null;
  const done = () => setOpen(false);
  return (
    <Menu label="Open ▾" title={`Open a new ${caps.terminal} tab here`} open={open} onOpenChange={setOpen}>
      <Choice path={path} body={{ launch: 'shell' }} title={`cd into this folder in a new ${caps.terminal} tab`} onDone={done}>Shell</Choice>
      <Choice path={path} body={{ launch: 'claude' }} title="Start claude in this folder" onDone={done}>New Claude session</Choice>
      {sessions.length > 0 && <MenuLabel>Resume</MenuLabel>}
      {sessions.map((session) => (
        <Choice key={session.sessionId} path={path} body={{ sessionId: session.sessionId }} onDone={done}
          title={caps.tmux ? `Resume in ${resumeWhere(caps)}` : session.transcript?.lastPrompt ?? undefined}>
          <MenuTitle>{sessionLabel(session)}</MenuTitle>
          <LiveTime since={session.updatedAt} className={menuMetaClass} />
        </Choice>
      ))}
    </Menu>
  );
}
