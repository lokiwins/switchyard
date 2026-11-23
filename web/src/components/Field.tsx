import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

/*
 * The fields of a small form in a menu or a row: New task, Start, adding a
 * task, Reply and an answer. Each is a grey label over a ringed box, the ring
 * turning accent while you type in it.
 */

// The font's longhands, not `font: inherit`, which could undo the size the box sets.
const INHERIT_FONT = '[font-family:inherit] [font-weight:inherit]';
const RING = 'shadow-[inset_0_0_0_1px_var(--gray-200)] focus:outline-none focus:shadow-[inset_0_0_0_1px_var(--accent),0_0_0_3px_var(--accent-soft)]';
const BOX = `py-1 text-xs leading-xs text-gray-900 bg-surface border-0 rounded-xs ${INHERIT_FONT} ${RING}`;

/** A typed box. */
export const fieldInputClass = cx(BOX, 'px-2');

/** A select: room on the right for its arrow (base.css draws it; only its background colour is set, so the arrow stays). */
export const fieldSelectClass = cx(BOX, 'pl-2 pr-[26px]');

/** A small form: its fields one under another. */
export const formClass = 'grid gap-2';

/** A field: its label over its box. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-0.5 text-xs text-gray-500"><span>{label}</span>{children}</label>;
}

/** A tick box beside what it means, the meaning's <strong> words darker. */
export function CheckField({ children }: { children: ReactNode }) {
  return (
    <label className="flex items-start gap-2 text-xs leading-xs text-gray-500 cursor-pointer [&_strong]:text-gray-900 [&_strong]:font-semibold [&>input]:flex-none [&>input]:mt-0.5 [&>input]:mx-0 [&>input]:mb-0">
      {children}
    </label>
  );
}

/** One line to type and a button to send it (Reply, an answer, a token): the box takes the room. */
export const lineFormClass = 'flex gap-1.5';
export const lineInputClass = cx(BOX, 'flex-1 min-w-0 px-2');
