import { useEffect, useRef, type ReactNode, type SyntheticEvent } from 'react';
import { cx } from '../lib/cx';

/*
 * A glass pane: a native modal <dialog>, so focus stays in it and the page
 * behind can't be clicked. Esc closes it unless `keepOnEscape` (the terminal
 * pane, where Esc belongs to Claude).
 */
export function Dialog({
  label, className, onClose, keepOnEscape = false, children,
}: {
  label: string;
  className?: string;
  onClose: () => void;
  keepOnEscape?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  const cancel = (event: SyntheticEvent) => {
    if (keepOnEscape) event.preventDefault();
  };
  // A close that came while the dialog is open again (React runs effects twice in development) isn't one.
  const closed = () => {
    if (!ref.current?.open) onClose();
  };
  return (
    <dialog ref={ref} className={cx('glass-pane', className)} aria-label={label} onCancel={cancel} onClose={closed}>
      {children}
    </dialog>
  );
}

/** A pane's header: its dot, heading and one line under it, then whatever else (a pill, buttons). */
export function PaneHeader({ heading, sub, dot, children }: { heading: string; sub?: string | null; dot?: string; children?: ReactNode }) {
  return (
    <header className="pane-header">
      <span className={cx('pane-dot', dot)} aria-hidden="true" />
      <div className="pane-heading">
        <strong>{heading}</strong>
        {sub && <span className="pane-sub" title={sub}>{sub}</span>}
      </div>
      {children}
    </header>
  );
}
