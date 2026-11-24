import { useState } from 'react';
import { Menu, MenuHint, MenuItem, MenuLabel, MenuTitle } from '../../components/Menu';
import type { LiveSession } from '../../lib/types';
import { EndSession } from '../agents/controls/session';
import { PUTS_AWAY } from './TaskMenu';

/*
 * "Mark as ▾" on an open task's running session, where End ▾ is elsewhere:
 * from the work you're looking at, mark the task done or drop it (as ⋯ does),
 * or end just this session and leave the task open.
 */

export function MarkAsMenu({ session, failedCheck, onClose }: {
  session: LiveSession;
  /** Its latest check failed: Done says so, and still works. */
  failedCheck: boolean;
  onClose: (as: 'done' | 'dropped') => void;
}) {
  const [open, setOpen] = useState(false);
  const choose = (as: 'done' | 'dropped') => () => {
    setOpen(false);
    onClose(as);
  };
  return (
    <Menu label="Mark as ▾" title="Mark this task done or dropped, or end just this session" look={{ variant: 'secondary', size: 'sm' }}
      roomy width={[240, 320]} panelClass="gap-1.5" focusInput={false} open={open} onOpenChange={setOpen}>
      <MenuLabel divided={false}>The task</MenuLabel>
      <MenuItem title={failedCheck ? 'Its latest check failed. Done anyway, without a merged PR to say so.' : 'Done, without a merged PR to say so'} onClick={choose('done')}>
        <MenuTitle>{failedCheck ? 'Done anyway (check failed)' : 'Done'}</MenuTitle>
      </MenuItem>
      <MenuItem title="Not doing it after all" onClick={choose('dropped')}><MenuTitle>Dropped</MenuTitle></MenuItem>
      <MenuHint>{PUTS_AWAY}</MenuHint>
      <MenuLabel>Just this session</MenuLabel>
      <EndSession session={session} onDone={() => setOpen(false)} />
    </Menu>
  );
}
