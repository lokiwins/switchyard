import type { ReactNode } from 'react';
import type { Approval, LiveSession } from '../../../lib/types';
import { TerminalButton } from '../../terminal/TerminalButton';
import { AnswerMenu, PlanButton } from './answer';
import { ApprovalButtons } from './approvals';
import { ReplyMenu } from './reply';
import { EndMenu, JumpButton, StopButton } from './session';

/**
 * What you can do with a running session wherever it's listed: answer it,
 * reply, stop it, see it live, get to it, or end it. `end` stands in for
 * End ▾ where ending comes with more (a task's Mark as ▾).
 */
export function SessionControls({ session, approvals, end }: { session: LiveSession; approvals: Approval[]; end?: ReactNode }) {
  return (
    <>
      <ApprovalButtons approvals={approvals} session={session} />
      <PlanButton session={session} approvals={approvals} />
      <AnswerMenu session={session} approvals={approvals} />
      <ReplyMenu session={session} />
      <StopButton session={session} />
      <TerminalButton session={session} />
      <JumpButton session={session} />
      {end ?? <EndMenu session={session} />}
    </>
  );
}
