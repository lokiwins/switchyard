import { ActionButton } from '../../../components/ActionButton';
import { post } from '../../../lib/api';
import type { AgentsData, Approval, Detail, LiveSession } from '../../../lib/types';
import { openPane } from '../../../stores/panes';

/* Permission prompts sent here by the approvals hook: Review it in full, Allow or Deny; the terminal's own prompt stays usable too. */

/** The prompts waiting on this session, oldest first. */
export const approvalsFor = (data: AgentsData, session: LiveSession): Approval[] =>
  (data.approvals ?? []).filter((a) => a.sessionId === session.sessionId);

/** The row's detail line for a waiting prompt: what Claude wants to do. */
export function approvalDetail([first, ...rest]: Approval[]): Detail | null {
  if (!first) return null;
  const more = rest.length > 0 ? ` (+${rest.length} more)` : '';
  return { kind: 'needs-you', label: `Allow ${first.toolName}${more}?`, text: first.summary };
}

export const decide = async (approval: Approval, behavior: 'allow' | 'deny', message?: string): Promise<string> => {
  await post('/api/approvals/decide', { id: approval.id, behavior, message });
  return behavior === 'allow' ? `Allowed ${approval.toolName}` : `Denied ${approval.toolName}`;
};

export function ApprovalButtons({ approvals, session }: { approvals: Approval[]; session: LiveSession }) {
  const [approval] = approvals;
  if (!approval) return null;
  const what = `${approval.toolName}: ${approval.summary}`;
  return (
    <>
      <button type="button" className="btn btn-sm btn-secondary" title={`See it in full before answering: ${what}`}
        onClick={() => openPane({ kind: 'review', approval, session })}>
        Review
      </button>
      <ActionButton label="Allow" title={`Allow once: ${what}`} className="btn btn-sm" perform={() => decide(approval, 'allow')} />
      <ActionButton label="Deny" title={`Deny: ${what}`} className="btn btn-sm btn-secondary" perform={() => decide(approval, 'deny')} />
    </>
  );
}
