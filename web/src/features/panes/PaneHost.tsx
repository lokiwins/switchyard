import { usePaneStore } from '../../stores/panes';
import { TerminalPane } from '../terminal/TerminalPane';
import { MakeTaskPane } from './MakeTaskPane';
import { PlanPane } from './PlanPane';
import { ReviewPane } from './ReviewPane';

/** The glass pane that's open, drawn over the page. */
export function PaneHost() {
  const pane = usePaneStore((s) => s.pane);
  switch (pane?.kind) {
    case 'review': return <ReviewPane key={pane.approval.id} approval={pane.approval} session={pane.session} />;
    case 'plan': return <PlanPane key={pane.sessionId} sessionId={pane.sessionId} />;
    case 'make-task': return <MakeTaskPane key={JSON.stringify(pane.from)} from={pane.from} />;
    case 'terminal': return <TerminalPane key={pane.session.sessionId} session={pane.session} />;
    default: return null;
  }
}
