import { cx } from '../lib/cx';

/*
 * The controls and text on a glass pane. Their colours are the --pane-*
 * tokens (themes.css), which follow the terminal colours chosen, so a light
 * terminal scheme gives light glass.
 */

const focusRing = 'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-pane-accent focus-visible:outline-offset-2';

/** A line drawn across the pane that fades out at both ends: under its header, over its footer. */
const fadedEdge = '[border-image:linear-gradient(90deg,transparent,var(--pane-edge),transparent)_1]';

/** A button on the glass; the primary one (Allow, Save) is tinted green. */
export function paneButtonClass({ primary = false }: { primary?: boolean } = {}): string {
  return cx(
    'px-3 py-1 border rounded-[8px] text-pane-text text-xs cursor-pointer disabled:opacity-50 disabled:cursor-default',
    focusRing,
    primary
      ? 'border-[color-mix(in_srgb,var(--pane-ok)_50%,transparent)] bg-[color-mix(in_srgb,var(--pane-ok)_18%,transparent)] hover:bg-[color-mix(in_srgb,var(--pane-ok)_30%,transparent)]'
      : 'border-pane-edge bg-[color-mix(in_srgb,var(--pane-shine)_4%,transparent)] hover:bg-[color-mix(in_srgb,var(--pane-accent)_14%,transparent)]',
  );
}

/** A text box on the glass; in a form's field it reads a step bigger. */
export function paneInputClass({ field = false }: { field?: boolean } = {}): string {
  return cx(
    'flex-1 min-w-0 py-1.5 px-2.5 border border-pane-edge rounded-[8px] text-pane-text placeholder:text-pane-dim',
    'bg-[color-mix(in_srgb,var(--pane-shade)_25%,transparent)]',
    field ? 'text-sm' : 'text-xs',
    focusRing,
  );
}

/** A select on the glass, with room on the right for its ▾. */
export const paneSelectClass = cx(
  'py-[3px] pr-[26px] pl-2 border border-pane-edge rounded-[8px] text-pane-text text-xs [color-scheme:var(--pane-scheme)]',
  'bg-[color-mix(in_srgb,var(--pane-shade)_25%,transparent)]',
);

/** A small rounded tag in the monospace face, as the pill on a pane's header. */
export const panePillBaseClass = 'py-0.5 px-2 border rounded-full font-mono text-2xs [line-height:normal] whitespace-nowrap';
/** The header's pill, pushed to the right of the heading. */
export const panePillClass = cx(panePillBaseClass, 'ml-auto border-pane-edge text-pane-dim');

/** A quiet line of text: Loading…, a note on what's shown. */
export const paneNoteTextClass = 'text-xs text-pane-dim';
export const paneNoteClass = cx('mt-0 mx-0 mb-2.5', paneNoteTextClass);

/** A link out (to a ticket's tracker). */
export const paneLinkClass = 'text-xs text-pane-accent';

/** A small-caps heading over a section of a pane (Tickets). */
export const paneSectionClass = 'm-0 text-2xs font-bold tracking-[0.06em] uppercase text-pane-dim';

/** One of a few views of the same thing (Diff, Rendered); the one shown is lit. */
export const paneTabClass = cx(
  'py-[3px] px-3 border border-pane-edge rounded-full bg-transparent text-pane-dim text-xs cursor-pointer',
  'aria-pressed:bg-[color-mix(in_srgb,var(--pane-accent)_16%,transparent)] aria-pressed:text-pane-text',
  focusRing,
);

/** The pane's scrolling middle, between its header and footer. */
export const paneBodyClass = 'flex-1 min-h-0 overflow-auto overscroll-contain py-3 px-4';

/** The pane's foot: the answer, the buttons. */
export const paneFooterClass = cx('flex items-center gap-2.5 py-3 px-4 border-t border-transparent', fadedEdge);

/** The pane's head, under which a faded line is drawn. */
export const paneHeaderClass = cx('flex items-center gap-3 py-3 px-4 border-b border-transparent', fadedEdge);

/** A block of code or a whole command, on a darker band. */
export const paneCodeClass = cx(
  'm-0 p-3 rounded-[8px] font-mono text-xs leading-[1.5] whitespace-pre-wrap [word-break:break-word]',
  'bg-[color-mix(in_srgb,var(--pane-shade)_30%,transparent)]',
);
