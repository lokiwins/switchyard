import { useEffect, useRef, type ReactNode, type SyntheticEvent } from 'react';
import { cx } from '../lib/cx';
import { paneHeaderClass } from './pane-classes';

/*
 * A glass pane: a native modal <dialog>, so focus stays in it and the page
 * behind can't be clicked. Esc closes it unless `keepOnEscape` (the terminal
 * pane, where Esc belongs to Claude). A control marked data-autofocus has
 * the cursor when it opens.
 */
/*
 * The glass: fixed to the right over about half the window, leaving the
 * sessions list in sight; frosted, tinted and lit at its edge in the --pane-*
 * colours (themes.css), which follow the terminal colours. The page behind is
 * dimmed the same whatever they are. `group/pane` lets the resize edge light
 * up while it's dragged (data-resizing, set by ResizeHandle).
 */
const GLASS = [
  'group/pane fixed top-3 right-3 bottom-3 left-auto m-0 p-0 h-auto max-h-none w-[max(560px,50vw)] max-w-[calc(100vw-24px)] overflow-hidden',
  'border border-pane-edge rounded-[16px] text-pane-text [color-scheme:var(--pane-scheme)]',
  '[background:linear-gradient(160deg,var(--pane-tint-a),transparent_35%),linear-gradient(200deg,var(--pane-tint-b),transparent_45%),var(--pane-bg)]',
  'backdrop-blur-[22px] backdrop-saturate-160',
  'shadow-[inset_0_1px_0_color-mix(in_srgb,var(--pane-shine)_8%,transparent),0_0_0_1px_color-mix(in_srgb,var(--pane-shine)_3%,transparent),0_0_48px_var(--pane-glow),0_30px_80px_var(--pane-drop)]',
  'open:flex open:flex-col motion-safe:open:animate-pane-in backdrop:bg-[var(--pane-backdrop)]',
  // While its edge is dragged, the pointer stays a resize cursor and nothing gets selected.
  'data-resizing:cursor-col-resize data-resizing:select-none',
].join(' ');

const DOTS = {
  waiting: 'bg-pane-wait shadow-[0_0_10px_var(--pane-wait)]',
  live: 'bg-pane-ok shadow-[0_0_10px_var(--pane-ok)]',
  idle: 'bg-pane-dim',
} as const;

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
    if (dialog && !dialog.open) {
      dialog.showModal();
      // Opening moves focus to the dialog's first control; one marked data-autofocus (a form's first field) takes it instead.
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    }
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
    <dialog ref={ref} className={cx(GLASS, className)} aria-label={label} onCancel={cancel} onClose={closed}>
      {children}
    </dialog>
  );
}

/** A pane's header: its dot (amber while something waits on you, green while live), heading and one line under it, then whatever else (a pill, buttons). */
export function PaneHeader({ heading, sub, dot, children }: {
  heading: string;
  sub?: string | null;
  dot?: 'waiting' | 'live';
  children?: ReactNode;
}) {
  return (
    <header className={paneHeaderClass}>
      <span className={cx('flex-none size-2 rounded-full', DOTS[dot ?? 'idle'])} aria-hidden="true" />
      <div className="flex flex-col min-w-0 gap-0.5">
        <strong className="text-sm font-semibold truncate">{heading}</strong>
        {sub && <span className="font-mono text-2xs [line-height:normal] text-pane-dim truncate" title={sub}>{sub}</span>}
      </div>
      {children}
    </header>
  );
}
