import type { ComponentProps } from 'react';
import { cx } from '../lib/cx';

/*
 * The app's buttons, as Tailwind classes. `buttonClass` is for anything that
 * looks like a button but isn't a <button> (a link, a menu's trigger);
 * `<Button>` is a <button> in one of the looks.
 *
 * - primary: the accent fill, for the one thing a place is for (Start, Save).
 * - secondary: outlined, for everything beside it.
 * - action: a soft accent chip, for doing something to a row (Jump, Resume, Open ▾).
 * - icon: barely there until hovered, for copying.
 * - danger: red, for the one destructive step (Delete).
 */

export type ButtonVariant = 'primary' | 'secondary' | 'action' | 'icon' | 'danger';
/** md and sm for text; glyph for a single symbol (the top bar's ◐). Action and icon buttons have one size. */
export type ButtonSize = 'md' | 'sm' | 'glyph';

export interface ButtonLook {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const BASE = [
  '[font-family:inherit] leading-xs border-0 rounded-sm cursor-pointer whitespace-nowrap',
  'transition-[translate,filter] duration-120 ease-[ease] motion-reduce:transition-none',
  'active:translate-y-px',
].join(' ');

const SIZES: Record<ButtonSize, string> = {
  md: 'px-2.5 py-1.25 text-xs',
  sm: 'px-2 py-0.5 text-2xs',
  glyph: 'px-2 py-0.75 text-sm',
};

const SHADOW = 'shadow-(--shadow-sm)';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: `font-semibold ${SHADOW} [background:var(--accent-fill)] text-on-accent hover:brightness-108 disabled:opacity-60 disabled:cursor-progress`,
  secondary: [
    'font-semibold bg-surface text-gray-700 shadow-[inset_0_0_0_1px_var(--gray-200),var(--shadow-sm)]',
    'hover:text-accent hover:shadow-[inset_0_0_0_1px_var(--accent),var(--shadow-sm)]',
    'disabled:cursor-default disabled:text-gray-500 disabled:shadow-[inset_0_0_0_1px_var(--divider)]',
  ].join(' '),
  danger: `font-semibold ${SHADOW} bg-red text-on-red hover:brightness-110 disabled:opacity-50 disabled:cursor-default`,
  action: [
    'inline-flex items-center px-2 py-px text-2xs font-semibold bg-accent-soft text-accent',
    'hover:bg-accent hover:text-on-accent hover:no-underline disabled:opacity-60 disabled:cursor-progress',
  ].join(' '),
  icon: [
    'font-medium px-1.75 py-px text-2xs bg-transparent text-gray-500 shadow-[inset_0_0_0_1px_var(--hairline)]',
    'hover:bg-accent-soft hover:text-accent hover:shadow-none disabled:opacity-60 disabled:cursor-progress',
  ].join(' '),
};

/** The classes for a button's look. */
export function buttonClass({ variant = 'primary', size = 'md' }: ButtonLook = {}): string {
  // Action and icon buttons set their own padding and size.
  const sized = variant === 'action' || variant === 'icon' ? '' : SIZES[size];
  return cx(BASE, sized, VARIANTS[variant]);
}

type ButtonProps = ComponentProps<'button'> & ButtonLook;

/** A <button> in one of the looks; `className` adds layout (never colours or sizes, which the look owns). */
export function Button({ variant, size, className, ...props }: ButtonProps) {
  return <button className={cx(buttonClass({ variant, size }), className)} {...props} />;
}
