import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Menu } from '../../../components/Menu';
import { post } from '../../../lib/api';
import { announceChange } from '../../../lib/changes';
import { tmuxPlace } from '../../../lib/paths';
import type { LiveSession } from '../../../lib/types';
import { useDraft } from '../../../stores/drafts';
import { toast } from '../../../stores/toast';
import { Button } from '../../../components/Button';

/* "Reply ▾": a one-line message typed into the session's tab, as if you'd typed it there. */

// Apps whose tabs the server can type into (see canTypeInto in src/terminal.js).
const TYPEABLE_APPS = new Set(['iTerm']);
const MAX_REPLY_CHARS = 2000;

const inTmux = (session: LiveSession) => session.host?.kind === 'tmux';

export const canReply = (session: LiveSession): boolean => !session.needsYou
  && (inTmux(session) || (session.host?.kind === 'terminal' && TYPEABLE_APPS.has(session.host.app ?? '')));

/** Where a reply is typed, for hints. */
const replyTarget = (session: LiveSession) => (session.host && inTmux(session) ? `tmux window ${tmuxPlace(session.host)}` : `${session.host?.label} tab`);

export function ReplyMenu({ session }: { session: LiveSession }) {
  const [open, setOpen] = useState(false);
  // What you've typed stays while the page updates, and while the menu is closed, until it's sent.
  const [text, setText] = useDraft(`reply:${session.sessionId}`);
  const send = useMutation({
    mutationFn: () => post<{ queued: boolean }>('/api/terminal/reply', { sessionId: session.sessionId, text }),
    onSuccess: ({ queued }) => {
      setText('');
      setOpen(false);
      toast(queued ? 'Sent. Claude will read it after its current step.' : 'Sent');
      void announceChange();
    },
    onError: (error) => toast(error.message),
  });
  if (!canReply(session)) return null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    send.mutate();
  };
  return (
    <Menu label="Reply ▾" title={`Type a message into this session's ${replyTarget(session)}`} panelClass="reply-panel" open={open} onOpenChange={setOpen}>
      <form className="reply-form" onSubmit={submit}>
        <input name="text" type="text" maxLength={MAX_REPLY_CHARS} required autoComplete="off" aria-label="Message"
          placeholder={session.status === 'busy' ? 'Queue a message for when it finishes this step' : 'Message Claude'}
          value={text} onChange={(event) => setText(event.target.value)} />
        <Button type="submit" size="sm" disabled={send.isPending}>Send</Button>
      </form>
      <p className="reply-hint">{`Typed into its ${replyTarget(session)}, after anything already in the input box there.`}</p>
    </Menu>
  );
}
