import { useQuery } from '@tanstack/react-query';
import { Dialog, PaneHeader } from '../../components/Dialog';
import { Markdown } from '../../components/Markdown';
import { sessionTitle } from '../../lib/shared';
import type { AgentsData } from '../../lib/types';
import { usePaneStore } from '../../stores/panes';
import { AGENTS_KEY } from '../agents/api';
import { AnswerControls, canAnswer, type AnswerStyle } from '../agents/controls/answer';
import { approvalsFor } from '../agents/controls/approvals';

/* A plan approval's plan, rendered, with the dialog's options to answer it where the page can press keys. */

const PANE_STYLE: AnswerStyle = { button: 'pane-btn', form: 'plan-text-answer', input: 'pane-input', send: 'pane-btn' };

export function PlanPane({ sessionId }: { sessionId: string }) {
  const close = usePaneStore((s) => s.close);
  // The session as the page knows it now: ticking an option shows here as the screen changes.
  const { data } = useQuery<AgentsData>({ queryKey: AGENTS_KEY, enabled: false });
  const session = data?.liveSessions.find((s) => s.sessionId === sessionId);
  const prompt = session?.screenPrompt;
  if (!session || !prompt?.plan) {
    return (
      <Dialog label="Plan" className="review-pane plan-pane" onClose={close}>
        <PaneHeader heading="Plan" dot="is-waiting">
          <button type="button" className="pane-btn" onClick={close}>Close</button>
        </PaneHeader>
        <div className="review-body"><p className="pane-note">This plan isn&apos;t waiting any more.</p></div>
      </Dialog>
    );
  }
  const answerable = data ? canAnswer(session, approvalsFor(data, session)) : false;
  return (
    <Dialog label={`Plan: ${sessionTitle(session)}`} className="review-pane plan-pane" onClose={close}>
      <PaneHeader heading={`Plan · ${sessionTitle(session)}`} sub={prompt.question} dot="is-waiting">
        <span className="pane-pill">{prompt.planFile}</span>
        <button type="button" className="pane-btn" title="Close (the plan keeps waiting)" onClick={close}>Close</button>
      </PaneHeader>
      <div className="review-body"><Markdown text={prompt.plan} /></div>
      <footer className="pane-footer plan-answers">
        {answerable
          ? <AnswerControls session={session} style={PANE_STYLE} onDone={close} />
          : <p className="pane-note">{`Answer it in its ${session.host?.label} tab: switchyard can't press keys there.`}</p>}
      </footer>
    </Dialog>
  );
}
