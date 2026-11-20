import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Menu } from '../../../components/Menu';
import { post } from '../../../lib/api';
import { announceChange } from '../../../lib/changes';
import type { EndedSession } from '../../../lib/types';
import { toast } from '../../../stores/toast';
import { Button } from '../../../components/Button';

/*
 * Deleting ended sessions. "Remove from list" only takes a session off
 * switchyard's lists: its transcript stays, so `claude --resume` still finds
 * it. "Delete transcript" moves the transcript to the Trash. Both happen at
 * once, with Undo in the toast instead of an "Are you sure?".
 */

const sessionsLabel = (count: number) => (count === 1 ? 'a session' : `${count} sessions`);

interface Undoable { perform: () => Promise<unknown>; message: string; undo: () => Promise<unknown>; undone: string }

/** Run a server change, then offer to take it back. */
async function withUndo({ perform, message, undo, undone }: Undoable): Promise<void> {
  await perform();
  void announceChange();
  toast(message, {
    label: 'Undo',
    run: () => {
      undo().then(() => {
        toast(undone);
        void announceChange();
      }, (error: Error) => toast(error.message));
    },
  });
}

const hideSessions = (sessionIds: string[]) => withUndo({
  perform: () => post('/api/agents/hide', { sessionIds }),
  message: `Removed ${sessionsLabel(sessionIds.length)} from the list`,
  undo: () => post('/api/agents/unhide', { sessionIds }),
  undone: 'Back on the list',
});

const trashTranscript = (sessionId: string) => withUndo({
  perform: () => post('/api/agents/trash', { sessionId }),
  message: 'Moved the transcript to the Trash',
  undo: () => post('/api/agents/restore', { sessionId }),
  undone: 'Transcript restored',
});

function DeleteChoice({ title, hint, perform, onDone }: { title: string; hint: string; perform: () => Promise<void>; onDone: () => void }) {
  const action = useMutation({ mutationFn: perform, onSuccess: onDone, onError: (error) => toast(error.message) });
  return (
    <button type="button" className="menu-item delete-choice" disabled={action.isPending} onClick={() => action.mutate()}>
      <span className="menu-title">{title}</span>
      <span className="delete-hint">{hint}</span>
    </button>
  );
}

/** "Delete ▾" on an ended session: off the list, or its transcript to the Trash. */
export function DeleteMenu({ session }: { session: EndedSession }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <Menu label="Delete ▾" title="Delete this ended session" look={{ variant: 'secondary', size: 'sm' }} panelClass="delete-panel" focusInput={false}
      open={open} onOpenChange={setOpen}>
      <DeleteChoice title="Remove from list" hint="The transcript stays, so claude --resume still finds it." onDone={close}
        perform={() => hideSessions([session.sessionId])} />
      <DeleteChoice title="Delete transcript" hint="Moves it to the Trash. It can no longer be resumed." onDone={close}
        perform={() => trashTranscript(session.sessionId)} />
    </Menu>
  );
}

/** Takes every listed ended session off the list (transcripts stay), with Undo. */
export function DeleteAllButton({ sessions, label }: { sessions: EndedSession[]; label: string }) {
  const action = useMutation({ mutationFn: () => hideSessions(sessions.map((s) => s.sessionId)), onError: (error) => toast(error.message) });
  return (
    <Button type="button" variant="secondary" size="sm" disabled={action.isPending} onClick={() => action.mutate()}
      title={`Remove ${sessionsLabel(sessions.length)} from switchyard's lists. Their transcripts stay, so you can still resume them.`}>
      {label}
    </Button>
  );
}
