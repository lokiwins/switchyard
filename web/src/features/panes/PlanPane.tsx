import { useQuery } from '@tanstack/react-query';
import { Dialog, PaneHeader } from '../../components/Dialog';
import { paneBodyClass, paneButtonClass, paneFooterClass, paneInputClass, paneNoteClass, panePillClass } from '../../components/pane-classes';
import { cx } from '../../lib/cx';
import { Markdown } from '../../components/Markdown';
import { sessionTitle } from '../../lib/session-text';
import type { AgentsData } from '../../lib/types';
import { usePaneStore } from '../../stores/panes';
import { AGENTS_KEY } from '../agents/api';
import { AnswerControls, canAnswer, type AnswerStyle } from '../agents/controls/answer';
import { approvalsFor } from '../agents/controls/approvals';

/* A plan approval's plan, rendered, with the dialog's options to answer it where the page can press keys. */

const PANE_STYLE: AnswerStyle = { button: paneButtonClass(), form: 'flex flex-[1_1_100%] gap-2.5', input: paneInputClass(), send: paneButtonClass() };

export function PlanPane({ sessionId }: { sessionId: string }) {
  const close = usePaneStore((s) => s.close);
  // The session as the page knows it now: ticking an option shows here as the screen changes.
  const { data } = useQuery<AgentsData>({ queryKey: AGENTS_KEY, enabled: false });
  const session = data?.liveSessions.find((s) => s.sessionId === sessionId);
  const prompt = session?.screenPrompt;
  if (!session || !prompt?.plan) {
    return (
      <Dialog label="Plan" onClose={close}>
        <PaneHeader heading="Plan" dot="waiting">
          <button type="button" className={paneButtonClass()} onClick={close}>Close</button>
        </PaneHeader>
        <div className={paneBodyClass}><p className={paneNoteClass}>This plan isn&apos;t waiting any more.</p></div>
      </Dialog>
    );
  }
  const answerable = data ? canAnswer(session, approvalsFor(data, session)) : false;
  return (
    <Dialog label={`Plan: ${sessionTitle(session)}`} onClose={close}>
      <PaneHeader heading={`Plan · ${sessionTitle(session)}`} sub={prompt.question} dot="waiting">
        <span className={panePillClass}>{prompt.planFile}</span>
        <button type="button" className={paneButtonClass()} title="Close (the plan keeps waiting)" onClick={close}>Close</button>
      </PaneHeader>
      <div className={paneBodyClass}><Markdown text={prompt.plan} /></div>
      <footer className={cx(paneFooterClass, 'flex-wrap')}>
        {answerable
          ? <AnswerControls session={session} style={PANE_STYLE} onDone={close} />
          : <p className={paneNoteClass}>{`Answer it in its ${session.host?.label} tab: switchyard can't press keys there.`}</p>}
      </footer>
    </Dialog>
  );
}
