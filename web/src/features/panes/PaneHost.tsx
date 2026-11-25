import { usePaneStore } from '../../stores/panes';
import { TerminalPane } from '../terminal/TerminalPane';
import { MakeTaskPane } from './MakeTaskPane';
import { PlanPane } from './PlanPane';
import { ReportPane } from './ReportPane';
import { ReviewPane } from './ReviewPane';
import { TaskPane } from './TaskPane';

/** The glass pane that's open, drawn over the page. */
export function PaneHost() {
  const pane = usePaneStore((s) => s.pane);
  switch (pane?.kind) {
    case 'review': return <ReviewPane key={pane.approval.id} approval={pane.approval} session={pane.session} />;
    case 'plan': return <PlanPane key={pane.sessionId} sessionId={pane.sessionId} />;
    case 'task': return <TaskPane key={pane.task.id ?? 'new'} {...pane} />;
    case 'make-task': return <MakeTaskPane key={JSON.stringify(pane.from)} from={pane.from} />;
    case 'report': return <ReportPane key={pane.heading} {...pane} />;
    case 'terminal': return <TerminalPane key={pane.session.sessionId} session={pane.session} />;
    default: return null;
  }
}
