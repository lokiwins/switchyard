import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

/** A panel's box, for one that isn't a <Panel> (a folding one, the graph's). */
export const panelClass = 'bg-surface rounded-md shadow-[inset_0_0_0_1px_var(--hairline),var(--shadow-sm)] px-4 pt-3 pb-4 max-phone:p-3';

/** A panel's heading row: the title, then whatever goes beside it, wrapping where it doesn't fit. */
export const panelHeadClass = 'flex flex-wrap justify-between items-center gap-3 min-h-8 mb-2';

/** One of a page's panels: a heading, what goes beside it, then its body. `id` names its heading, for the panel's label. */
export function Panel({ id, title, head, hidden, panelId, className, children }: {
  id: string;
  title: string;
  head?: ReactNode;
  hidden?: boolean;
  panelId?: string;
  /** More classes for the panel, e.g. a page's own layout. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cx(panelClass, className)} id={panelId} aria-labelledby={id} hidden={hidden}>
      <div className={panelHeadClass}>
        <h2 id={id}>{title}</h2>
        {head}
      </div>
      {children}
    </section>
  );
}
