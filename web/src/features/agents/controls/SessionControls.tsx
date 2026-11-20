import type { Approval, LiveSession } from '../../../lib/types';
import { TerminalButton } from '../../terminal/TerminalButton';
import { AnswerMenu, PlanButton } from './answer';
import { ApprovalButtons } from './approvals';
import { ReplyMenu } from './reply';
import { EndMenu, JumpButton, StopButton } from './session';

/** What you can do with a running session wherever it's listed: answer it, reply, stop it, see it live, get to it, or end it. */
export function SessionControls({ session, approvals }: { session: LiveSession; approvals: Approval[] }) {
  return (
    <>
      <ApprovalButtons approvals={approvals} session={session} />
      <PlanButton session={session} approvals={approvals} />
      <AnswerMenu session={session} approvals={approvals} />
      <ReplyMenu session={session} />
      <StopButton session={session} />
      <TerminalButton session={session} />
      <JumpButton session={session} />
      <EndMenu session={session} />
    </>
  );
}
