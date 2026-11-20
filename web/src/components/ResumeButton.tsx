import { post } from '../lib/api';
import type { Capabilities } from '../lib/types';
import { ActionButton } from './ActionButton';
import { CopyButton } from './CopyButton';
import { resumedMessage, resumeWhere } from './OpenMenu';

/** A session that has ended, as far as resuming it goes. */
export interface Resumable { sessionId: string; resumeCommand: string }

/** Resume an ended session: in tmux when it's installed, so it can be watched and steered from here. */
function ResumeAction({ session, caps }: { session: Resumable; caps: Capabilities }) {
  return (
    <ActionButton label="Resume" title={`Resume this session in ${resumeWhere(caps)}`}
      perform={async () => {
        return resumedMessage(await post<{ window?: string; host?: string }>('/api/terminal/resume', { sessionId: session.sessionId }));
      }} />
  );
}

export const canResume = (caps: Capabilities): boolean => Boolean(caps.terminal || caps.tmux);

/** Resume where switchyard can open a terminal; otherwise copy the command to resume it yourself. */
export function ResumeButton({ session, caps }: { session: Resumable; caps: Capabilities }) {
  return canResume(caps) ? <ResumeAction session={session} caps={caps} /> : <CopyButton label="resume" text={session.resumeCommand} />;
}
