import * as Popover from '@radix-ui/react-popover';
import type { ComponentProps, CSSProperties, ReactNode } from 'react';
import { cx } from '../lib/cx';
import { buttonClass, type ButtonLook } from './Button';

/*
 * A dropdown: a button and a panel placed under it (or above, where there's
 * no room), closed by Esc or a click elsewhere. The menu is a component like
 * any other, so a redraw of the page leaves an open one open, with whatever is
 * typed in it. Opening it puts the cursor in its first field unless
 * `focusInput` is false. Pass `open` and `onOpenChange` to close it from inside.
 *
 * A panel is as wide as its contents within `width` (220 to 340px unless a
 * menu with more to say sets it), and never wider than the window less 8px
 * each side. A `roomy` one, holding a form or a few words, gets more padding.
 */
const PANEL = [
  'z-20 flex flex-col rounded-sm bg-surface-raised',
  'min-w-[min(var(--panel-min,220px),calc(100vw-16px))] max-w-[min(var(--panel-max,340px),calc(100vw-16px))]',
  'shadow-[inset_0_1px_0_var(--highlight),inset_0_0_0_1px_var(--hairline),var(--shadow-md)]',
].join(' ');

/** An open menu's trigger stays filled, as a pressed button. */
const TRIGGER_OPEN = 'data-[state=open]:[background:var(--accent-fill)] data-[state=open]:text-on-accent';

export function Menu({
  label, title, look = { variant: 'action' }, triggerClass, panelClass, width, roomy = false, focusInput = true, open, onOpenChange, children,
}: {
  label: ReactNode;
  title?: string;
  /** The trigger's look: an action chip unless said otherwise. */
  look?: ButtonLook;
  /** Layout for the trigger's contents, beside its look. */
  triggerClass?: string;
  panelClass?: string;
  /** The panel's least and greatest width, in px. */
  width?: readonly [number, number];
  roomy?: boolean;
  focusInput?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger className={cx(buttonClass(look), TRIGGER_OPEN, triggerClass)} title={title}>{label}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={cx(PANEL, roomy ? 'p-2' : 'p-1', panelClass)}
          style={width ? ({ '--panel-min': `${width[0]}px`, '--panel-max': `${width[1]}px` } as CSSProperties) : undefined}
          align="end"
          sideOffset={4}
          collisionPadding={8}
          onOpenAutoFocus={(event) => {
            if (!focusInput) event.preventDefault();
          }}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** A menu's choice, for a <button> that isn't a <MenuItem> (one whose look is passed around as a class). */
export const menuItemClass = [
  'flex items-baseline gap-2 px-2 py-1.25 border-0 rounded-xs [font-family:inherit] text-xs leading-xs text-left',
  'text-gray-700 bg-transparent cursor-pointer',
  'hover:bg-accent-soft hover:text-accent focus-visible:bg-accent-soft focus-visible:text-accent focus-visible:outline-none',
].join(' ');

/** What a choice is, cut short with … where it doesn't fit. */
export const menuTitleClass = 'flex-1 min-w-0 truncate';

/** A choice's small grey aside, at its end (when, where). */
export const menuMetaClass = 'flex-none text-2xs text-gray-500';

/** One choice in a menu; `className` adds a menu's own layout. */
export function MenuItem({ className, type = 'button', ...props }: ComponentProps<'button'>) {
  return <button type={type} className={cx(menuItemClass, className)} {...props} />;
}

export function MenuTitle({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cx(menuTitleClass, className)} {...props} />;
}

/** A heading over a group of choices, with a line above it unless it starts the menu (`divided` false). */
export function MenuLabel({ className, divided = true, ...props }: ComponentProps<'div'> & { divided?: boolean }) {
  return (
    <div
      className={cx(
        'pt-1.5 px-2 pb-0.5 text-2xs font-semibold uppercase tracking-[0.04em] text-gray-500',
        divided && 'mt-1 border-t border-divider',
        className,
      )}
      {...props}
    />
  );
}

/** A small grey note: what a menu's form will do, or what a choice means. */
export function MenuHint({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cx('m-0 text-2xs leading-xs text-gray-500', className)} {...props} />;
}

/** A menu form's last row: its note on the left, its button on the right. */
export function MenuActions({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx('flex gap-2 items-end justify-between', className)} {...props} />;
}
