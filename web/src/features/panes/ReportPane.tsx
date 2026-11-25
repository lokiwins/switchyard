import { Dialog, PaneHeader } from '../../components/Dialog';
import { Markdown } from '../../components/Markdown';
import { paneBodyClass, paneButtonClass } from '../../components/pane-classes';
import { usePaneStore } from '../../stores/panes';

/* A report an agent wrote (a PR review agent's), rendered, to read where it was asked for. */

export function ReportPane({ heading, sub, markdown }: { heading: string; sub?: string; markdown: string }) {
  const close = usePaneStore((s) => s.close);
  return (
    <Dialog label={heading} onClose={close}>
      <PaneHeader heading={heading} sub={sub}>
        <button type="button" className={paneButtonClass()} onClick={close}>Close</button>
      </PaneHeader>
      <div className={paneBodyClass}><Markdown text={markdown} /></div>
    </Dialog>
  );
}
