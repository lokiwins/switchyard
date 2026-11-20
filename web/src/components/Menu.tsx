import * as Popover from '@radix-ui/react-popover';
import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

/*
 * A dropdown: a button and a panel placed under it (or above, where there's
 * no room), closed by Esc or a click elsewhere. The menu is a component like
 * any other, so a redraw of the page leaves an open one open, with whatever is
 * typed in it. Opening it puts the cursor in its first field unless
 * `focusInput` is false. Pass `open` and `onOpenChange` to close it from inside.
 */
export function Menu({
  label, title, className = 'btn btn-action', panelClass, focusInput = true, open, onOpenChange, children,
}: {
  label: ReactNode;
  title?: string;
  className?: string;
  panelClass?: string;
  focusInput?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger className={cx('menu-trigger', className)} title={title}>{label}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={cx('menu-panel', panelClass)}
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
